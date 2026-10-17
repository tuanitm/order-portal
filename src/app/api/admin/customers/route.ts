import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getCustomerApprovalAllowedGroupCodes } from "@/lib/adminScope";

interface CustomerRow {
  id: number;
  email: string | null;
  phone: string | null;
  full_name: string;
  mst_code: string | null;
  sap_card_code: string | null;
  sap_card_name: string | null;
  sap_price_list_num: number | null;
  sap_cus_grp01: string | null;
  sap_cus_grp02: string | null;
  sap_cus_grp03: string | null;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

/**
 * GET /api/admin/customers — List customers with optional filter
 * Query params: status=pending|approved|rejected (default: all)
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdminPermission(request, "customers");
    if (guard.response) return guard.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let sql = `SELECT u.id, u.email, u.phone, u.full_name, u.mst_code, u.sap_card_code, u.sap_card_name,
               u.sap_price_list_num,
               COALESCE(u.sap_cus_grp01, c.cus_grp01) AS sap_cus_grp01,
               COALESCE(u.sap_cus_grp02, c.cus_grp02) AS sap_cus_grp02,
               COALESCE(u.sap_cus_grp03, c.cus_grp03) AS sap_cus_grp03,
               u.approval_status, u.rejection_reason, u.approved_at, u.approved_by, u.created_at
               FROM users u
               LEFT JOIN customers c ON c.sap_card_code = u.sap_card_code`;
    const params: (string | number)[] = [];
    const whereClauses: string[] = [];

    if (status && ["pending", "approved", "rejected"].includes(status)) {
      whereClauses.push("u.approval_status = ?");
      params.push(status);
    }

    // Customer Group scoping:
    // - Super Admin: only customer requests under config.json masterdata.customerGroup (and descendants).
    // - Role Admin: only customer requests under their assigned customer groups (and descendants).
    const allowed = await getCustomerApprovalAllowedGroupCodes(guard.session);
    if (allowed.size === 0) {
      return NextResponse.json({ customers: [] });
    }

    const allowedList = [...allowed];
    const placeholders = allowedList.map(() => "?").join(",");
    const rootPrefixes = allowedList.filter((c) => !allowedList.some((o) => o !== c && c.startsWith(o)));
    const prefixClauses = rootPrefixes.map(() => "u.sap_card_code LIKE ?").join(" OR ");
    const prefixParams = rootPrefixes.map((c) => `${c}%`);

    const scopeSql = `(
      COALESCE(u.sap_cus_grp01, c.cus_grp01) IN (${placeholders}) OR
      COALESCE(u.sap_cus_grp02, c.cus_grp02) IN (${placeholders}) OR
      COALESCE(u.sap_cus_grp03, c.cus_grp03) IN (${placeholders}) OR
      ${prefixClauses}
    )`;
    whereClauses.push(scopeSql);
    params.push(...allowedList, ...allowedList, ...allowedList, ...prefixParams);

    if (whereClauses.length > 0) sql += ` WHERE ${whereClauses.join(" AND ")}`;
    sql += " ORDER BY u.created_at DESC";

    const rows = await query<CustomerRow[]>(sql, params);

    return NextResponse.json({
      customers: Array.isArray(rows) ? rows : [],
    });
  } catch (error) {
    console.error("[API] List customers error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
