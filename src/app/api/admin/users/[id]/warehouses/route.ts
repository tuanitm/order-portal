import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { masterdataWarehouseCodes } from "@/lib/adminWarehouses";
import { logAuditEvent } from "@/lib/auditLog";

/**
 * GET /api/admin/users/[id]/warehouses — warehouse codes assigned to this
 * admin user (see admin_user_warehouses / getAdminWarehouseCodes), plus the
 * masterdata.wareHouse list they may be chosen from.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  const rows = await query<{ warehouse_code: string }[]>(
    `SELECT warehouse_code FROM admin_user_warehouses WHERE company_id = ? AND admin_user_id = ? ORDER BY warehouse_code`,
    [getCompanyId(), adminUserId]
  );
  return NextResponse.json({ codes: rows.map((r) => r.warehouse_code), available: masterdataWarehouseCodes() });
}

/**
 * PUT /api/admin/users/[id]/warehouses — replace this admin's whole set of
 * warehouses (Admin Users page's comma-separated "Warehouse" textbox). Only
 * config.json masterdata.wareHouse codes are accepted. Body: { codes: string[] }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.codes)) {
    return NextResponse.json({ error: "codes (array) is required" }, { status: 400 });
  }
  const codes = [...new Set(body.codes.map((c: unknown) => String(c).trim()).filter(Boolean))] as string[];
  const available = masterdataWarehouseCodes();
  const unknown = codes.filter((c) => !available.includes(c));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "Unknown warehouse code(s)", message: `Not in masterdata.wareHouse: ${unknown.join(", ")} — allowed: ${available.join(", ")}` },
      { status: 400 }
    );
  }

  const companyId = getCompanyId();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM admin_user_warehouses WHERE company_id = ? AND admin_user_id = ?`, [companyId, adminUserId]);
    for (const code of codes) {
      await conn.execute(
        `INSERT INTO admin_user_warehouses (company_id, admin_user_id, warehouse_code) VALUES (?, ?, ?)`,
        [companyId, adminUserId, code]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    console.error("[Admin] Admin user warehouse assignment failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_warehouses", entityType: "admin_user", entityId: adminUserId,
    details: { codes },
    request,
  });
  return NextResponse.json({ success: true, codes });
}
