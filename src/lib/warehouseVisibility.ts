import { query } from "@/lib/db/connection";

export interface VisibleWarehouse {
  code: string;
  name: string | null;
}

/**
 * The warehouses that count for a customer's own stock visibility — their
 * level-2 customer group's mapping in `customer_group_warehouses` (set on
 * the Catalog Visibility page) if any, otherwise every warehouse marked
 * Included on the Warehouses admin page. Same fail-open fallback as the
 * storefront's stock gate (see the stock-gate comment in
 * src/app/api/products/route.ts) — an unmapped group never loses
 * visibility, it just falls back to the Included set.
 *
 * Shared by that stock gate and the admin Order Review page's warehouse
 * dropdown ("Warehouse Visibility"), so both always resolve to the exact
 * same set for a given customer.
 */
export async function getVisibleWarehousesForCustomerGroup(
  cusGrp02: string | null
): Promise<VisibleWarehouse[]> {
  const included = await query<{ sap_warehouse_code: string; warehouse_name: string | null }[]>(
    `SELECT sap_warehouse_code, warehouse_name FROM warehouses WHERE is_included = TRUE`
  );
  if (included.length === 0) return [];

  if (cusGrp02) {
    const mapped = await query<{ warehouse_code: string; warehouse_name: string | null }[]>(
      `SELECT cgw.warehouse_code, w.warehouse_name
       FROM customer_group_warehouses cgw
       JOIN customer_groups cg ON cg.id = cgw.customer_group_id
       LEFT JOIN warehouses w ON w.sap_warehouse_code = cgw.warehouse_code
       WHERE cg.level = 2 AND cg.code = ?`,
      [cusGrp02]
    );
    if (mapped.length > 0) {
      return mapped.map((m) => ({ code: m.warehouse_code, name: m.warehouse_name }));
    }
  }

  return included.map((w) => ({ code: w.sap_warehouse_code, name: w.warehouse_name }));
}
