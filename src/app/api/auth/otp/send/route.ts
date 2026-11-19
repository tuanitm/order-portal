import { NextRequest, NextResponse } from "next/server";
import { isSingleEmail } from "@/lib/emailFormat";
import { storeOtp, canSendOtp } from "@/lib/auth/otp";
import { sendOtpEmail } from "@/lib/email/sender";
import { logAuditEvent } from "@/lib/auditLog";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

/**
 * POST /api/auth/otp/send — Send OTP to email
 * Body: { email, purpose: "signup" | "forgot-password", language?: "vi" | "en" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, purpose, language = "vi" } = body;

    // Validate
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (!isSingleEmail(email.trim())) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    if (!purpose || !["signup", "forgot-password"].includes(purpose)) {
      return NextResponse.json(
        { error: "Purpose must be 'signup' or 'forgot-password'" },
        { status: 400 }
      );
    }

    // Cooldown check
    const cooldown = canSendOtp(email);
    if (!cooldown.allowed) {
      return NextResponse.json(
        {
          error: "otp_cooldown",
          waitSeconds: cooldown.waitSeconds,
          message:
            language === "vi"
              ? `Vui lòng đợi ${cooldown.waitSeconds} giây trước khi gửi lại`
              : `Please wait ${cooldown.waitSeconds} seconds before resending`,
        },
        { status: 429 }
      );
    }

    // Generate and store OTP
    const otp = storeOtp(email, purpose);

    // Send OTP via email
    const sent = await sendOtpEmail(email, otp, purpose, language as "vi" | "en");

    if (!sent) {
      return NextResponse.json(
        {
          error: "email_send_failed",
          message:
            language === "vi"
              ? "Không thể gửi email. Vui lòng thử lại."
              : "Failed to send email. Please try again.",
        },
        { status: 500 }
      );
    }

    if (purpose === "forgot-password") {
      // Staff (admin_users) or customer (users).
      const staff = await queryOne<{ id: number; userid: string | null }>(
        "SELECT id, userid FROM admin_users WHERE company_id = ? AND LOWER(email) = LOWER(?) LIMIT 1", [getCompanyId(), email]
      );
      const account = staff ?? await queryOne<{ id: number; userid: string | null }>(
        "SELECT id, userid FROM users WHERE company_id = ? AND LOWER(email) = LOWER(?) LIMIT 1", [getCompanyId(), email]
      );
      await logAuditEvent({
        actorType: staff ? "admin" : "customer", actorId: account?.id ?? null, actorLabel: account?.userid || email,
        action: "password_reset_requested", entityType: staff ? "staff" : "user", entityId: account?.id ?? null, request,
      });
    }

    return NextResponse.json({
      success: true,
      message:
        language === "vi"
          ? "Mã OTP đã được gửi đến email của bạn"
          : "OTP code has been sent to your email",
    });
  } catch (error) {
    console.error("[API] Send OTP error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
