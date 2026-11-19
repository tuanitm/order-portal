import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { logAuditEvent } from "@/lib/auditLog";

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

/**
 * POST /api/auth/reset-password — Reset password after OTP verification.
 * Body: { resetToken, newPassword }. resetToken comes from POST
 * /api/auth/otp/verify (purpose "forgot-password") — it's the proof this
 * email's OTP was actually verified; a bare {email, newPassword} body is
 * deliberately NOT accepted, since that would let anyone reset any
 * account's password with no verification at all.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { resetToken, newPassword } = body;

    if (typeof resetToken !== "string" || typeof newPassword !== "string") {
      return NextResponse.json(
        { error: "resetToken and newPassword are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    let decoded: { email: string; purpose: string };
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET) as { email: string; purpose: string };
    } catch {
      return NextResponse.json(
        { error: "Reset link has expired — please request a new code" },
        { status: 401 }
      );
    }
    if (decoded.purpose !== "password-reset" || !decoded.email) {
      return NextResponse.json({ error: "Invalid reset token" }, { status: 401 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // Same generic response whether or not a row actually matched — never
    // reveal whether a given email is a registered account.
    // Staff live in admin_users, customers in users (an email is unique across both).
    for (const [table, actorType] of [["admin_users", "admin"], ["users", "customer"]] as const) {
      const account = await queryOne<{ id: number; userid: string | null }>(
        `SELECT id, userid FROM ${table} WHERE company_id = ? AND LOWER(email) = LOWER(?) AND is_active = TRUE LIMIT 1`,
        [getCompanyId(), decoded.email]
      );
      if (!account) continue;
      await query(`UPDATE ${table} SET password_hash = ? WHERE company_id = ? AND id = ?`, [passwordHash, getCompanyId(), account.id]);
      await logAuditEvent({
        actorType, actorId: account.id, actorLabel: account.userid || decoded.email,
        action: "password_reset", entityType: actorType === "admin" ? "staff" : "user", entityId: account.id,
        details: { via: "forgot-password OTP" }, request,
      });
      break;
    }

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error) {
    console.error("[API] Reset password error:", error);
    return NextResponse.json(
      { error: "Failed to reset password" },
      { status: 500 }
    );
  }
}
