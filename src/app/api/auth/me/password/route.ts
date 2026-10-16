import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db/connection";
import { getSessionUser } from "@/lib/auth/session";

/**
 * POST /api/auth/me/password — self-service password change for the
 * currently logged-in customer. Body: { currentPassword, newPassword }.
 * Requires currentPassword to match — same pattern as the admin side's own
 * POST /api/admin/me/password.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
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
    `SELECT password_hash FROM users WHERE id = ?`,
    [user.id]
  );
  if (!row) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const currentValid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!currentValid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);

  return NextResponse.json({ success: true });
}
