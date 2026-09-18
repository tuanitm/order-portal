import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const users = await query(
    `SELECT au.id, au.email, au.full_name, au.is_active, au.created_at,
            ar.id AS role_id, ar.name AS role_name
     FROM admin_users au
     JOIN admin_roles ar ON ar.id = au.role_id
     ORDER BY au.created_at DESC`
  );
  return NextResponse.json({ adminUsers: users });
}

/**
 * POST /api/admin/users — create an admin user. Requires super-admin (the
 * config.json bootstrap credential), not just the "admin-users" permission,
 * since a role-scoped admin creating other admins could otherwise escalate
 * privileges by assigning a more powerful role.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only the super-admin can create admin users" }, { status: 403 });
  }

  const body = await request.json();
  const { email, password, fullName, roleId } = body;
  if (!email || !password || !fullName || !roleId) {
    return NextResponse.json({ error: "email, password, fullName, roleId are required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await query<{ insertId: number }>(
      `INSERT INTO admin_users (email, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)`,
      [email.trim().toLowerCase(), passwordHash, fullName.trim(), roleId]
    );
    return NextResponse.json({
      success: true,
      adminUserId: (result as unknown as { insertId: number }).insertId,
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    console.error("[Admin] Create admin user failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
