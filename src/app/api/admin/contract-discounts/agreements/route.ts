import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/contract-discounts/agreements — the negotiated contract
 * discount agreements themselves (SAP CBD), as opposed to the resolved
 * per-item SpecialPrices at GET /api/admin/contract-discounts. Optional
 * filters: cardCode/groupCode (matches u_code_cust), includeCanceled,
 * validDate (an agreement is included if this date falls within its own
 * u_valid_from/u_valid_to window).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "contract-discounts");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const custCode = searchParams.get("custCode")?.trim();
  const includeCanceled = searchParams.get("includeCanceled") === "true";
  const validDate = searchParams.get("validDate")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const params: string[] = [];
  if (custCode) {
    whereClauses.push("u_code_cust = ?");
    params.push(custCode);
  }
  if (!includeCanceled) {
    whereClauses.push("canceled != 'Y'");
  }
  if (validDate) {
    whereClauses.push("(u_valid_from IS NULL OR u_valid_from <= ?) AND (u_valid_to IS NULL OR u_valid_to >= ?)");
    params.push(validDate, validDate);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM contract_discount ${whereSql}`,
    params
  );
  const total = totalRows[0]?.cnt ?? 0;

  const agreements = await query(
    `SELECT id, doc_entry, doc_num, line_id, period, status, canceled,
            u_type_cust, u_type_name_cust, u_code_cust, u_name_cust, u_valid_from, u_valid_to,
            u_type_item, u_type_name_item, u_code_item, u_name_item, u_base_disc_pct, last_synced
     FROM contract_discount ${whereSql}
     ORDER BY doc_entry DESC, line_id ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ agreements, total, page, totalPages: Math.ceil(total / limit) });
}
