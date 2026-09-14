import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";

interface CustomerRow {
  id: number;
  email: string | null;
  phone: string | null;
  full_name: string;
  mst_code: string | null;
  sap_card_code: string | null;
  sap_card_name: string | null;
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
    // Simple admin auth check via cookie
    const adminToken = request.cookies.get("admin-token")?.value;
    if (!adminToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let sql = `SELECT id, email, phone, full_name, mst_code, sap_card_code, sap_card_name,
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
