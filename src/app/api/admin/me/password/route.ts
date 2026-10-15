import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db/connection";
import { getAdminSession } from "@/lib/auth/adminSession";

/**
 * POST /api/admin/me/password — self-service password change for the
 * CURRENTLY logged-in admin (any admin, root or role-scoped — not gated by
 * the "admin-users" permission, which is root-only and about managing
 * other accounts; changing your own password is a different, universal
 * capability). Body: { currentPassword, newPassword }. Requires
 * currentPassword to match, unlike the root-only PATCH on
 * /api/admin/users/[id] which can set any admin's password with no check.
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session || !session.adminId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { currentPassword, newPassword } = await request.json();
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "currentPassword and newPassword are required" }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
  }

  const row = await queryOne<{ password_hash: string }>(
    `SELECT password_hash FROM admin_users WHERE id = ?`,
    [session.adminId]
  );
  if (!row) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const currentValid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!currentValid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE admin_users SET password_hash = ? WHERE id = ?`, [newHash, session.adminId]);

  return NextResponse.json({ success: true });
}
