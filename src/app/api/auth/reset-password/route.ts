import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/auth/reset-password — Reset password after OTP verification
 * Body: { email, newPassword }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, newPassword } = body;

    if (!email || !newPassword) {
      return NextResponse.json(
        { error: "Email and new password are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // TODO: Update password in MySQL
    // const bcrypt = require('bcryptjs');
    // const passwordHash = await bcrypt.hash(newPassword, 12);
    // await query(
    //   'UPDATE users SET password_hash = ? WHERE email = ? AND is_active = TRUE',
    //   [passwordHash, email.toLowerCase().trim()]
    // );

    console.log(`[Auth] Password reset for: ${email}`);

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
