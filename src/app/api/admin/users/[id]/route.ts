import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/** PATCH /api/admin/users/[id] — Body: { fullName?, roleId?, isActive?, password? } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  const body = await request.json();
  const updates: string[] = [];
  const values: (string | number | boolean)[] = [];

  if (typeof body.fullName === "string") {
    updates.push("full_name = ?");
    values.push(body.fullName.trim());
  }
  if (typeof body.roleId === "number") {
    if (!guard.session.isSuperAdmin) {
      return NextResponse.json({ error: "Only the super-admin can change roles" }, { status: 403 });
    }
    updates.push("role_id = ?");
    values.push(body.roleId);
  }
  if (typeof body.isActive === "boolean") {
    updates.push("is_active = ?");
    values.push(body.isActive);
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    updates.push("password_hash = ?");
    values.push(await bcrypt.hash(body.password, 12));
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(adminUserId);
  await query(`UPDATE admin_users SET ${updates.join(", ")} WHERE id = ?`, values);
  return NextResponse.json({ success: true });
}

/** DELETE /api/admin/users/[id] — requires super-admin. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only the super-admin can delete admin users" }, { status: 403 });
  }

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  await query(`DELETE FROM admin_users WHERE id = ?`, [adminUserId]);
  return NextResponse.json({ success: true });
}
