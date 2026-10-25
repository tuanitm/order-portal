import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
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
  registration_address: string | null;
  registration_shipping_address: string | null;
  registration_remark: string | null;
  registration_contact_person: string | null;
  declared_region_code: string | null;
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
               u.registration_address, u.registration_shipping_address, u.registration_remark,
               u.registration_contact_person, u.declared_region_code,
               u.approval_status, u.rejection_reason, u.approved_at, u.approved_by, u.created_at
               FROM users u
               LEFT JOIN customers c ON c.company_id = u.company_id AND c.sap_card_code = u.sap_card_code`;
    const companyId = getCompanyId();
    const params: (string | number)[] = [companyId];
    const whereClauses: string[] = ["u.company_id = ?"];

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

    // Each clause paired with its own params, in order, so there's no risk
    // of a clause/param mismatch when clauses are added conditionally below.
    const scopeClauses: { sql: string; params: (string | number)[] }[] = [
      { sql: `COALESCE(u.sap_cus_grp01, c.cus_grp01) IN (${placeholders})`, params: allowedList },
      { sql: `COALESCE(u.sap_cus_grp02, c.cus_grp02) IN (${placeholders})`, params: allowedList },
      { sql: `COALESCE(u.sap_cus_grp03, c.cus_grp03) IN (${placeholders})`, params: allowedList },
      ...rootPrefixes.map((c) => ({ sql: "u.sap_card_code LIKE ?", params: [`${c}%`] })),
    ];

    // A brand-new-company registration (see create-bp/route.ts) has no
    // REAL group signal at all yet — no sap_card_code to prefix-match and
    // no cus_grp0X anywhere — so it can't match any clause above. Root
    // sees all of these; a non-root admin only sees one whose customer's
    // self-declared (unverified) region falls within their own scope —
    // same rule as isCustomerInApprovalScope.
    const ungrouped = `(
      COALESCE(u.sap_cus_grp01, c.cus_grp01) IS NULL AND
      COALESCE(u.sap_cus_grp02, c.cus_grp02) IS NULL AND
      COALESCE(u.sap_cus_grp03, c.cus_grp03) IS NULL AND
      u.sap_card_code IS NULL
    )`;
    if (guard.session.isSuperAdmin) {
      scopeClauses.push({ sql: ungrouped, params: [] });
    } else {
      scopeClauses.push({ sql: `(${ungrouped} AND u.declared_region_code IN (${placeholders}))`, params: allowedList });
    }

    whereClauses.push(`(${scopeClauses.map((c) => c.sql).join(" OR ")})`);
    params.push(...scopeClauses.flatMap((c) => c.params));

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
