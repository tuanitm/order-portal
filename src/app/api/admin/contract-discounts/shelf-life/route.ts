import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/contract-discounts/shelf-life — cached
 * `customer_require_shelflife` rows (synced from SAP CSL — see
 * syncCustomerRequiredShelfLife). Optional ?custGroupCode= filter.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "contract-discounts");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const custGroupCode = searchParams.get("custGroupCode")?.trim() || "";

  const whereClauses: string[] = [];
  const params: string[] = [];
  if (custGroupCode) {
    whereClauses.push("cust_group_code = ?");
    params.push(custGroupCode);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const rows = await query(
    `SELECT doc_entry, cust_group_code, cust_group_name, valid_from, valid_to,
            item_group_code, item_group_name, shelf_life_from, shelf_life_to, last_synced
     FROM customer_require_shelflife
     ${whereSql}
     ORDER BY cust_group_code ASC, item_group_code ASC`,
    params
  );

  return NextResponse.json({ rows });
}
