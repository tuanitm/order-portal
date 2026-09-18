import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/** Allowed sort columns to prevent SQL injection */
const SORT_COLUMNS: Record<string, string> = {
  sap_card_code: "sap_card_code",
  card_name: "card_name",
  mst_code: "mst_code",
  cus_grp01: "cus_grp01",
  price_list_num: "price_list_num",
  phone: "phone",
  account: "account",
};

/**
 * GET /api/admin/sap-customers — the SAP customer master cache
 * (scoped to customer_groups DB table). Distinct from /api/admin/customers,
 * which lists portal-registered accounts and their approval status.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "sap-customers");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const sortKey = searchParams.get("sort") || "sap_card_code";
  const sortDir = searchParams.get("order")?.toUpperCase() === "DESC" ? "DESC" : "ASC";
  const sortCol = SORT_COLUMNS[sortKey] || "sap_card_code";

  const whereClauses: string[] = [];
  const params: string[] = [];
  if (search) {
    whereClauses.push("(card_name LIKE ? OR sap_card_code LIKE ? OR mst_code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM customers ${whereSql}`,
    params
  );
  const total = totalRows[0]?.cnt ?? 0;

  const customers = await query(
    `SELECT id, sap_card_code, card_name, mst_code, price_list_num, cus_grp01, cus_grp02, cus_grp03, phone, email, account, last_synced
     FROM customers ${whereSql}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ customers, total, page, totalPages: Math.ceil(total / limit) });
}
