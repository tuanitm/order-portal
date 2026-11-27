import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { queryPricedProducts, type PricingContext } from "@/lib/pricing/productPricing";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { AR_AGING_BUCKETS, AR_AGING_BUCKET_LABELS } from "@/lib/hana/arAgingQuery";
import { freeQtyFor } from "@/lib/adminOrderCreate";
import type { ArSummary } from "@/lib/soApproval/sapData";
import type { ProductWithPricing } from "@/types/product";

/**
 * The Accountant's five top-down checks for one portal Sales Order:
 *   1 Standard Price · 2 Period Discount · 3 Contract Discount ·
 *   4 Promotion Discount · 5 AR (open invoices / credit)
 * Stock & required shelf life is NOT checked here — it belongs to the Admin
 * Approval (the push caps Confirm Qty at live, shelf-life-valid stock).
 * Steps 1–4 compare what the order was priced at (order_lines) with what the
 * pricing engine gives this customer TODAY (the storefront's own rules).
 * Each step says pass / warn / fail; the Accountant must write a note to
 * approve past any step that isn't "pass".
 */
export type CheckStatus = "pass" | "warn" | "fail" | "error";
export type CheckKey = "price" | "period" | "contract" | "promotion" | "ar";

/** A nested table under one row. */
export interface CheckSubTable { columns: { key: string; label: string; align?: "right" }[]; rows: CheckRow[] }
/** One table row: column values, plus optional _status and _sub (nested table). */
export interface CheckRow { [col: string]: string | number | null | undefined | CheckSubTable }
export interface CheckResult {
  key: CheckKey;
  step: number;
  title: string;
  status: CheckStatus;
  summary: string;
  recommendation: string;
  columns: { key: string; label: string; align?: "right" }[];
  rows: (CheckRow & { _status?: CheckStatus; _sub?: CheckSubTable })[];
}

export const CHECK_TITLES: Record<CheckKey, string> = {
  price: "Standard Price",
  period: "Standard / Period Discount",
  contract: "Contract Discount",
  promotion: "Promotion Discount",
  ar: "AR Aging — Pending Invoices (not reconciled) & Credit",
};
const ORDER: CheckKey[] = ["price", "period", "contract", "promotion", "ar"];

interface OrderLineRow {
  id: number;
  sap_item_code: string;
  item_name: string | null;
  quantity: number;
  base_unit_price: number | string | null;
  unit_price: number | string | null;
  is_gift_line: number;
  source_line_id: number | null;
  period_disc_pct: number | string | null;
  contract_disc_pct: number | string | null;
  promo_disc_pct: number | string | null;
  promotion_code: string | null;
  promotion_name: string | null;
  giveaway_promotion_code: string | null;
  giveaway_promotion_name: string | null;
  promo_buy_qty: number | null;
  promo_give_qty: number | null;
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Money equal within 1 VND or 0.1 %. */
const sameMoney = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);
const samePct = (a: number, b: number) => Math.abs(a - b) < 0.005;
const worst = (statuses: CheckStatus[]): CheckStatus =>
  statuses.includes("error") ? "error" : statuses.includes("fail") ? "fail" : statuses.includes("warn") ? "warn" : "pass";

function result(key: CheckKey, status: CheckStatus, summary: string, columns: CheckResult["columns"], rows: CheckResult["rows"], recommendation?: string): CheckResult {
  return {
    key, step: ORDER.indexOf(key) + 1, title: CHECK_TITLES[key], status, summary, columns, rows,
    recommendation: recommendation ?? (status === "pass" ? "OK — go to the next step." : status === "warn"
      ? "Review the highlighted lines; continue only if they're justified (a note is required)."
      : status === "fail" ? "Not recommended — continue only with a reason in the note."
      : "The check couldn't run — verify manually and note what you checked."),
  };
}

export interface OrderForChecks {
  /** Portal orders.id — 0 for a Sales Order that exists only in SAP. */
  id: number;
  sapCardCode: string;
  warehouseCode: string | null;
  customer: { cus_grp01: string | null; cus_grp02: string | null; cus_grp03: string | null; price_list_num: number | null };
  /** Set for a Sales Order read from SAP (no portal order): its lines, already in the portal's shape. */
  sapLines?: OrderLineRow[];
  /** SAP DocEntry — names the live stock queries of an SAP-only Sales Order. */
  docEntry?: number;
}

const lineNo = (v: unknown) => {
  const m = /^(\d+)-/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
};

/**
 * A Sales Order straight from SAP (ORDR / RDR1 / OCRD), for one created in
 * SAP by a salesperson. Its lines follow the same convention the portal's
 * push writes (and SAP's promotion add-on uses):
 *   item line      ItemCode, Quantity, PriceBefDi = channel price, DiscPrcnt = period %, Price = after period
 *   discount line  U_PM_Type 98 = contract / 20 = promotion, U_PM_DiscPercent, U_CTKM = program,
 *                  U_PM_BaseLine "n-ItemCode" → its item line
 *   free goods     U_PM_Type 31, UnitPrice 0, U_CTKM, U_PM_BaseLine → the buy line
 */
export async function loadSapSoForChecks(docEntry: number): Promise<OrderForChecks | null> {
  const s = `"${getHanaSchema()}"`;
  const [hdr] = await queryHana<Record<string, unknown>>(
    `SELECT O."DocEntry", O."CardCode", C."U_CusGrp01", C."U_CusGrp02", C."U_CusGrp03", C."ListNum"
       FROM ${s}."ORDR" O JOIN ${s}."OCRD" C ON C."CardCode" = O."CardCode" WHERE O."DocEntry" = ${Number(docEntry)}`
  );
  if (!hdr) return null;
  const raw = await queryHana<Record<string, unknown>>(
    `SELECT L."LineNum", L."ItemCode", L."Dscription", L."Quantity", L."PriceBefDi", L."DiscPrcnt", L."Price", L."WhsCode",
            L."U_PM_Type", L."U_PM_BaseLine", L."U_PM_DiscPercent", L."U_CTKM", L."U_CTKM_NAME"
       FROM ${s}."RDR1" L WHERE L."DocEntry" = ${Number(docEntry)} ORDER BY L."LineNum"`
  );
  const type = (l: Record<string, unknown>) => String(l.U_PM_Type ?? "").trim();
  const items = raw.filter((l) => !["98", "20", "31"].includes(type(l)) && n(l.Quantity) > 0);
  const byBase = new Map<number, OrderLineRow>();
  const out: OrderLineRow[] = items.map((l, i) => {
    const row: OrderLineRow = {
      id: n(l.LineNum) + 1, sap_item_code: String(l.ItemCode), item_name: l.Dscription ? String(l.Dscription) : null,
      quantity: n(l.Quantity), base_unit_price: n(l.Price), unit_price: n(l.Price), is_gift_line: 0, source_line_id: null,
      period_disc_pct: n(l.DiscPrcnt), contract_disc_pct: 0, promo_disc_pct: 0, promotion_code: null, promotion_name: null,
      giveaway_promotion_code: null, giveaway_promotion_name: null, promo_buy_qty: null, promo_give_qty: null,
    };
    byBase.set(lineNo(l.U_PM_BaseLine) ?? i, row);
    return row;
  });
  for (const l of raw) {
    const t = type(l);
    const base = byBase.get(lineNo(l.U_PM_BaseLine) ?? -1);
    if ((t === "98" || t === "20") && base) {
      if (t === "98") base.contract_disc_pct = n(base.contract_disc_pct) + n(l.U_PM_DiscPercent);
      else {
        base.promo_disc_pct = n(base.promo_disc_pct) + n(l.U_PM_DiscPercent);
        base.promotion_code = l.U_CTKM ? String(l.U_CTKM) : base.promotion_code;
        base.promotion_name = l.U_CTKM_NAME ? String(l.U_CTKM_NAME) : base.promotion_name;
      }
    } else if (t === "31") {
      out.push({
        id: n(l.LineNum) + 1, sap_item_code: String(l.ItemCode), item_name: l.Dscription ? String(l.Dscription) : null,
        quantity: n(l.Quantity), base_unit_price: 0, unit_price: 0, is_gift_line: 1, source_line_id: base?.id ?? null,
        period_disc_pct: 0, contract_disc_pct: 0, promo_disc_pct: 0, promotion_code: null, promotion_name: null,
        giveaway_promotion_code: l.U_CTKM ? String(l.U_CTKM) : null, giveaway_promotion_name: l.U_CTKM_NAME ? String(l.U_CTKM_NAME) : null,
        promo_buy_qty: null, promo_give_qty: null,
      });
    }
  }
  for (const r of out) r.unit_price = n(r.base_unit_price) * (1 - (n(r.contract_disc_pct) + n(r.promo_disc_pct)) / 100);
  return {
    id: 0, docEntry: Number(docEntry), sapCardCode: String(hdr.CardCode),
    warehouseCode: items[0]?.WhsCode ? String(items[0].WhsCode) : null,
    customer: {
      cus_grp01: hdr.U_CusGrp01 ? String(hdr.U_CusGrp01) : null, cus_grp02: hdr.U_CusGrp02 ? String(hdr.U_CusGrp02) : null,
      cus_grp03: hdr.U_CusGrp03 ? String(hdr.U_CusGrp03) : null, price_list_num: hdr.ListNum === null || hdr.ListNum === undefined ? null : n(hdr.ListNum),
    },
    sapLines: out,
  };
}

export async function loadOrderForChecks(orderId: number): Promise<OrderForChecks | null> {
  const row = await queryOne<{
    id: number; sap_card_code: string | null; warehouse_code: string | null;
    cus_grp01: string | null; cus_grp02: string | null; cus_grp03: string | null; price_list_num: number | null;
  }>(
    `SELECT o.id, COALESCE(o.sap_card_code, u.sap_card_code) AS sap_card_code, o.warehouse_code,
            COALESCE(c.cus_grp01, u.sap_cus_grp01) AS cus_grp01, COALESCE(c.cus_grp02, u.sap_cus_grp02) AS cus_grp02,
            COALESCE(c.cus_grp03, u.sap_cus_grp03) AS cus_grp03, COALESCE(c.price_list_num, u.sap_price_list_num) AS price_list_num
       FROM orders o
       LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id
       LEFT JOIN customers c ON c.company_id = o.company_id AND c.sap_card_code = COALESCE(o.sap_card_code, u.sap_card_code)
      WHERE o.company_id = ? AND o.id = ?`,
    [getCompanyId(), orderId]
  );
  if (!row?.sap_card_code) return null;
  return {
    id: row.id, sapCardCode: row.sap_card_code, warehouseCode: row.warehouse_code,
    customer: { cus_grp01: row.cus_grp01, cus_grp02: row.cus_grp02, cus_grp03: row.cus_grp03, price_list_num: row.price_list_num },
  };
}

/** Today's pricing for these items for this customer — no visibility or stock gates. */
async function currentPricing(order: OrderForChecks, codes: string[]): Promise<Map<string, ProductWithPricing>> {
  if (codes.length === 0) return new Map();
  const ctx: PricingContext = {
    sapCardCode: order.sapCardCode,
    cusGrp01: order.customer.cus_grp01 ?? "",
    cusGrp02: order.customer.cus_grp02 ?? "",
    cusGrp03: order.customer.cus_grp03 ?? "",
    priceListNum: order.customer.price_list_num,
    basePriceListNum: await getBasePriceListNum(),
    stockWarehouseCodes: [],
  };
  const items = await queryPricedProducts(
    ctx, [], [], [`i.sap_item_code IN (${codes.map(() => "?").join(",")})`], codes,
    "ORDER BY i.sap_item_code LIMIT ?", [codes.length]
  );
  return new Map(items.map((p) => [p.sapItemCode, p]));
}

/**
 * Items the portal doesn't carry (item group outside the portal's Item Groups,
 * or unpriced there): the customer's price list price straight from SAP
 * (ITM1; the base list when the customer's has none), plus whether the item is
 * a service / discount line (non-inventory — not a price item).
 */
async function sapListPrices(order: OrderForChecks, codes: string[]): Promise<Map<string, { price: number | null; service: boolean }>> {
  const out = new Map<string, { price: number | null; service: boolean }>();
  if (!codes.length) return out;
  const s = `"${getHanaSchema()}"`;
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const base = await getBasePriceListNum();
  const list = order.customer.price_list_num ?? base;
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT T."ItemCode", T."InvntItem", P."Price" AS "ListPrice", B."Price" AS "BasePrice"
       FROM ${s}."OITM" T
       LEFT JOIN ${s}."ITM1" P ON P."ItemCode" = T."ItemCode" AND P."PriceList" = ${Number(list)}
       LEFT JOIN ${s}."ITM1" B ON B."ItemCode" = T."ItemCode" AND B."PriceList" = ${Number(base)}
      WHERE T."ItemCode" IN (${codes.map(lit).join(",")})`
  );
  for (const r of rows) {
    const lp = n(r.ListPrice), bp = n(r.BasePrice);
    out.set(String(r.ItemCode), { price: lp > 0 ? lp : bp > 0 ? bp : null, service: String(r.InvntItem) === "N" });
  }
  return out;
}

/** Step-1 price = the Channel Price before Period Discount (base_unit_price is after it). */
const channelPrice = (afterPeriod: number, periodPct: number) => (periodPct >= 100 ? afterPeriod : afterPeriod / (1 - periodPct / 100));

export async function runApprovalChecks(order: OrderForChecks, ar: ArSummary | null): Promise<CheckResult[]> {
  const lines = order.sapLines ?? await query<OrderLineRow[]>(
    `SELECT id, sap_item_code, item_name, quantity, base_unit_price, unit_price, is_gift_line, source_line_id,
            period_disc_pct, contract_disc_pct, promo_disc_pct, promotion_code, promotion_name,
            giveaway_promotion_code, giveaway_promotion_name, promo_buy_qty, promo_give_qty
       FROM order_lines WHERE company_id = ? AND order_id = ? ORDER BY id`,
    [getCompanyId(), order.id]
  );
  const sold = lines.filter((l) => !l.is_gift_line);
  const gifts = lines.filter((l) => l.is_gift_line);
  const codes = [...new Set(lines.map((l) => l.sap_item_code))];

  const pricing = await currentPricing(order, codes).catch((e) => e as Error);

  const out: CheckResult[] = [];
  if (pricing instanceof Error) {
    for (const key of ["price", "period", "contract", "promotion"] as CheckKey[]) {
      out.push(result(key, "error", `Pricing lookup failed: ${pricing.message}`, [], []));
    }
  } else {
    const missing = [...new Set(sold.map((l) => l.sap_item_code).filter((c) => !pricing.has(c)))];
    const sapPrices = await sapListPrices(order, missing).catch((e) => {
      console.warn("[SO Approval] SAP price list lookup failed:", e instanceof Error ? e.message : e);
      return new Map<string, { price: number | null; service: boolean }>();
    });
    out.push(priceCheck(sold, pricing, sapPrices), pctCheck("period", sold, pricing), pctCheck("contract", sold, pricing), promotionCheck(sold, gifts, pricing));
  }
  out.push(arCheck(ar));
  return out;
}

function priceCheck(sold: OrderLineRow[], pricing: Map<string, ProductWithPricing>, sapPrices: Map<string, { price: number | null; service: boolean }> = new Map()): CheckResult {
  const rows: CheckResult["rows"] = sold.map((l) => {
    const p = pricing.get(l.sap_item_code);
    const orderPrice = r2(channelPrice(n(l.base_unit_price), n(l.period_disc_pct)));
    if (!p) {
      // Not in the portal's catalog (item group outside the portal's Item Groups, or unpriced there):
      // compare with the customer's price list in SAP instead.
      const sp = sapPrices.get(l.sap_item_code);
      if (sp?.service) {
        return { item: l.sap_item_code, name: l.item_name, qty: l.quantity, order: orderPrice, standard: "service / discount line — not price-checked", diff: null, _status: "pass" as CheckStatus };
      }
      if (!sp || sp.price === null) {
        return { item: l.sap_item_code, name: l.item_name, qty: l.quantity, order: orderPrice, standard: sp ? "no price in the SAP price list" : "not in portal catalog", diff: null, _status: (sp ? "fail" : "error") as CheckStatus };
      }
      const std = r2(sp.price);
      const st: CheckStatus = sameMoney(orderPrice, std) ? "pass" : orderPrice < std ? "fail" : "warn";
      return { item: l.sap_item_code, name: l.item_name, qty: l.quantity, order: orderPrice, standard: std, diff: r2(orderPrice - std), source: "SAP price list", _status: st };
    }
    const std = r2(channelPrice(p.basePrice, p.periodDiscPct));
    const st: CheckStatus = sameMoney(orderPrice, std) ? "pass" : orderPrice < std ? "fail" : "warn";
    return { item: l.sap_item_code, name: l.item_name, qty: l.quantity, order: orderPrice, standard: std, diff: r2(orderPrice - std), _status: st };
  });
  const status = worst(rows.map((r) => r._status ?? "pass"));
  const bad = rows.filter((r) => r._status !== "pass").length;
  return result("price", status,
    status === "pass" ? `All ${rows.length} line(s) at the customer's standard price list price.`
      : status === "error" && rows.every((r) => r._status === "error" || r._status === "pass")
        ? `${rows.filter((r) => r._status === "error").length} item(s) aren't in the portal catalog or SAP — verify their price in SAP.`
        : `${bad} of ${rows.length} line(s) differ from today's standard price${rows.some((r) => r._status === "error") ? " (some items aren't in the portal catalog)" : ""}.`,
    [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "qty", label: "Qty", align: "right" },
     { key: "order", label: "Order price", align: "right" }, { key: "standard", label: "Standard", align: "right" }, { key: "diff", label: "Diff", align: "right" },
     ...(rows.some((r) => r.source) ? [{ key: "source", label: "Standard from" }] : [])],
    rows);
}

/** "YYYY-MM-DD" -> "dd/MM/yyyy"; null = open-ended. */
const untilDate = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "no end date");

/**
 * Steps 2 / 3: only the items with a Standard/Period (or Contract) discount —
 * on the order (Setup %) or valid for the customer today. "Valid until" is the
 * end date of today's valid discount; when today's % differs from the setup,
 * it is shown next to the date.
 */
function pctCheck(key: "period" | "contract", sold: OrderLineRow[], pricing: Map<string, ProductWithPricing>): CheckResult {
  const label = key === "period" ? "standard / period discount" : "contract discount";
  const rows: CheckResult["rows"] = [];
  for (const l of sold) {
    const p = pricing.get(l.sap_item_code);
    const orderPct = n(key === "period" ? l.period_disc_pct : l.contract_disc_pct);
    const nowPct = p ? (key === "period" ? p.periodDiscPct : p.contractDiscPct) : 0;
    if (orderPct <= 0 && nowPct <= 0) continue; // no discount of this kind for this item
    const st: CheckStatus = !p ? "error" : nowPct <= 0 ? "fail"
      : samePct(orderPct, nowPct) ? "pass" : orderPct > nowPct ? "fail" : "warn";
    const until = !p ? "not in portal catalog" : nowPct <= 0 ? "not valid today"
      : untilDate(key === "period" ? p.periodDiscValidTo : p.contractDiscValidTo) + (samePct(orderPct, nowPct) ? "" : ` (valid ${r2(nowPct)} %)`);
    rows.push({ item: l.sap_item_code, name: l.item_name, order: r2(orderPct), until, _status: st });
  }
  const status = worst(rows.map((r) => r._status ?? "pass"));
  return result(key, status,
    rows.length === 0 ? `No ${label} on this order, none expected.`
      : status === "pass" ? `${rows.length} item(s) with ${label}, all matching the ${label} valid today.`
      : `${rows.filter((r) => r._status === "fail").length} item(s) get MORE ${label} than valid today, ${rows.filter((r) => r._status === "warn").length} get less.`,
    [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "order", label: "Setup %", align: "right" }, { key: "until", label: "Valid until" }],
    rows);
}

/**
 * Step 4: every bought item with a promotion, each followed by its free item(s)
 * (🎁). Disc = the % discount on the order; Ratio = the buy-give rule with the
 * qty on the order — "Buy 4 free 1 (buy 8)" on the buying item,
 * "Buy 4 free 1 (free 2)" on its free item.
 */
function promotionCheck(sold: OrderLineRow[], gifts: OrderLineRow[], pricing: Map<string, ProductWithPricing>): CheckResult {
  const rows: CheckResult["rows"] = [];
  const ratio = (buy: number | null | undefined, give: number | null | undefined) => (buy && give ? `Buy ${r2(n(buy))} free ${r2(n(give))}` : "");
  /** The buy-give rule of a free line: today's program rule, else the one saved on the order line. */
  const ruleOf = (g: OrderLineRow, src: OrderLineRow | undefined) => {
    const p = src ? pricing.get(src.sap_item_code) : undefined;
    const program = p?.giveawayOptions.find((o) => o.code === g.giveaway_promotion_code && (o.giveItemCode === g.sap_item_code || o.extra?.giveItemCode === g.sap_item_code));
    const rule = program ? (program.giveItemCode === g.sap_item_code ? program : program.extra) : undefined;
    return { p, program, rule, text: rule ? ratio(rule.buyQty, rule.giveQty) : ratio(g.promo_buy_qty, g.promo_give_qty) };
  };
  /** Ratio cell of a buying item: its free items' rules, with the bought qty. */
  const buyRatio = (l: OrderLineRow, its: OrderLineRow[]) => {
    const texts = [...new Set(its.map((g) => ruleOf(g, l).text).filter(Boolean))];
    return texts.length ? `${texts.join(" · ")} (buy ${r2(n(l.quantity))})` : "—";
  };
  const giftsOf = new Map<number, OrderLineRow[]>();
  const unpaired: OrderLineRow[] = [];
  for (const g of gifts) {
    const src = sold.find((x) => x.id === g.source_line_id) ?? sold.find((x) => x.sap_item_code === g.sap_item_code);
    if (src) giftsOf.set(src.id, [...(giftsOf.get(src.id) ?? []), g]);
    else unpaired.push(g);
  }
  const giftRow = (g: OrderLineRow, src: OrderLineRow | undefined) => {
    const { p, program, rule, text: r } = ruleOf(g, src);
    const allowedQty = src && rule ? freeQtyFor(src.quantity, rule.buyQty, rule.giveQty) : null;
    const st: CheckStatus = src && !p ? "error" : allowedQty === null ? "fail" : g.quantity <= allowedQty ? "pass" : "fail";
    const until = src && !p ? "not in portal catalog" : allowedQty === null ? "not valid today"
      : untilDate(rule?.validTo ?? program?.validTo) + (g.quantity <= allowedQty ? "" : ` (valid ${allowedQty} free)`);
    rows.push({
      item: `↳ 🎁 ${g.sap_item_code}`, name: g.item_name, type: "free item", program: g.giveaway_promotion_code || g.giveaway_promotion_name,
      disc: "—", ratio: r ? `${r} (free ${r2(n(g.quantity))})` : `${r2(n(g.quantity))} free`, until, _status: st,
    });
  };
  for (const l of sold) {
    const p = pricing.get(l.sap_item_code);
    const pct = n(l.promo_disc_pct);
    const its = giftsOf.get(l.id) ?? [];
    if (pct > 0) {
      const program = p?.promotionOptions.find((o) => (l.promotion_code ? o.code === l.promotion_code : true));
      const allowed = program ? Number(program.pct) : null;
      const st: CheckStatus = !p ? "error" : allowed === null ? "fail" : samePct(pct, allowed) ? "pass" : pct > allowed ? "fail" : "warn";
      const until = !p ? "not in portal catalog" : allowed === null ? "not valid today"
        : untilDate(program?.validTo) + (samePct(pct, allowed) ? "" : ` (valid ${r2(allowed)} %)`);
      rows.push({ item: l.sap_item_code, name: l.item_name, type: "% discount", program: l.promotion_code || l.promotion_name, disc: `${r2(pct)} %`, ratio: buyRatio(l, its), until, _status: st });
    } else if (its.length) {
      // No % discount, but it has free items — the buying item still heads its pair.
      rows.push({ item: l.sap_item_code, name: l.item_name, type: "buying item", program: null, disc: "—", ratio: buyRatio(l, its), until: "—", _status: "pass" });
    }
    for (const g of its) giftRow(g, l);
  }
  for (const g of unpaired) giftRow(g, undefined);
  const status = worst(rows.map((r) => r._status ?? "pass"));
  const promoRows = rows.filter((r) => r.type !== "buying item");
  return result("promotion", status,
    promoRows.length === 0 ? "No promotion on this order." : status === "pass" ? `${promoRows.length} promotion line(s), all valid today.`
      : `${promoRows.filter((r) => r._status !== "pass").length} promotion line(s) not matching a program valid today.`,
    [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "type", label: "Type" }, { key: "program", label: "Program" },
     { key: "disc", label: "Disc", align: "right" }, { key: "ratio", label: "Ratio" }, { key: "until", label: "Valid until" }],
    rows);
}

/**
 * Step 5 — SAP AR aging (QRM_Q504_AR_Aging2) for this customer, as of today:
 * every invoice / journal / payment line not yet reconciled, with its age in
 * days past due. Overdue = Ages ≥ 0 (every Q504 bucket but "Not due").
 */
function arCheck(ar: ArSummary | null): CheckResult {
  if (!ar) return result("ar", "error", "AR aging could not be read from SAP.", [], []);
  const overLimit = ar.creditAvailable !== null && ar.creditAvailable < 0;
  const status: CheckStatus = ar.overdueInvoiceCount > 0 || overLimit ? "fail"
    : ar.openInvoiceCount > 0 || ar.unreconciledCreditCount > 0 ? "warn" : "pass";
  const parts: string[] = [];
  parts.push(ar.openInvoiceCount ? `${ar.openInvoiceCount} invoice(s) not reconciled, ${fmt(ar.openInvoiceAmount)}` : "No invoices pending");
  if (ar.overdueInvoiceCount) parts.push(`${ar.overdueInvoiceCount} overdue (${fmt(ar.overdueAmount)}, oldest ${ar.oldestOverdueDays} days)`);
  if (ar.unreconciledCreditCount) parts.push(`${ar.unreconciledCreditCount} payment/credit line(s) not reconciled, ${fmt(ar.unreconciledCredits)}`);
  if (ar.creditAvailable !== null) parts.push(overLimit ? `credit limit exceeded by ${fmt(-ar.creditAvailable)}` : `credit available ${fmt(ar.creditAvailable)}`);
  const buckets = AR_AGING_BUCKETS.filter((b) => Math.round(ar.aging[b]) !== 0).map((b) => `${AR_AGING_BUCKET_LABELS[b]}: ${fmt(ar.aging[b])}`);
  if (buckets.length) parts.push(`aging ${buckets.join(", ")}`);

  const rows: CheckResult["rows"] = [...ar.agingRows]
    .sort((a, b) => (b.ages ?? -99999) - (a.ages ?? -99999))
    .map((r) => ({
      type: r.docType, docNo: r.docNo ?? r.docNum, invoice: r.invNo, so: r.soNo, invDate: r.invDate, due: r.dueDate,
      ages: r.ages === null ? null : r.ages < 0 ? `not due (${-r.ages}d)` : `${r.ages}`,
      amount: r.invAmt, open: r.invBal, brand: r.brCode, notes: r.notes,
      _status: (r.invBal > 0 && r.ages !== null && r.ages >= 0 ? "fail" : "warn") as CheckStatus,
    }));
  return result("ar", status, parts.join("; ") + ".",
    [{ key: "type", label: "Type" }, { key: "docNo", label: "Doc no" }, { key: "invoice", label: "Invoice no" }, { key: "so", label: "SO no" },
     { key: "invDate", label: "Inv. date" }, { key: "due", label: "Due date" }, { key: "ages", label: "Age (days)", align: "right" },
     { key: "amount", label: "Amount", align: "right" }, { key: "open", label: "Not reconciled", align: "right" },
     { key: "brand", label: "Brand" }, { key: "notes", label: "Notes" }],
    rows,
    status === "fail" ? "Not recommended — overdue debt or credit limit exceeded. Continue only with a reason (e.g. payment promised)."
      : status === "warn" ? "Customer has open items that aren't overdue (or payments not yet reconciled) — note them and continue." : undefined);
}

const fmt = (v: number) => `${Math.round(v).toLocaleString("en-US")} ₫`;
