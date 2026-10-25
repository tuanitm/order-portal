import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission, ASSIGNABLE_ADMIN_PERMISSIONS } from "@/lib/auth/adminSession";
import { logAuditEvent } from "@/lib/auditLog";

/** PATCH /api/admin/roles/[id] — Body: { name?, description?, permissions?: string[] } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;

  const { id } = await params;
  const roleId = parseInt(id, 10);
  if (isNaN(roleId)) return NextResponse.json({ error: "Invalid role ID" }, { status: 400 });

  const body = await request.json();
  const updates: string[] = [];
  const values: (string | null)[] = [];
  const changedFields: string[] = [];

  if (typeof body.name === "string") {
    updates.push("name = ?");
    values.push(body.name.trim());
    changedFields.push("name");
  }
  if (typeof body.description === "string") {
    updates.push("description = ?");
    values.push(body.description.trim() || null);
    changedFields.push("description");
  }
  if (Array.isArray(body.permissions)) {
    // Filtered against the ASSIGNABLE subset — see POST /api/admin/roles'
    // own comment on why root-only permissions never belong in a role's
    // permissions JSON at all, even though hasPermission() already ignores
    // role data for them.
    const permissions = body.permissions.filter((p: string) =>
      (ASSIGNABLE_ADMIN_PERMISSIONS as readonly string[]).includes(p)
    );
    updates.push("permissions = ?");
    values.push(JSON.stringify(permissions));
    changedFields.push("permissions");
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(getCompanyId(), String(roleId));
  await query(`UPDATE admin_roles SET ${updates.join(", ")} WHERE company_id = ? AND id = ?`, values);
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_role_update", entityType: "admin_role", entityId: roleId,
    details: { changedFields },
    request,
  });
  return NextResponse.json({ success: true });
}

/** DELETE /api/admin/roles/[id] — refused if any admin_users still reference it. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;

  const { id } = await params;
  const roleId = parseInt(id, 10);
  if (isNaN(roleId)) return NextResponse.json({ error: "Invalid role ID" }, { status: 400 });

  const companyId = getCompanyId();
  const inUse = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM admin_users WHERE company_id = ? AND role_id = ?`,
    [companyId, roleId]
  );
  if (inUse && inUse.cnt > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${inUse.cnt} admin user(s) still assigned to this role` },
      { status: 409 }
    );
  }

  const target = await queryOne<{ name: string }>(`SELECT name FROM admin_roles WHERE company_id = ? AND id = ?`, [companyId, roleId]);
  await query(`DELETE FROM admin_roles WHERE company_id = ? AND id = ?`, [companyId, roleId]);
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_role_delete", entityType: "admin_role", entityId: roleId,
    details: { name: target?.name ?? null },
    request,
  });
  return NextResponse.json({ success: true });
}
