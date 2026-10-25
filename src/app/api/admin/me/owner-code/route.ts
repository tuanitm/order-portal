import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getAdminSession } from "@/lib/auth/adminSession";

/**
 * GET/PATCH /api/admin/me/owner-code — self-service Owner Code for the
 * CURRENTLY logged-in admin (any admin, root or role-scoped — not gated by
 * the "admin-users" permission, same universal-capability pattern as
 * /api/admin/me/password). See admin_users.owner_code's own schema comment
 * and SapB1Client.resolveOrderOwner for what this code is matched against
 * (SAP EmployeesInfo.EmployeeCode — Human Resources > Employee Master
 * Data's "Code"/"Employee Code" field) when this admin pushes an order to
 * SAP.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session || !session.adminId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const row = await queryOne<{ owner_code: string | null }>(
    `SELECT owner_code FROM admin_users WHERE company_id = ? AND id = ?`,
    [getCompanyId(), session.adminId]
  );
  return NextResponse.json({ ownerCode: row?.owner_code ?? null });
}

export async function PATCH(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session || !session.adminId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  if (typeof body.ownerCode !== "string") {
    return NextResponse.json({ error: "ownerCode is required" }, { status: 400 });
  }
  const ownerCode = body.ownerCode.trim();
  if (ownerCode.length > 50) {
    return NextResponse.json({ error: "Owner code must be 50 characters or fewer" }, { status: 400 });
  }

  await query(
    `UPDATE admin_users SET owner_code = ? WHERE company_id = ? AND id = ?`,
    [ownerCode || null, getCompanyId(), session.adminId]
  );
  return NextResponse.json({ success: true });
}
