import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited, logAuditEvent } from "@/lib/auditLog";
import { getRoleOptions, listRoles, parseRoleDefinition } from "@/lib/roles";

/** GET /api/admin/roles — every role (with its data permissions and user count) and the options to pick from. */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;
  const [roles, options] = await Promise.all([listRoles(), getRoleOptions()]);
  return NextResponse.json({ roles, options, availablePermissions: options.permissions });
}

/**
 * POST /api/admin/roles — create a role.
 * Body: { name, description?, kind, permissions: string[], scope: { brands, channels, customer_groups, item_groups, warehouses } }
 */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const def = await parseRoleDefinition(body);
  if (!def.ok) return NextResponse.json({ error: def.error }, { status: 400 });

  try {
    const result = await query<{ insertId: number }>(
      `INSERT INTO admin_roles (company_id, name, kind, description, permissions, brands, channels, customer_groups, item_groups, warehouses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [getCompanyId(), name, def.kind, body.description?.trim() || null, JSON.stringify(def.permissions),
       JSON.stringify(def.scope.brands), JSON.stringify(def.scope.channels), JSON.stringify(def.scope.customer_groups),
       JSON.stringify(def.scope.item_groups), JSON.stringify(def.scope.warehouses)]
    );
    const roleId = (result as unknown as { insertId: number }).insertId;
    await logAuditEvent({
      actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
      action: "admin_role_create", entityType: "admin_role", entityId: roleId,
      details: { name, kind: def.kind, permissions: def.permissions, scope: def.scope }, request,
    });
    return NextResponse.json({ success: true, roleId });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });
    throw error;
  }
}

// Failed calls are written to the audit log too (successes log their own detailed entry above).
export const POST = audited({ action: "admin_role_create", entityType: "admin_role", failuresOnly: true }, POSTHandler);
