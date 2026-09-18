import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

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

    let sql = `SELECT id, email, phone, full_name, mst_code, sap_card_code, sap_card_name,
               sap_price_list_num, sap_cus_grp01, sap_cus_grp02, sap_cus_grp03,
               approval_status, rejection_reason, approved_at, approved_by, created_at
               FROM users`;
    const params: string[] = [];

    if (status && ["pending", "approved", "rejected"].includes(status)) {
      sql += " WHERE approval_status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC";

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
