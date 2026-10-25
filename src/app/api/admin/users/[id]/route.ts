import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { logAuditEvent } from "@/lib/auditLog";

/**
 * PATCH /api/admin/users/[id] — Body: { fullName?, email?, roleId?, isActive?, password? }
 * A root row (is_root=TRUE) has no role, so `roleId` is rejected for it;
 * `isActive: false` is rejected if it's the last active root — never let an
 * action lock every root account out.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  const companyId = getCompanyId();
  const target = await queryOne<{ is_root: number; email: string }>(`SELECT is_root, email FROM admin_users WHERE company_id = ? AND id = ?`, [companyId, adminUserId]);
  if (!target) return NextResponse.json({ error: "Admin user not found" }, { status: 404 });

  const body = await request.json();
  const updates: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  const changedFields: string[] = [];

  if (typeof body.fullName === "string") {
    updates.push("full_name = ?");
    values.push(body.fullName.trim());
    changedFields.push("fullName");
  }
  if (typeof body.email === "string" && body.email.trim()) {
    updates.push("email = ?");
    values.push(body.email.trim().toLowerCase());
    changedFields.push("email");
  }
  if (typeof body.roleId === "number") {
    if (!guard.session.isSuperAdmin) {
      return NextResponse.json({ error: "Only root can change roles" }, { status: 403 });
    }
    if (target.is_root) {
      return NextResponse.json({ error: "Root has no role to change" }, { status: 400 });
    }
    updates.push("role_id = ?");
    values.push(body.roleId);
    changedFields.push("roleId");
  }
  if (typeof body.isActive === "boolean") {
    if (target.is_root && !body.isActive) {
      const activeRoots = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM admin_users WHERE company_id = ? AND is_root = TRUE AND is_active = TRUE AND id != ?`,
        [companyId, adminUserId]
      );
      if ((activeRoots?.cnt ?? 0) === 0) {
        return NextResponse.json({ error: "Cannot deactivate the last active root account" }, { status: 400 });
      }
    }
    updates.push("is_active = ?");
    values.push(body.isActive);
    changedFields.push(body.isActive ? "activated" : "deactivated");
  }
  if (typeof body.departmentCode === "string") {
    updates.push("department_code = ?");
    values.push(body.departmentCode.trim() || null);
    changedFields.push("departmentCode");
  }
  if (typeof body.ownerCode === "string") {
    const ownerCode = body.ownerCode.trim();
    if (ownerCode.length > 50) {
      return NextResponse.json({ error: "Owner code must be 50 characters or fewer" }, { status: 400 });
    }
    updates.push("owner_code = ?");
    values.push(ownerCode || null);
    changedFields.push("ownerCode");
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    updates.push("password_hash = ?");
    values.push(await bcrypt.hash(body.password, 12));
    changedFields.push("password");
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(companyId, adminUserId);
  try {
    await query(`UPDATE admin_users SET ${updates.join(", ")} WHERE company_id = ? AND id = ?`, values);
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    console.error("[Admin] Update admin user failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_update", entityType: "admin_user", entityId: adminUserId,
    details: { targetEmail: target.email, changedFields },
    request,
  });
  return NextResponse.json({ success: true });
}

/** DELETE /api/admin/users/[id] — requires root. A root row can never be deleted this way. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only root can delete admin users" }, { status: 403 });
  }

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  const companyId = getCompanyId();
  const target = await queryOne<{ is_root: number; email: string }>(`SELECT is_root, email FROM admin_users WHERE company_id = ? AND id = ?`, [companyId, adminUserId]);
  if (target?.is_root) {
    return NextResponse.json({ error: "A root account cannot be deleted here" }, { status: 400 });
  }

  await query(`DELETE FROM admin_users WHERE company_id = ? AND id = ?`, [companyId, adminUserId]);
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_delete", entityType: "admin_user", entityId: adminUserId,
    details: { targetEmail: target?.email ?? null },
    request,
  });
  return NextResponse.json({ success: true });
}
