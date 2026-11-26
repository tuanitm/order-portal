import { getPool, query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import type { AdminSession } from "@/lib/auth/adminSession";
import type { SessionUser } from "@/lib/auth/session";
import type { ProductWithPricing } from "@/types/product";
import { getAllowedBrandCodes } from "@/lib/adminScope";
import { buildOrderLines, priceItemsForCustomer, getOrderWarehouses, type SelfCreateCustomerRow, type SelfCreateLineRequest } from "@/lib/adminOrderCreate";
import { roundOrderLines, orderTotalsOf, insertOrderLines } from "@/lib/orderCreate";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { getVisibleWarehousesForCustomerGroup } from "@/lib/warehouseVisibility";
import { getCustomerRoleScope, customerItemScopeClauses, customerStockWarehouses } from "@/lib/customerRoleScope";
import { resolveHiddenItemCategories, buildHiddenCategoryClauses, queryPricedProducts, type PricingContext } from "@/lib/pricing/productPricing";

/**
 * Order Edit — the full edit of an order that is NOT yet in SAP, for the
 * customer (storefront) and every staff role (Sales, Admin, Accountant,
 * System Admin, within their data permissions):
 *
 *   header  bill-to / ship-to (the customer's SAP addresses), contact phone,
 *           remark — staff also warehouse and Sales Supervisor
 *   lines   change quantity, change the promotion / gift program, add a
 *           SKU, remove a SKU (its free items go with it)
 *
 * Every line is priced again with today's setup — the same engine as
 * checkout and Admin "Create sales order" (price list → period discount →
 * contract + promotion %, free items from the picked or best gift program,
 * built by buildOrderLines). Nothing price-related is taken from the browser.
 *
 * Rules: one order = one brand (a SKU of another brand is refused — the cart
 * splits per brand at checkout); lines already on the order are re-priced
 * even if their stock ran out (staff fix quantities at review), a NEW SKU
 * must pass the same stock / visibility gate as the catalog.
 *
 * Window — never once AR Approved:
 *   customer  draft / submitted / processing, not yet in SAP
 *   staff     also SAP Draft Created and Adm Confirmed (in SAP): the portal
 *             lines are replaced and the order is marked "changes pending"
 *             (sap_outdated_at) until "Update SAP" replaces the SO / Draft
 *             lines (POST .../confirm?mode=update) — the SAP document must
 *             still be open (checked by the route with resolveSapOrderTarget).
 */

export const FULL_EDIT_STATUSES = ["draft", "submitted", "processing"];
/** Staff may also edit orders already in SAP (then Update SAP). */
export const STAFF_FULL_EDIT_STATUSES = [...FULL_EDIT_STATUSES, "sap_draft_created", "approved"];
export type EditMode = "customer" | "staff";
const MAX_LINES = 300;

export interface EditableOrder {
  id: number;
  order_number: string;
  status: string;
  ar_status: string | null;
  sap_doc_entry: number | null;
  user_id: number | null;
  sap_card_code: string | null;
  warehouse_code: string | null;
  bill_to_code: string | null;
  ship_to_code: string | null;
  supervisor_code: string | null;
  remark: string | null;
  contact_phone: string | null;
  grand_total: number;
}

export class OrderEditError extends Error {
  constructor(message: string, public status = 400, public problems?: string[]) { super(message); }
}

/** The order, or null. `userId` limits it to that customer's own orders. */
export async function loadOrderForEdit(orderId: number, userId?: number): Promise<EditableOrder | null> {
  return queryOne<EditableOrder>(
    `SELECT o.id, o.order_number, o.status, o.ar_status, o.sap_doc_entry, o.user_id, COALESCE(o.sap_card_code, u.sap_card_code) AS sap_card_code,
            o.warehouse_code, o.bill_to_code, o.ship_to_code, o.supervisor_code, o.remark, o.contact_phone, o.grand_total
       FROM orders o LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id
      WHERE o.company_id = ? AND o.id = ? ${userId !== undefined ? "AND o.user_id = ?" : ""}`,
    userId !== undefined ? [getCompanyId(), orderId, userId] : [getCompanyId(), orderId]
  );
}

/** Why the order can't be fully edited now (null = it can). */
export function fullEditLock(o: Pick<EditableOrder, "status" | "ar_status" | "sap_doc_entry">, mode: EditMode = "customer"): string | null {
  if (o.ar_status === "approved") return "This order is AR Approved";
  if (mode === "customer" && o.sap_doc_entry) return "This order is already in SAP (Adm Confirmed)";
  if (!(mode === "staff" ? STAFF_FULL_EDIT_STATUSES : FULL_EDIT_STATUSES).includes(o.status)) return `A ${o.status} order can't be edited`;
  return null;
}

/** The order's brand: its buy lines' item brand (an order is one brand). */
export async function orderBrandOf(orderId: number): Promise<string | null> {
  const r = await queryOne<{ b: string | null }>(
    `SELECT i.brand_code AS b FROM order_lines ol JOIN items i ON i.company_id = ol.company_id AND i.sap_item_code = ol.sap_item_code
      WHERE ol.company_id = ? AND ol.order_id = ? AND ol.is_gift_line = 0 AND i.brand_code IS NOT NULL ORDER BY ol.id LIMIT 1`,
    [getCompanyId(), orderId]
  );
  return r?.b ?? null;
}

async function currentBuyLines(orderId: number) {
  return query<{ sap_item_code: string; remark: string | null }[]>(
    `SELECT sap_item_code, remark FROM order_lines WHERE company_id = ? AND order_id = ? AND is_gift_line = 0`, [getCompanyId(), orderId]
  );
}

/**
 * Prices `codes` (re-pricing / saving) or `search` (the item picker) for an
 * edit: codes already on the order skip the stock gate, anything new keeps it.
 */
export type EditPricer = (opts: { codes?: string[]; search?: string }) => Promise<ProductWithPricing[]>;

async function splitByExisting(orderId: number, codes: string[], price: (codes: string[], skipStockGate: boolean) => Promise<ProductWithPricing[]>) {
  const onOrder = new Set((await currentBuyLines(orderId)).map((l) => l.sap_item_code.toUpperCase()));
  const old = codes.filter((c) => onOrder.has(c.toUpperCase()));
  const fresh = codes.filter((c) => !onOrder.has(c.toUpperCase()));
  const [a, b] = await Promise.all([old.length ? price(old, true) : [], fresh.length ? price(fresh, false) : []]);
  return [...a, ...b];
}

/** Staff: the customer's prices with Avail Qty from `warehouse`, within the staff member's brands ∩ the order's brand. */
export async function staffEditPricer(session: AdminSession, orderId: number, customer: SelfCreateCustomerRow, warehouse: string, brand: string | null): Promise<EditPricer> {
  const allowed = getAllowedBrandCodes(session);
  const brands = brand ? new Set(allowed === null || allowed.has(brand) ? [brand] : []) : allowed;
  return async ({ codes, search }) => {
    if (codes) return splitByExisting(orderId, codes, (c, skipStockGate) => priceItemsForCustomer(customer, warehouse, { codes: c, brands, skipStockGate }));
    return priceItemsForCustomer(customer, warehouse, { search: search ?? "", brands });
  };
}

/** Customer: exactly the storefront's prices / visibility / stock warehouses (see api/products/batch), limited to the order's brand. */
export async function customerEditPricer(user: SessionUser, orderId: number, brand: string | null): Promise<EditPricer> {
  const approved = user.approvalStatus === "approved";
  const hidden = buildHiddenCategoryClauses(approved ? await resolveHiddenItemCategories(user.sapCusGrp01, user.sapCusGrp02, user.sapCusGrp03) : []);
  const roleScope = await getCustomerRoleScope(user.id);
  const roleItems = await customerItemScopeClauses(roleScope);
  const clauses = [...hidden.clauses, ...roleItems.clauses];
  const params: (string | number | null)[] = [...hidden.params, ...roleItems.params];
  const visible = await getVisibleWarehousesForCustomerGroup(approved ? user.sapCusGrp02 : null);
  const base: PricingContext = {
    sapCardCode: approved ? user.sapCardCode ?? "" : "",
    cusGrp01: approved ? user.sapCusGrp01 ?? "" : "", cusGrp02: approved ? user.sapCusGrp02 ?? "" : "", cusGrp03: approved ? user.sapCusGrp03 ?? "" : "",
    priceListNum: approved ? user.sapPriceListNum : null,
    basePriceListNum: await getBasePriceListNum(),
    stockWarehouseCodes: customerStockWarehouses(roleScope, visible.map((w) => w.code)),
  };
  const brandSql = brand ? ["i.brand_code = ?"] : [];
  const brandParams = brand ? [brand] : [];
  const run = (extra: string[], extraParams: (string | number | null)[], limit: number, skipStockGate: boolean, first = "") =>
    queryPricedProducts({ ...base, skipStockGate }, clauses, params, [...brandSql, ...extra], [...brandParams, ...extraParams],
      "ORDER BY (i.sap_item_code = ?) DESC, i.sap_item_code ASC LIMIT ?", [first, limit]);
  return async ({ codes, search }) => {
    if (codes) {
      return splitByExisting(orderId, codes, (c, skip) => run([`i.sap_item_code IN (${c.map(() => "?").join(",")})`], c, c.length, skip));
    }
    const q = (search ?? "").trim();
    const like = `%${q}%`;
    return run(q ? ["(i.sap_item_code LIKE ? OR i.item_name_vi LIKE ? OR i.item_name_en LIKE ?)"] : [], q ? [like, like, like] : [], 20, false, q);
  };
}

export interface OrderEditInput {
  billTo?: string | null;
  shipTo?: string | null;
  remark?: string | null;
  contactPhone?: string | null;
  /** Staff only. */
  warehouse?: string | null;
  /** Staff only. */
  supervisor?: string | null;
  lines: SelfCreateLineRequest[];
}

export interface OrderEditResult {
  orderId: number;
  orderNumber: string;
  previousTotal: number;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  buyLines: number;
  giftLines: number;
  added: string[];
  removed: string[];
}

/**
 * Validate, re-price and save an edit: the header, then every line replaced
 * by freshly priced ones (gift lines rebuilt). One transaction.
 */
export async function saveOrderEdit(order: EditableOrder, input: OrderEditInput, opts: {
  pricer: EditPricer;
  staff?: AdminSession;
}): Promise<OrderEditResult> {
  const mode: EditMode = opts.staff ? "staff" : "customer";
  const lock = fullEditLock(order, mode);
  if (lock) throw new OrderEditError(`${lock} — it can no longer be edited here`, 409);
  const companyId = getCompanyId();

  // ── Lines: one per SKU (same SKU twice = quantities added) ──
  const merged = new Map<string, SelfCreateLineRequest>();
  for (const l of Array.isArray(input.lines) ? input.lines : []) {
    const code = String(l?.sapItemCode ?? "").trim();
    if (!code) continue;
    const qty = Math.floor(Number(l.quantity));
    const prev = merged.get(code.toUpperCase());
    if (prev) prev.quantity += qty;
    else merged.set(code.toUpperCase(), { sapItemCode: code, quantity: qty, promotionCode: l.promotionCode ?? null, giveawayKey: l.giveawayKey ?? null });
  }
  const requested = [...merged.values()].filter((l) => l.quantity !== 0);
  if (requested.length === 0) throw new OrderEditError("Keep at least one item on the order — use Cancel Order to cancel it");
  if (requested.length > MAX_LINES) throw new OrderEditError(`At most ${MAX_LINES} items per order`);

  const brand = await orderBrandOf(order.id);
  const products = await opts.pricer({ codes: requested.map((l) => l.sapItemCode) });
  const byCode = new Map(products.map((p) => [p.sapItemCode.toUpperCase(), p]));
  const problems: string[] = [];
  // Not priced because it's another brand (the pricer only returns the order's brand) → say so.
  const missing = requested.filter((l) => !byCode.has(l.sapItemCode.toUpperCase())).map((l) => l.sapItemCode);
  const otherBrand = new Map<string, string>();
  if (brand && missing.length) {
    const rows = await query<{ c: string; b: string | null }[]>(
      `SELECT sap_item_code AS c, brand_code AS b FROM items WHERE company_id = ? AND sap_item_code IN (${missing.map(() => "?").join(",")})`, [companyId, ...missing]
    );
    for (const r of rows) if (r.b && r.b !== brand) otherBrand.set(r.c.toUpperCase(), r.b);
  }
  for (const l of requested) {
    const p = byCode.get(l.sapItemCode.toUpperCase());
    const ob = otherBrand.get(l.sapItemCode.toUpperCase());
    if (ob) { problems.push(`${l.sapItemCode}: brand ${ob} — this order is brand ${brand}; create a new order for it`); continue; }
    if (p) l.sapItemCode = p.sapItemCode; // the item master's own casing
    else continue;
    if (brand && p.brandCode && p.brandCode !== brand) {
      problems.push(`${p.sapItemCode}: brand ${p.brandName || p.brandCode} — this order is brand ${brand}; create a new order for it`);
    }
  }
  const built = buildOrderLines(products, requested.filter((l) => !otherBrand.has(l.sapItemCode.toUpperCase())));
  problems.push(...built.problems);
  if (problems.length) throw new OrderEditError("Some lines can't be saved", 400, problems);

  // Keep each SKU's line remark (Excel Import note) across the edit.
  const before = await currentBuyLines(order.id);
  const remarkOf = new Map(before.filter((l) => l.remark).map((l) => [l.sap_item_code, l.remark!]));
  for (const l of built.lines) if (!l.isGift && remarkOf.has(l.sapItemCode)) l.remark = remarkOf.get(l.sapItemCode)!;
  const rounded = roundOrderLines(built.lines);
  const totals = orderTotalsOf(rounded);

  // ── Header ──
  const sets: string[] = ["subtotal = ?", "discount_total = ?", "grand_total = ?"];
  const values: unknown[] = [totals.subtotal, totals.discountTotal, totals.grandTotal];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); values.push(v); };
  if (input.billTo !== undefined || input.shipTo !== undefined) {
    const addresses = await query<{ address_type: string; address_name: string; full_address: string | null }[]>(
      `SELECT address_type, address_name, full_address FROM customer_addresses WHERE company_id = ? AND sap_card_code = ?`, [companyId, order.sap_card_code]
    );
    const find = (type: string, name: string) => addresses.find((a) => a.address_type === type && a.address_name === name);
    if (input.billTo !== undefined) {
      const a = input.billTo ? find("bill_to", String(input.billTo)) : null;
      if (input.billTo && !a) throw new OrderEditError(`Bill-to address "${input.billTo}" is not one of this customer's addresses`);
      set("bill_to_code", a?.address_name ?? null);
      set("billing_address", a?.full_address ?? null);
    }
    if (input.shipTo !== undefined) {
      const a = input.shipTo ? find("ship_to", String(input.shipTo)) : null;
      if (input.shipTo && !a) throw new OrderEditError(`Ship-to address "${input.shipTo}" is not one of this customer's addresses`);
      set("ship_to_code", a?.address_name ?? null);
      set("delivery_address", a?.full_address ?? null);
    }
  }
  if (input.remark !== undefined) set("remark", String(input.remark ?? "").trim().slice(0, 1000) || null);
  if (input.contactPhone !== undefined) {
    const phone = String(input.contactPhone ?? "").trim().slice(0, 50);
    if (!phone) throw new OrderEditError("Enter a contact phone");
    set("contact_phone", phone);
  }
  set("edited_at", new Date());
  // In SAP already → "changes pending" until Update SAP (same flag as the header / quantity edit).
  if (order.sap_doc_entry) set("sap_outdated_at", new Date());
  if (opts.staff) {
    set("edited_by_admin_id", opts.staff.adminId ?? null);
    if (input.warehouse !== undefined) {
      const wh = String(input.warehouse ?? "").trim();
      if (!wh) throw new OrderEditError("Select a warehouse");
      if (!(await getOrderWarehouses(opts.staff)).some((w) => w.code === wh)) throw new OrderEditError(`Warehouse ${wh} is not one of your warehouses`);
      set("warehouse_code", wh);
    }
    if (input.supervisor !== undefined) {
      const code = input.supervisor ? String(input.supervisor) : null;
      const row = code ? await queryOne<{ code: string; name: string | null }>(`SELECT code, name FROM sales_supervisors WHERE company_id = ? AND code = ?`, [companyId, code]) : null;
      if (code && !row) throw new OrderEditError(`Sales supervisor ${code} not found`);
      set("supervisor_code", row?.code ?? null);
      set("supervisor_name", row?.name ?? null);
    }
  }

  // ── Save (one transaction; the order row is locked so two edits can't interleave) ──
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [locked] = await conn.query(`SELECT status, ar_status, sap_doc_entry FROM orders WHERE company_id = ? AND id = ? FOR UPDATE`, [companyId, order.id]);
    const now = (locked as Pick<EditableOrder, "status" | "ar_status" | "sap_doc_entry">[])[0];
    const lockNow = now ? fullEditLock(now, mode) : "Order not found";
    if (lockNow) throw new OrderEditError(`${lockNow} — it can no longer be edited here`, 409);
    await conn.execute(`DELETE FROM order_lines WHERE company_id = ? AND order_id = ?`, [companyId, order.id]);
    await insertOrderLines(conn, companyId, order.id, rounded);
    await conn.execute(`UPDATE orders SET ${sets.join(", ")} WHERE company_id = ? AND id = ?`, [...values, companyId, order.id] as never[]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const beforeCodes = new Set(before.map((l) => l.sap_item_code));
  const afterCodes = new Set(rounded.filter((l) => !l.isGift).map((l) => l.sapItemCode));
  return {
    orderId: order.id, orderNumber: order.order_number, previousTotal: Number(order.grand_total), ...totals,
    buyLines: afterCodes.size, giftLines: rounded.filter((l) => l.isGift).length,
    added: [...afterCodes].filter((c) => !beforeCodes.has(c)), removed: [...beforeCodes].filter((c) => !afterCodes.has(c)),
  };
}

const vnd = (v: number) => `${new Intl.NumberFormat("vi-VN").format(Math.round(v))}₫`;

/** The note left in the order's message thread after an edit (so the other side sees what changed). */
export function editNote(r: OrderEditResult, who: string, lang: "vi" | "en" = "vi"): string {
  const vi = lang === "vi";
  const parts = [
    vi ? `✎ Đơn hàng đã được ${who} chỉnh sửa.` : `✎ Order edited by ${who}.`,
    `${vi ? "Tổng tiền" : "Total"}: ${vnd(r.previousTotal)} → ${vnd(r.grandTotal)}`,
    r.added.length ? `${vi ? "Thêm" : "Added"}: ${r.added.join(", ")}` : "",
    r.removed.length ? `${vi ? "Bỏ" : "Removed"}: ${r.removed.join(", ")}` : "",
    vi ? "Giá, chiết khấu và khuyến mãi đã được tính lại theo thiết lập hiện tại." : "Prices, discounts and promotions were recalculated with today's setup.",
  ];
  return parts.filter(Boolean).join("\n");
}
