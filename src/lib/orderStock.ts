import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSapClient } from "@/lib/sap-b1/client";
import { computeBatchShelfLifePct } from "@/lib/sap-b1/sync";

export interface OrderCustomer {
  sap_cus_grp01: string | null;
  sap_cus_grp02: string | null;
  sap_cus_grp03: string | null;
}

interface ItemCategoryRow {
  sap_item_code: string;
  item_cat01: string | null;
  item_cat02: string | null;
  item_cat03: string | null;
  item_cat04: string | null;
  item_cat05: string | null;
  item_cat06: string | null;
}

interface ShelfLifeRule {
  cust_group_code: string;
  item_group_code: string;
  shelf_life_from: number | null;
  shelf_life_to: number | null;
}

export interface LiveItemAvailability {
  sapItemCode: string;
  availableQty: number;
  shelfLifePct: number | null;
  /** The effective required shelf-life % range for this (customer, item) —
   * the intersection of every applicable customer_require_shelflife rule
   * (MAX of their shelf_life_from, MIN of their shelf_life_to), since an
   * item must satisfy ALL applicable rules at once, same as the stock gate
   * above. Null on either side if no applicable rule sets it. Posted onto
   * the SAP line as U_ReqSLFrom/U_ReqSLTo on confirm — see POST
   * .../confirm — regardless of whether the item's current batch actually
   * qualifies (that's availableQty's job, not this one's). */
  requiredShelfLifeFrom: number | null;
  requiredShelfLifeTo: number | null;
  /** Raw SAP figures behind availableQty (OITW OnHand / IsCommited in this warehouse). */
  inStock: number;
  committed: number;
  /** False when at least one batch is outside this customer's required range (those batches are left out of availableQty). */
  shelfLifeOk: boolean;
  /** Every batch in this warehouse (qty > 0), earliest expiry first, checked against the required range. */
  batches: BatchShelfLife[];
}

export interface BatchShelfLife {
  batchNo: string | null;
  qty: number;
  mnfDate: string | null;
  expDate: string | null;
  /** Remaining shelf life % (null when the batch has no manufacture/expiry date). */
  shelfLifePct: number | null;
  /** Inside this customer's required range (true when no rule applies or the dates are missing). */
  meetsRequirement: boolean;
}

/**
 * LIVE (not the cached item_warehouse_stock table) on-hand/committed stock
 * from SAP for every item on one order, in one warehouse, counting only the
 * batches that meet this customer's applicable customer_require_shelflife
 * rules (a batch must pass every applicable rule). Shared by GET .../stock (the admin
 * Order Review page's "Avail Qty" column) and POST .../confirm (the final
 * safety cap right before the SAP push — see that route), so both read
 * the exact same number, computed the exact same way.
 */
export async function getLiveAvailabilityForOrder(
  orderId: number,
  warehouseCode: string
): Promise<LiveItemAvailability[]> {
  const companyId = getCompanyId();
  const customer = await queryOne<OrderCustomer>(
    `SELECT COALESCE(u.sap_cus_grp01, c.cus_grp01) AS sap_cus_grp01,
            COALESCE(u.sap_cus_grp02, c.cus_grp02) AS sap_cus_grp02,
            COALESCE(u.sap_cus_grp03, c.cus_grp03) AS sap_cus_grp03
     FROM orders o
     LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id
     LEFT JOIN customers c ON c.company_id = o.company_id AND c.sap_card_code = COALESCE(o.sap_card_code, u.sap_card_code)
     WHERE o.company_id = ? AND o.id = ?`,
    [companyId, orderId]
  );
  if (!customer) return [];

  const lineItemCodes = await query<{ sap_item_code: string }[]>(
    `SELECT DISTINCT sap_item_code FROM order_lines WHERE company_id = ? AND order_id = ?`,
    [companyId, orderId]
  );
  return getLiveAvailability(lineItemCodes.map((r) => r.sap_item_code), warehouseCode, customer, orderId);
}

/**
 * The same live availability for any list of items and a customer's groups —
 * used for Sales Orders that exist only in SAP (SO Approval). `sqlKey` names
 * the SAP saved queries (one per caller, so parallel callers don't clash).
 */
export async function getLiveAvailability(
  itemCodesIn: string[],
  warehouseCode: string,
  customer: OrderCustomer,
  sqlKey: string | number
): Promise<LiveItemAvailability[]> {
  const companyId = getCompanyId();
  const itemCodes = [...new Set(itemCodesIn.filter(Boolean))];
  if (itemCodes.length === 0) return [];

  const sap = getSapClient();
  const [stockRows, batchRows, categoryRows, rules] = await Promise.all([
    sap.getLiveItemStock(warehouseCode, itemCodes, sqlKey),
    sap.getLiveBatchStock(warehouseCode, itemCodes, sqlKey),
    query<ItemCategoryRow[]>(
      `SELECT sap_item_code, item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06
       FROM items WHERE company_id = ? AND sap_item_code IN (${itemCodes.map(() => "?").join(",")})`,
      [companyId, ...itemCodes]
    ),
    query<ShelfLifeRule[]>(
      `SELECT cust_group_code, item_group_code, shelf_life_from, shelf_life_to
       FROM customer_require_shelflife
       WHERE company_id = ?
         AND cust_group_code IN (?, ?, ?)
         AND (valid_from IS NULL OR valid_from <= CURDATE())
         AND (valid_to IS NULL OR valid_to >= CURDATE())`,
      [companyId, customer.sap_cus_grp01, customer.sap_cus_grp02, customer.sap_cus_grp03]
    ),
  ]);

  // Worst (lowest) remaining-shelf-life % per item, across this warehouse's
  // batches with qty > 0 — same MIN aggregation as syncInventoryStock.
  const shelfLifeByItem = new Map<string, number>();
  for (const b of batchRows) {
    const pct = computeBatchShelfLifePct(b.mnf_date, b.exp_date);
    if (pct === null) continue;
    const existing = shelfLifeByItem.get(b.item_code);
    if (existing === undefined || pct < existing) shelfLifeByItem.set(b.item_code, pct);
  }

  const categoryByItem = new Map(categoryRows.map((r) => [r.sap_item_code, r]));
  const stockByItem = new Map(stockRows.map((r) => [r.item_code, r]));

  return itemCodes.map((sapItemCode) => {
    const stock = stockByItem.get(sapItemCode);
    const inStock = stock ? Number(stock.in_stock) : 0;
    const committed = stock ? Number(stock.committed) : 0;
    const shelfLifePct = shelfLifeByItem.get(sapItemCode) ?? null;

    const cats = categoryByItem.get(sapItemCode);
    const itemGroupCodes = cats
      ? [cats.item_cat01, cats.item_cat02, cats.item_cat03, cats.item_cat04, cats.item_cat05, cats.item_cat06]
      : [];
    const applicableRules = rules.filter((r) => itemGroupCodes.includes(r.item_group_code));

    const froms = applicableRules.map((r) => r.shelf_life_from).filter((v): v is number => v !== null);
    const tos = applicableRules.map((r) => r.shelf_life_to).filter((v): v is number => v !== null);
    const batches: BatchShelfLife[] = batchRows
      .filter((b) => b.item_code === sapItemCode)
      .map((b) => {
        const pct = computeBatchShelfLifePct(b.mnf_date, b.exp_date);
        const meets = pct === null || !applicableRules.some(
          (r) => (r.shelf_life_from !== null && pct < r.shelf_life_from) || (r.shelf_life_to !== null && pct > r.shelf_life_to)
        );
        return { batchNo: b.batch_no ?? null, qty: Number(b.qty), mnfDate: b.mnf_date, expDate: b.exp_date, shelfLifePct: pct, meetsRequirement: meets };
      });

    // Avail Qty = only stock that meets this customer's required shelf life:
    // the smaller of (OnHand - Committed) and the qty of the batches inside the
    // required range. With no applicable rule, or an item without batches, it is
    // simply OnHand - Committed. Batches without dates count as meeting the rule.
    const free = Math.max(0, inStock - committed);
    const qualifyingQty = batches.filter((b) => b.meetsRequirement).reduce((t, b) => t + b.qty, 0);
    const limitedByShelfLife = applicableRules.length > 0 && batches.length > 0;
    const availableQty = limitedByShelfLife ? Math.min(free, qualifyingQty) : free;

    return {
      sapItemCode,
      availableQty,
      inStock,
      committed,
      shelfLifeOk: batches.every((b) => b.meetsRequirement),
      batches,
      shelfLifePct,
      requiredShelfLifeFrom: froms.length > 0 ? Math.max(...froms) : null,
      requiredShelfLifeTo: tos.length > 0 ? Math.min(...tos) : null,
    };
  });
}
