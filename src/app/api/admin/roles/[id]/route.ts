import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission, type RoleKind } from "@/lib/auth/adminSession";
import { audited, logAuditEvent } from "@/lib/auditLog";
import { parseRoleDefinition } from "@/lib/roles";

/**
 * PATCH /api/admin/roles/[id] — Body: { name?, description?, kind, permissions, scope } (kind/permissions/scope as in POST).
 * A role's kind can't change while users hold it (their accounts were set up for that kind — e.g. customers need a SAP code).
 */
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;

  const { id } = await params;
  const roleId = parseInt(id, 10);
  if (isNaN(roleId)) return NextResponse.json({ error: "Invalid role ID" }, { status: 400 });
  const companyId = getCompanyId();
  const current = await queryOne<{ kind: RoleKind; name: string }>(`SELECT kind, name FROM admin_roles WHERE company_id = ? AND id = ?`, [companyId, roleId]);
  if (!current) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const body = await request.json();
  const def = await parseRoleDefinition({ ...body, kind: body.kind ?? current.kind });
  if (!def.ok) return NextResponse.json({ error: def.error }, { status: 400 });

  if (def.kind !== current.kind) {
    const users = await queryOne<{ cnt: number }>(`SELECT (SELECT COUNT(*) FROM users WHERE company_id = ? AND role_id = ?) + (SELECT COUNT(*) FROM admin_users WHERE company_id = ? AND role_id = ?) AS cnt`, [companyId, roleId, companyId, roleId]);
    if (users && users.cnt > 0) {
      return NextResponse.json({ error: `Can't change the role type while ${users.cnt} user(s) hold this role — move them to another role first` }, { status: 409 });
    }
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
  try {
    await query(
      `UPDATE admin_roles SET name = ?, description = ?, kind = ?, permissions = ?, brands = ?, channels = ?, customer_groups = ?, item_groups = ?, warehouses = ?
        WHERE company_id = ? AND id = ?`,
      [name, typeof body.description === "string" ? body.description.trim() || null : null, def.kind, JSON.stringify(def.permissions),
       JSON.stringify(def.scope.brands), JSON.stringify(def.scope.channels), JSON.stringify(def.scope.customer_groups),
       JSON.stringify(def.scope.item_groups), JSON.stringify(def.scope.warehouses), companyId, roleId]
    );
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });
    throw error;
  }
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_role_update", entityType: "admin_role", entityId: roleId,
    details: { name, kind: def.kind, permissions: def.permissions, scope: def.scope }, request,
  });
  return NextResponse.json({ success: true });
}

/** DELETE /api/admin/roles/[id] — refused while any user holds it. */
async function DELETEHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;

  const { id } = await params;
  const roleId = parseInt(id, 10);
  if (isNaN(roleId)) return NextResponse.json({ error: "Invalid role ID" }, { status: 400 });

  const companyId = getCompanyId();
  const inUse = await queryOne<{ cnt: number }>(`SELECT (SELECT COUNT(*) FROM users WHERE company_id = ? AND role_id = ?) + (SELECT COUNT(*) FROM admin_users WHERE company_id = ? AND role_id = ?) AS cnt`, [companyId, roleId, companyId, roleId]);
  if (inUse && inUse.cnt > 0) {
    return NextResponse.json({ error: `Cannot delete: ${inUse.cnt} user(s) still assigned to this role` }, { status: 409 });
  }

  const target = await queryOne<{ name: string }>(`SELECT name FROM admin_roles WHERE company_id = ? AND id = ?`, [companyId, roleId]);
  await query(`DELETE FROM admin_roles WHERE company_id = ? AND id = ?`, [companyId, roleId]);
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_role_delete", entityType: "admin_role", entityId: roleId,
    details: { name: target?.name ?? null }, request,
  });
  return NextResponse.json({ success: true });
}

// Failed calls are written to the audit log too (successes log their own detailed entry above).
export const PATCH = audited({ action: "admin_role_update", entityType: "admin_role", entityParam: "id", failuresOnly: true }, PATCHHandler);
export const DELETE = audited({ action: "admin_role_delete", entityType: "admin_role", entityParam: "id", failuresOnly: true }, DELETEHandler);
