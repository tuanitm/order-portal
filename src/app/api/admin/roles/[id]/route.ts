import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission, ALL_ADMIN_PERMISSIONS } from "@/lib/auth/adminSession";

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

  if (typeof body.name === "string") {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (typeof body.description === "string") {
    updates.push("description = ?");
    values.push(body.description.trim() || null);
  }
  if (Array.isArray(body.permissions)) {
    const permissions = body.permissions.filter((p: string) =>
      (ALL_ADMIN_PERMISSIONS as readonly string[]).includes(p)
    );
    updates.push("permissions = ?");
    values.push(JSON.stringify(permissions));
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(String(roleId));
  await query(`UPDATE admin_roles SET ${updates.join(", ")} WHERE id = ?`, values);
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

  const inUse = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM admin_users WHERE role_id = ?`,
    [roleId]
  );
  if (inUse && inUse.cnt > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${inUse.cnt} admin user(s) still assigned to this role` },
      { status: 409 }
    );
  }

  await query(`DELETE FROM admin_roles WHERE id = ?`, [roleId]);
  return NextResponse.json({ success: true });
}
