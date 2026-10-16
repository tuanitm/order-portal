import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { verifyOtp } from "@/lib/auth/otp";

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

/**
 * POST /api/auth/otp/verify — Verify OTP code
 * Body: { email, code, purpose: "signup" | "forgot-password" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, code, purpose, language = "vi" } = body;

    // Validate inputs
    if (!email || !code || !purpose) {
      return NextResponse.json(
        { error: "Email, code, and purpose are required" },
        { status: 400 }
      );
    }

    if (!["signup", "forgot-password"].includes(purpose)) {
      return NextResponse.json(
        { error: "Invalid purpose" },
        { status: 400 }
      );
    }

    // Verify OTP
    const result = verifyOtp(email, code, purpose);

    if (!result.valid) {
      const errorMessages: Record<string, { vi: string; en: string }> = {
        otp_not_found: {
          vi: "Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.",
          en: "OTP code not found or has expired. Please request a new one.",
        },
        otp_expired: {
          vi: "Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.",
          en: "OTP code has expired. Please request a new one.",
        },
        otp_invalid: {
          vi: "Mã OTP không chính xác. Vui lòng thử lại.",
          en: "Invalid OTP code. Please try again.",
        },
        otp_max_attempts: {
          vi: "Đã vượt quá số lần thử. Vui lòng yêu cầu mã mới.",
          en: "Maximum attempts exceeded. Please request a new code.",
        },
        otp_wrong_purpose: {
          vi: "Mã OTP không hợp lệ cho mục đích này.",
          en: "OTP code is not valid for this purpose.",
        },
      };

      const errorKey = result.error || "otp_invalid";
      const msg = errorMessages[errorKey] || errorMessages.otp_invalid;

      return NextResponse.json(
        {
          valid: false,
          error: errorKey,
          message: msg[language as "vi" | "en"] || msg.vi,
        },
        { status: 400 }
      );
    }

    // For forgot-password, issue a short-lived signed token proving THIS
    // email's OTP was just verified — POST /api/auth/reset-password
    // requires it instead of trusting a bare {email, newPassword} body
    // (which would otherwise let anyone reset ANY account's password with
    // no verification at all, since the OTP itself is never sent there).
    const resetToken =
      purpose === "forgot-password"
        ? jwt.sign({ email: email.toLowerCase().trim(), purpose: "password-reset" }, JWT_SECRET, { expiresIn: "10m" })
        : undefined;

    return NextResponse.json({
      valid: true,
      resetToken,
      message:
        language === "vi"
          ? "Xác thực OTP thành công"
          : "OTP verified successfully",
    });
  } catch (error) {
    console.error("[API] Verify OTP error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
