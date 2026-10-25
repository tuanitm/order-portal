import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/warehouses — cached warehouse list (synced from SAP
 * /Warehouses — see syncWarehouses), with `is_included` (the admin's own
 * choice of whether this warehouse's stock counts toward an item's
 * storefront availability).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "warehouses");
  if (guard.response) return guard.response;

  const warehouses = await query(
    `SELECT sap_warehouse_code, warehouse_name, is_inactive_in_sap, is_included, last_synced
     FROM warehouses
     WHERE company_id = ?
     ORDER BY warehouse_name ASC`,
    [getCompanyId()]
  );

  return NextResponse.json({ warehouses });
}
