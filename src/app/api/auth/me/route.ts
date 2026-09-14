import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { queryOne } from "@/lib/db/connection";

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

interface UserRow {
  id: number;
  email: string | null;
  phone: string | null;
  full_name: string;
  sap_card_code: string | null;
  sap_card_name: string | null;
  language: "vi" | "en";
  approval_status: "pending" | "approved" | "rejected";
}

/**
 * GET /api/auth/me — Check current session and return user info
 * Returns 401 if not authenticated
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth-token")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Verify JWT
    let decoded: { userId: number };
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Fetch user from DB
    const user = await queryOne<UserRow>(
      `SELECT id, email, phone, full_name, sap_card_code, sap_card_name, language, approval_status
       FROM users WHERE id = ? AND is_active = TRUE`,
      [decoded.userId]
    );

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.full_name,
        sapCardCode: user.sap_card_code,
        sapCardName: user.sap_card_name,
        language: user.language,
        approvalStatus: user.approval_status,
      },
    });
  } catch (error) {
    console.error("[API] Auth me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
