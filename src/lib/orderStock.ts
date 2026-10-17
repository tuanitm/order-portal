import { query, queryOne } from "@/lib/db/connection";
import { getSapClient } from "@/lib/sap-b1/client";
import { computeBatchShelfLifePct } from "@/lib/sap-b1/sync";

interface OrderCustomer {
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
}

/**
 * LIVE (not the cached item_warehouse_stock table) on-hand/committed stock
 * from SAP for every item on one order, in one warehouse, gated by this
 * customer's applicable customer_require_shelflife rules — same
 * any-matching-rule-must-pass semantics as the storefront's stock gate
 * (src/app/api/products/route.ts). Shared by GET .../stock (the admin
 * Order Review page's "Avail Qty" column) and POST .../confirm (the final
 * safety cap right before the SAP push — see that route), so both read
 * the exact same number, computed the exact same way.
 */
export async function getLiveAvailabilityForOrder(
  orderId: number,
  warehouseCode: string
): Promise<LiveItemAvailability[]> {
  const customer = await queryOne<OrderCustomer>(
    `SELECT COALESCE(u.sap_cus_grp01, c.cus_grp01) AS sap_cus_grp01,
            COALESCE(u.sap_cus_grp02, c.cus_grp02) AS sap_cus_grp02,
            COALESCE(u.sap_cus_grp03, c.cus_grp03) AS sap_cus_grp03
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     LEFT JOIN customers c ON c.sap_card_code = u.sap_card_code
     WHERE o.id = ?`,
    [orderId]
  );
  if (!customer) return [];

  const lineItemCodes = await query<{ sap_item_code: string }[]>(
    `SELECT DISTINCT sap_item_code FROM order_lines WHERE order_id = ?`,
    [orderId]
  );
  const itemCodes = lineItemCodes.map((r) => r.sap_item_code);
  if (itemCodes.length === 0) return [];

  const sap = getSapClient();
  const [stockRows, batchRows, categoryRows, rules] = await Promise.all([
    sap.getLiveItemStock(warehouseCode, itemCodes, orderId),
    sap.getLiveBatchStock(warehouseCode, itemCodes, orderId),
    query<ItemCategoryRow[]>(
      `SELECT sap_item_code, item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06
       FROM items WHERE sap_item_code IN (${itemCodes.map(() => "?").join(",")})`,
      itemCodes
    ),
    query<ShelfLifeRule[]>(
      `SELECT cust_group_code, item_group_code, shelf_life_from, shelf_life_to
       FROM customer_require_shelflife
       WHERE cust_group_code IN (?, ?, ?)
         AND (valid_from IS NULL OR valid_from <= CURDATE())
         AND (valid_to IS NULL OR valid_to >= CURDATE())`,
      [customer.sap_cus_grp01, customer.sap_cus_grp02, customer.sap_cus_grp03]
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

    let qualifies = true;
    if (shelfLifePct !== null) {
      const violatesAnApplicableRule = applicableRules.some(
        (r) =>
          (r.shelf_life_from !== null && shelfLifePct < r.shelf_life_from) ||
          (r.shelf_life_to !== null && shelfLifePct > r.shelf_life_to)
      );
      qualifies = !violatesAnApplicableRule;
    }

    const froms = applicableRules.map((r) => r.shelf_life_from).filter((v): v is number => v !== null);
    const tos = applicableRules.map((r) => r.shelf_life_to).filter((v): v is number => v !== null);

    return {
      sapItemCode,
      availableQty: qualifies ? inStock - committed : 0,
      shelfLifePct,
      requiredShelfLifeFrom: froms.length > 0 ? Math.max(...froms) : null,
      requiredShelfLifeTo: tos.length > 0 ? Math.min(...tos) : null,
    };
  });
}
