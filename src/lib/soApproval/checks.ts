import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { queryPricedProducts, type PricingContext } from "@/lib/pricing/productPricing";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { getLiveAvailabilityForOrder, getLiveAvailability } from "@/lib/orderStock";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { queryHanaInventoryByWarehouse } from "@/lib/hana/inventoryQuery";
import { AR_AGING_BUCKETS, AR_AGING_BUCKET_LABELS } from "@/lib/hana/arAgingQuery";
import { freeQtyFor } from "@/lib/adminOrderCreate";
import type { ArSummary } from "@/lib/soApproval/sapData";
import type { ProductWithPricing } from "@/types/product";

/**
 * The Accountant's six top-down checks for one portal Sales Order:
 *   1 Standard Price · 2 Period Discount · 3 Contract Discount ·
 *   4 Promotion Discount · 5 Stock & shelf life · 6 AR (open invoices / credit)
 * Steps 1–4 compare what the order was priced at (order_lines) with what the
 * pricing engine gives this customer TODAY (the storefront's own rules).
 * Each step says pass / warn / fail; the Accountant must write a note to
 * approve past any step that isn't "pass".
 */
export type CheckStatus = "pass" | "warn" | "fail" | "error";
export type CheckKey = "price" | "period" | "contract" | "promotion" | "stock" | "ar";

/** A nested table under one row (e.g. the batches of an item in the stock check). */
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
  stock: "Inventory Available & Required Shelf Life",
  ar: "AR Aging — Pending Invoices (not reconciled) & Credit",
};
const ORDER: CheckKey[] = ["price", "period", "contract", "promotion", "stock", "ar"];

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

  const [pricing, stock] = await Promise.all([
    currentPricing(order, codes).catch((e) => e as Error),
    stockCheck(order, lines).catch((e) => result("stock", "error", `Stock check failed: ${e instanceof Error ? e.message : String(e)}`, [], [])),
  ]);

  const out: CheckResult[] = [];
  if (pricing instanceof Error) {
    for (const key of ["price", "period", "contract", "promotion"] as CheckKey[]) {
      out.push(result(key, "error", `Pricing lookup failed: ${pricing.message}`, [], []));
    }
  } else {
    out.push(priceCheck(sold, pricing), pctCheck("period", sold, pricing), pctCheck("contract", sold, pricing), promotionCheck(sold, gifts, pricing));
  }
  out.push(stock);
  out.push(arCheck(ar));
  return out;
}

function priceCheck(sold: OrderLineRow[], pricing: Map<string, ProductWithPricing>): CheckResult {
  const rows: CheckResult["rows"] = sold.map((l) => {
    const p = pricing.get(l.sap_item_code);
    const orderPrice = r2(channelPrice(n(l.base_unit_price), n(l.period_disc_pct)));
    // Not in the portal's catalog (item group outside config masterdata.itemGroup) — can't be checked here.
    if (!p) return { item: l.sap_item_code, name: l.item_name, qty: l.quantity, order: orderPrice, standard: "not in portal catalog", diff: null, _status: "error" as CheckStatus };
    const std = r2(channelPrice(p.basePrice, p.periodDiscPct));
    const st: CheckStatus = sameMoney(orderPrice, std) ? "pass" : orderPrice < std ? "fail" : "warn";
    return { item: l.sap_item_code, name: l.item_name, qty: l.quantity, order: orderPrice, standard: std, diff: r2(orderPrice - std), _status: st };
  });
  const status = worst(rows.map((r) => r._status ?? "pass"));
  const bad = rows.filter((r) => r._status !== "pass").length;
  return result("price", status,
    status === "pass" ? `All ${rows.length} line(s) at the customer's standard price list price.`
      : status === "error" && rows.every((r) => r._status === "error" || r._status === "pass")
        ? `${rows.filter((r) => r._status === "error").length} item(s) aren't in the portal catalog — verify their price in SAP.`
        : `${bad} of ${rows.length} line(s) differ from today's standard price${rows.some((r) => r._status === "error") ? " (some items aren't in the portal catalog)" : ""}.`,
    [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "qty", label: "Qty", align: "right" },
     { key: "order", label: "Order price", align: "right" }, { key: "standard", label: "Standard", align: "right" }, { key: "diff", label: "Diff", align: "right" }],
    rows);
}

function pctCheck(key: "period" | "contract", sold: OrderLineRow[], pricing: Map<string, ProductWithPricing>): CheckResult {
  const rows: CheckResult["rows"] = sold.map((l) => {
    const p = pricing.get(l.sap_item_code);
    const orderPct = n(key === "period" ? l.period_disc_pct : l.contract_disc_pct);
    const nowPct = p ? (key === "period" ? p.periodDiscPct : p.contractDiscPct) : null;
    const st: CheckStatus = !p ? (orderPct > 0 ? "error" : "pass") : nowPct === null ? (orderPct > 0 ? "fail" : "pass")
      : samePct(orderPct, nowPct) ? "pass" : orderPct > nowPct ? "fail" : "warn";
    return { item: l.sap_item_code, name: l.item_name, order: r2(orderPct), allowed: nowPct === null ? null : r2(nowPct), _status: st };
  });
  const status = worst(rows.map((r) => r._status ?? "pass"));
  const used = rows.filter((r) => n(r.order) > 0).length;
  const label = key === "period" ? "period discount" : "contract discount";
  return result(key, status,
    status === "pass" ? (used ? `${used} line(s) with ${label}, all matching today's valid ${label}.` : `No ${label} on this order, none expected.`)
      : `${rows.filter((r) => r._status === "fail").length} line(s) get MORE ${label} than allowed today, ${rows.filter((r) => r._status === "warn").length} get less.`,
    [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "order", label: "Order %", align: "right" }, { key: "allowed", label: "Valid today %", align: "right" }],
    rows);
}

function promotionCheck(sold: OrderLineRow[], gifts: OrderLineRow[], pricing: Map<string, ProductWithPricing>): CheckResult {
  const rows: CheckResult["rows"] = [];
  for (const l of sold) {
    const p = pricing.get(l.sap_item_code);
    const pct = n(l.promo_disc_pct);
    if (pct > 0) {
      const program = p?.promotionOptions.find((o) => (l.promotion_code ? o.code === l.promotion_code : true));
      const allowed = program ? Number(program.pct) : null;
      const st: CheckStatus = !p ? "error" : allowed === null ? "fail" : samePct(pct, allowed) ? "pass" : pct > allowed ? "fail" : "warn";
      rows.push({ item: l.sap_item_code, type: "% discount", program: l.promotion_code || l.promotion_name, order: `${r2(pct)} %`, allowed: !p ? "not in portal catalog" : allowed === null ? "not valid today" : `${r2(allowed)} %`, _status: st });
    }
  }
  // Free goods: each gift line against the buy line's program today.
  for (const g of gifts) {
    const src = sold.find((s) => s.id === g.source_line_id) ?? sold.find((s) => s.sap_item_code === g.sap_item_code);
    const p = src ? pricing.get(src.sap_item_code) : undefined;
    const program = p?.giveawayOptions.find((o) => o.code === g.giveaway_promotion_code && (o.giveItemCode === g.sap_item_code || o.extra?.giveItemCode === g.sap_item_code));
    let allowedQty: number | null = null;
    if (src && program) {
      const rule = program.giveItemCode === g.sap_item_code ? program : program.extra;
      allowedQty = rule ? freeQtyFor(src.quantity, rule.buyQty, rule.giveQty) : null;
    }
    const st: CheckStatus = src && !p ? "error" : allowedQty === null ? "fail" : g.quantity <= allowedQty ? "pass" : "fail";
    rows.push({ item: g.sap_item_code, type: "free goods", program: g.giveaway_promotion_code || g.giveaway_promotion_name, order: `${g.quantity} free`, allowed: src && !p ? "not in portal catalog" : allowedQty === null ? "not valid today" : `${allowedQty} free`, _status: st });
  }
  const status = worst(rows.map((r) => r._status ?? "pass"));
  return result("promotion", status,
    rows.length === 0 ? "No promotion on this order." : status === "pass" ? `${rows.length} promotion line(s), all valid today.`
      : `${rows.filter((r) => r._status !== "pass").length} promotion line(s) not matching a program valid today.`,
    [{ key: "item", label: "Item" }, { key: "type", label: "Type" }, { key: "program", label: "Program" }, { key: "order", label: "On order", align: "right" }, { key: "allowed", label: "Valid today", align: "right" }],
    rows);
}

/**
 * Stock in the order's warehouse, reconciled with the customer's required
 * shelf life, per item:
 *   On hand / Committed  — SAP's QRM_Inventory by Warehouse figures (Committed
 *                          = open SO incl. THIS order + transfer requests +
 *                          production orders).
 *   Committed by others  = Committed − this order's qty.
 *   Available for order  = On hand − Committed by others.
 *   Meets shelf life     = qty of the batches whose remaining shelf life is
 *                          inside the customer's required range (all on-hand
 *                          qty when no rule applies or batches have no dates).
 *   Usable               = the smaller of the two (other orders may take the
 *                          good batches first — SAP doesn't reserve batches).
 * Pass when Ordered ≤ Usable. Each item lists its batches underneath.
 */
async function stockCheck(order: OrderForChecks, lines: OrderLineRow[]): Promise<CheckResult> {
  if (!order.warehouseCode) return result("stock", "warn", "The order has no warehouse — check stock manually.", [], []);
  const need = new Map<string, number>();
  for (const l of lines) need.set(l.sap_item_code, (need.get(l.sap_item_code) ?? 0) + Number(l.quantity));
  const [qrm, shelf] = await Promise.all([
    queryHanaInventoryByWarehouse([order.warehouseCode], undefined, order.sapLines ? { itemCodes: [...need.keys()] } : {}),
    order.sapLines
      ? getLiveAvailability([...need.keys()], order.warehouseCode, {
          sap_cus_grp01: order.customer.cus_grp01, sap_cus_grp02: order.customer.cus_grp02, sap_cus_grp03: order.customer.cus_grp03,
        }, `A${order.docEntry ?? 0}`)
      : getLiveAvailabilityForOrder(order.id, order.warehouseCode),
  ]);
  const qrmBy = new Map(qrm.map((r) => [r.item_code, r]));
  const shelfBy = new Map(shelf.map((x) => [x.sapItemCode, x]));
  const fmtDate = (d: string | null) => (d ? String(d).slice(0, 10) : null);

  const rows: CheckResult["rows"] = [...need.entries()].map(([code, ordered]) => {
    const q = qrmBy.get(code);
    const sh = shelfBy.get(code);
    const onHand = q ? Number(q.on_hand) : 0;
    const committed = q ? Number(q.committed) : 0;
    const committedOthers = Math.max(0, committed - ordered);
    const available = onHand - committedOthers;
    const batches = sh?.batches ?? [];
    const hasRule = !!sh && (sh.requiredShelfLifeFrom !== null || sh.requiredShelfLifeTo !== null);
    const shelfOkQty = batches.length ? batches.filter((b) => b.meetsRequirement).reduce((t, b) => t + b.qty, 0) : onHand;
    const usable = Math.max(0, Math.min(available, shelfOkQty));
    const status: CheckStatus = ordered <= usable ? "pass" : "fail";
    const why = ordered <= usable ? "OK"
      : ordered > available ? `Short ${ordered - Math.max(0, available)}`
      : `Only ${shelfOkQty} meet shelf life`;
    return {
      item: code, ordered, onHand, committedOthers, available,
      required: hasRule ? `${sh!.requiredShelfLifeFrom ?? 0}–${sh!.requiredShelfLifeTo ?? 100} %` : "no rule",
      shelfOkQty, usable, result: why, _status: status,
      _sub: batches.length ? {
        columns: [
          { key: "batch", label: "Batch" }, { key: "qty", label: "Qty", align: "right" as const },
          { key: "mnf", label: "Mfg date" }, { key: "exp", label: "Expiry" },
          { key: "pct", label: "Shelf life", align: "right" as const }, { key: "meets", label: "Meets required" },
        ],
        rows: batches.map((b) => ({
          batch: b.batchNo, qty: b.qty, mnf: fmtDate(b.mnfDate), exp: fmtDate(b.expDate),
          pct: b.shelfLifePct === null ? "—" : `${r2(b.shelfLifePct)} %`,
          meets: b.shelfLifePct === null ? "no dates" : b.meetsRequirement ? "✓ Yes" : "✕ No",
          _status: (b.meetsRequirement ? "pass" : "fail") as CheckStatus,
        })),
      } : undefined,
    };
  });
  const status = worst(rows.map((r) => r._status ?? "pass"));
  const short = rows.filter((r) => n(r.ordered) > n(r.available)).length;
  const badShelf = rows.filter((r) => r._status === "fail" && n(r.ordered) <= n(r.available)).length;
  return result("stock", status,
    status === "pass" ? `All ${rows.length} item(s) covered in warehouse ${order.warehouseCode} by stock that meets the customer's required shelf life.`
      : [short ? `${short} item(s) short of available stock` : "", badShelf ? `${badShelf} item(s) without enough stock meeting the required shelf life` : ""].filter(Boolean).join("; ") + ".",
    [{ key: "item", label: "Item" }, { key: "ordered", label: "Ordered", align: "right" }, { key: "onHand", label: "On hand", align: "right" },
     { key: "committedOthers", label: "Committed by others*", align: "right" }, { key: "available", label: "Available for order", align: "right" },
     { key: "required", label: "Required shelf life" }, { key: "shelfOkQty", label: "Meets shelf life", align: "right" },
     { key: "usable", label: "Usable", align: "right" }, { key: "result", label: "Result" }],
    rows);
}

/**
 * Step 6 — SAP AR aging (QRM_Q504_AR_Aging2) for this customer, as of today:
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
