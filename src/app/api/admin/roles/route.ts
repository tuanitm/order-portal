import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission, ALL_ADMIN_PERMISSIONS, ASSIGNABLE_ADMIN_PERMISSIONS } from "@/lib/auth/adminSession";

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;

  const roles = await query(
    `SELECT id, name, description, permissions, created_at FROM admin_roles WHERE company_id = ? ORDER BY id ASC`,
    [getCompanyId()]
  );
  return NextResponse.json({ roles, availablePermissions: ASSIGNABLE_ADMIN_PERMISSIONS });
}

/** POST /api/admin/roles — create a role. Body: { name, description?, permissions: string[] } */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-roles");
  if (guard.response) return guard.response;

  const body = await request.json();
  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const permissions = Array.isArray(body.permissions)
    ? body.permissions.filter((p: string) => (ALL_ADMIN_PERMISSIONS as readonly string[]).includes(p))
    : [];

  const result = await query<{ insertId: number }>(
    `INSERT INTO admin_roles (company_id, name, description, permissions) VALUES (?, ?, ?, ?)`,
    [getCompanyId(), body.name.trim(), body.description?.trim() || null, JSON.stringify(permissions)]
  );

  return NextResponse.json({ success: true, roleId: (result as unknown as { insertId: number }).insertId });
}
