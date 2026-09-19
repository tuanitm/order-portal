import { NextRequest, NextResponse } from "next/server";
import { isHttpsRequest } from "@/lib/auth/cookies";
import { queryOne } from "@/lib/db/connection";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

interface UserRow {
  id: number;
  email: string | null;
  phone: string | null;
  full_name: string;
  mst_code: string | null;
  sap_card_code: string | null;
  sap_card_name: string | null;
  password_hash: string;
  language: "vi" | "en";
  is_active: boolean;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
}

/**
 * POST /api/auth/login — Authenticate user
 * Body: { identifier: string, password: string }
 * identifier can be email, phone, or MST code
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier, password } = body;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Identifier and password are required" },
        { status: 400 }
      );
    }

    const value = identifier.trim();

    // Determine identifier type and find user
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9]{9,15}$/;

    let sql: string;
    if (emailRegex.test(value)) {
      sql = "SELECT * FROM users WHERE email = ? LIMIT 1";
    } else if (phoneRegex.test(value.replace(/[+\-\s()]/g, ""))) {
      sql = "SELECT * FROM users WHERE phone = ? LIMIT 1";
    } else {
      sql = "SELECT * FROM users WHERE mst_code = ? LIMIT 1";
    }

    const user = await queryOne<UserRow>(sql, [value]);

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Check if account is active
    if (!user.is_active) {
      return NextResponse.json(
        { error: "Account is disabled" },
        { status: 403 }
      );
    }

    // Check approval status
    if (user.approval_status === "pending") {
      return NextResponse.json(
        {
          error: "pending_approval",
          message: "Account is pending admin approval",
        },
        { status: 403 }
      );
    }

    if (user.approval_status === "rejected") {
      return NextResponse.json(
        {
          error: "account_rejected",
          message: "Account registration was rejected",
          reason: user.rejection_reason || "",
        },
        { status: 403 }
      );
    }

    // Check the linked SAP customer's Enable toggle (admin > SAP Customers)
    if (user.sap_card_code) {
      const customer = await queryOne<{ is_enabled: number }>(
        "SELECT is_enabled FROM customers WHERE sap_card_code = ? LIMIT 1",
        [user.sap_card_code]
      );
      if (customer && !customer.is_enabled) {
        return NextResponse.json(
          {
            error: "This account was blocked, please contact Admin 0908404678 to enable account again.",
          },
          { status: 403 }
        );
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set token as HTTP-only cookie
    const response = NextResponse.json({
      success: true,
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

    response.cookies.set("auth-token", token, {
      httpOnly: true,
      secure: isHttpsRequest(request),
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[API] Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
