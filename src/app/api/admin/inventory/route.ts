import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/inventory?itemCode=... — per-warehouse stock for one item
 * (admin's "check why this item is/isn't showing on the storefront" tool).
 * `available` (in_stock - committed) is computed here, same formula as the
 * storefront stock gate in src/app/api/products/route.ts.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "warehouses");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const itemCode = searchParams.get("itemCode")?.trim() || "";
  if (!itemCode) {
    return NextResponse.json({ rows: [] });
  }

  const rows = await query(
    `SELECT iws.warehouse_code, w.warehouse_name, w.is_included,
            iws.in_stock, iws.committed, iws.ordered,
            (iws.in_stock - iws.committed) AS available, iws.last_synced
     FROM item_warehouse_stock iws
     LEFT JOIN warehouses w ON w.sap_warehouse_code = iws.warehouse_code
     WHERE iws.sap_item_code = ?
     ORDER BY w.is_included DESC, available DESC`,
    [itemCode]
  );

  return NextResponse.json({ rows });
}
