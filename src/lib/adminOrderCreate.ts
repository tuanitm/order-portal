import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import type { AdminSession } from "@/lib/auth/adminSession";
import { getOrderAllowedCustomerGroupCodes, groupScopeClause } from "@/lib/adminScope";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import type { VisibleWarehouse } from "@/lib/warehouseVisibility";
import { getAdminWarehouses } from "@/lib/adminWarehouses";
import {
  resolveHiddenItemCategories,
  buildHiddenCategoryClauses,
  queryPricedProducts,
  type PricingContext,
} from "@/lib/pricing/productPricing";
import type { OrderLineInput } from "@/lib/orderCreate";
import type { ProductWithPricing } from "@/types/product";

/**
 * Server side of the admin "Self create" sales order dialog (Admin → Orders):
 * an admin creates an order on behalf of a SAP customer, priced exactly as
 * that customer would see it on the storefront (same pricing core, same
 * catalog visibility and stock rules), then it follows the normal review
 * flow (status 'submitted' → "Confirm & Push to SAP").
 */

export interface SelfCreateCustomerRow {
  sap_card_code: string;
  card_name: string | null;
  mst_code: string | null;
  price_list_num: number | null;
  cus_grp01: string | null;
  cus_grp02: string | null;
  cus_grp03: string | null;
  phone: string | null;
  email: string | null;
  is_enabled: number;
  bill_to_default: string | null;
  ship_to_default: string | null;
  supervisor_code: string | null;
}

export interface CustomerAddress { name: string; address: string | null }

export interface SelfCreateCustomerDetail {
  customer: SelfCreateCustomerRow;
  billTo: CustomerAddress[];
  shipTo: CustomerAddress[];
  warehouses: VisibleWarehouse[];
  supervisors: { code: string; name: string | null }[];
  /** The customer's approved portal login the order will be attached to, if any. */
  login: { id: number; email: string | null; language: "vi" | "en" } | null;
}

const CUSTOMER_COLS = `c.sap_card_code, c.card_name, c.mst_code, c.price_list_num, c.cus_grp01, c.cus_grp02, c.cus_grp03,
  c.phone, c.email, c.is_enabled, c.bill_to_default, c.ship_to_default, c.supervisor_code`;

async function customerScope(session: AdminSession) {
  const allowed = await getOrderAllowedCustomerGroupCodes(session);
  return groupScopeClause(allowed, ["c.cus_grp01", "c.cus_grp02", "c.cus_grp03"]);
}

/** Customers this admin may create orders for, matching code / name / tax code. */
export async function searchCustomersForAdmin(session: AdminSession, search: string, limit = 20): Promise<SelfCreateCustomerRow[]> {
  const scope = await customerScope(session);
  const like = `%${search.trim()}%`;
  return query<SelfCreateCustomerRow[]>(
    `SELECT ${CUSTOMER_COLS} FROM customers c
      WHERE c.company_id = ? AND ${scope.sql}
        AND (? = '' OR c.sap_card_code LIKE ? OR c.card_name LIKE ? OR c.mst_code LIKE ?)
      ORDER BY (c.sap_card_code = ?) DESC, c.is_enabled DESC, c.sap_card_code
      LIMIT ?`,
    [getCompanyId(), ...scope.params, search.trim(), like, like, like, search.trim(), limit]
  );
}

/** One customer (if in this admin's scope) — null otherwise, so callers answer 404. */
export async function getCustomerForAdmin(session: AdminSession, cardCode: string): Promise<SelfCreateCustomerRow | null> {
  const scope = await customerScope(session);
  return queryOne<SelfCreateCustomerRow>(
    `SELECT ${CUSTOMER_COLS} FROM customers c WHERE c.company_id = ? AND c.sap_card_code = ? AND ${scope.sql}`,
    [getCompanyId(), cardCode, ...scope.params]
  );
}

/**
 * The warehouses an admin may create / push orders from: their own
 * (Admin Users → Warehouse; root = all of masterdata.wareHouse), whatever
 * the customer. Warehouse Visibility only decides which stock customers see.
 */
export async function getOrderWarehouses(session: AdminSession): Promise<VisibleWarehouse[]> {
  return getAdminWarehouses(session);
}

export async function getCustomerDetail(session: AdminSession, customer: SelfCreateCustomerRow): Promise<SelfCreateCustomerDetail> {
  const companyId = getCompanyId();
  const [addresses, warehouses, supervisors, login] = await Promise.all([
    query<{ address_type: "bill_to" | "ship_to"; address_name: string; full_address: string | null }[]>(
      `SELECT address_type, address_name, full_address FROM customer_addresses
        WHERE company_id = ? AND sap_card_code = ? ORDER BY address_name`,
      [companyId, customer.sap_card_code]
    ),
    getOrderWarehouses(session),
    query<{ code: string; name: string | null }[]>(
      `SELECT code, name FROM sales_supervisors WHERE company_id = ? ORDER BY name, code`,
      [companyId]
    ),
    findCustomerLogin(customer.sap_card_code),
  ]);
  const pick = (type: "bill_to" | "ship_to") =>
    addresses.filter((a) => a.address_type === type).map((a) => ({ name: a.address_name, address: a.full_address }));
  return { customer, billTo: pick("bill_to"), shipTo: pick("ship_to"), warehouses, supervisors, login };
}

/**
 * The customer's approved, active portal login (the oldest if there are
 * several). An admin-created order is attached to it so the customer sees
 * it under "My orders", gets its notifications and can accept adjusted
 * quantities; null when the customer has no login.
 */
export async function findCustomerLogin(cardCode: string): Promise<SelfCreateCustomerDetail["login"]> {
  const row = await queryOne<{ id: number; email: string | null; language: string | null }>(
    `SELECT id, email, language FROM users
      WHERE company_id = ? AND sap_card_code = ? AND approval_status = 'approved' AND is_active = TRUE
      ORDER BY id LIMIT 1`,
    [getCompanyId(), cardCode]
  );
  return row ? { id: row.id, email: row.email, language: row.language === "en" ? "en" : "vi" } : null;
}

/**
 * Items priced for `customer`, with Avail Qty from `warehouseCode` only.
 * The same visibility and stock rules as the customer's own storefront apply
 * (hidden item groups, nothing unpriced, nothing with no stock left in that
 * warehouse). Pass `search` for the item picker or `codes` to (re)price
 * specific lines.
 */
export async function priceItemsForCustomer(
  customer: SelfCreateCustomerRow,
  warehouseCode: string,
  { search, codes, limit = 20 }: { search?: string; codes?: string[]; limit?: number }
): Promise<ProductWithPricing[]> {
  const hidden = await resolveHiddenItemCategories(customer.cus_grp01, customer.cus_grp02, customer.cus_grp03);
  const { clauses, params } = buildHiddenCategoryClauses(hidden);
  const ctx: PricingContext = {
    sapCardCode: customer.sap_card_code,
    cusGrp01: customer.cus_grp01 ?? "",
    cusGrp02: customer.cus_grp02 ?? "",
    cusGrp03: customer.cus_grp03 ?? "",
    priceListNum: customer.price_list_num,
    basePriceListNum: await getBasePriceListNum(),
    stockWarehouseCodes: [warehouseCode],
  };
  const extraSql: string[] = [];
  const extraParams: string[] = [];
  if (codes) {
    if (codes.length === 0) return [];
    extraSql.push(`i.sap_item_code IN (${codes.map(() => "?").join(",")})`);
    extraParams.push(...codes);
  } else if (search?.trim()) {
    const like = `%${search.trim()}%`;
    extraSql.push("(i.sap_item_code LIKE ? OR i.item_name_vi LIKE ? OR i.item_name_en LIKE ?)");
    extraParams.push(like, like, like);
  }
  return queryPricedProducts(
    ctx, clauses, params, extraSql, extraParams,
    "ORDER BY (i.sap_item_code = ?) DESC, i.sap_item_code ASC LIMIT ?",
    [search?.trim() ?? "", codes ? codes.length : limit]
  );
}

/** One line as the dialog sends it: what to order, and which programs were picked. */
export interface SelfCreateLineRequest {
  sapItemCode: string;
  quantity: number;
  /** A promotionOptions[].code of the item; omitted = the best match. */
  promotionCode?: string | null;
  /** `${code}::${giveItemCode}` of a giveawayOptions entry; omitted = the best match, "none" = no gift. */
  giveawayKey?: string | null;
}

export const giveawayKeyOf = (o: { code: string | null; giveItemCode: string }) => `${o.code ?? ""}::${o.giveItemCode}`;

/** Free quantity a buy line earns — same rule as the storefront cart (calculateFreeQty). */
export function freeQtyFor(quantity: number, buyQty: number | undefined, giveQty: number | undefined): number {
  if (!buyQty || !giveQty) return 0;
  return Math.floor(quantity / buyQty) * giveQty;
}

/**
 * Turns the dialog's requested lines into order lines, every price computed
 * here from `products` (never taken from the browser): the picked promotion
 * program's % (else the best match), contract + promotion % taken together
 * off the already period-discounted base price — the storefront's own
 * formula — and a 0-priced gift line right after its buy line.
 */
export function buildOrderLines(
  products: ProductWithPricing[],
  requested: SelfCreateLineRequest[]
): { lines: OrderLineInput[]; problems: string[] } {
  const byCode = new Map(products.map((p) => [p.sapItemCode, p]));
  const lines: OrderLineInput[] = [];
  const problems: string[] = [];

  for (const r of requested) {
    const p = byCode.get(r.sapItemCode);
    if (!p) {
      problems.push(`${r.sapItemCode}: not available for this customer in the selected warehouse`);
      continue;
    }
    const quantity = Math.floor(Number(r.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      problems.push(`${r.sapItemCode}: quantity must be a whole number above 0`);
      continue;
    }

    const promo = (r.promotionCode && p.promotionOptions.find((o) => o.code === r.promotionCode)) || p.promotionOptions[0];
    const promoPct = promo ? Number(promo.pct) : 0;
    const combined = p.contractDiscPct + promoPct;
    const unitPrice = Math.max(0, p.basePrice * (1 - combined / 100));
    const giveaway = r.giveawayKey === "none"
      ? undefined
      : (r.giveawayKey && p.giveawayOptions.find((o) => giveawayKeyOf(o) === r.giveawayKey)) || p.giveawayOptions[0];
    const freeQty = giveaway ? freeQtyFor(quantity, giveaway.buyQty, giveaway.giveQty) : 0;
    const name = p.itemNameVi || p.itemNameEn || p.sapItemCode;

    lines.push({
      sapItemCode: p.sapItemCode,
      itemName: name,
      quantity,
      uom: p.uom || "PCS",
      unitPrice,
      originalPrice: p.basePrice,
      discountPercent: unitPrice < p.basePrice ? Math.round(combined) : 0,
      periodDiscPct: p.periodDiscPct,
      contractDiscPct: p.contractDiscPct,
      promoDiscPct: promoPct,
      promotionCode: promo?.code ?? undefined,
      promotionName: promo?.name ?? undefined,
      giveawayCode: freeQty > 0 ? giveaway?.code ?? undefined : undefined,
      giveawayName: freeQty > 0 ? giveaway?.name ?? undefined : undefined,
      ...(freeQty > 0 ? { promoBuyQty: giveaway!.buyQty, promoGiveQty: giveaway!.giveQty } : {}),
    });
    if (freeQty > 0) {
      const sameItem = giveaway!.giveItemCode === p.sapItemCode;
      lines.push({
        sapItemCode: giveaway!.giveItemCode || p.sapItemCode,
        itemName: sameItem ? name : (giveaway!.giveItemName || giveaway!.giveItemCode),
        quantity: freeQty,
        uom: p.uom || "PCS",
        unitPrice: 0,
        originalPrice: 0,
        discountPercent: 0,
        isGift: true,
        sourceSapItemCode: p.sapItemCode,
      });
    }
  }
  return { lines, problems };
}
