import { NextRequest, NextResponse } from "next/server";
import { isHttpsRequest } from "@/lib/auth/cookies";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
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
    const { identifier, password, rememberMe } = body;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Identifier and password are required" },
        { status: 400 }
      );
    }

    const value = identifier.trim();
    const normalizedPhone = value.replace(/[+\-\s()]/g, "");
    const normalizedEmail = value.toLowerCase();

    // Scan all three columns in one query rather than pre-guessing which
    // one the identifier is by its shape — see POST /api/auth/identify's
    // own comment for why that broke real tax-code logins (a tax code and
    // a phone number are both plain digit strings of similar length).
    const companyId = getCompanyId();
    const user = await queryOne<UserRow>(
      "SELECT * FROM users WHERE company_id = ? AND (email = ? OR phone = ? OR mst_code = ?) LIMIT 1",
      [companyId, normalizedEmail, normalizedPhone, value]
    );

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
        "SELECT is_enabled FROM customers WHERE company_id = ? AND sap_card_code = ? LIMIT 1",
        [companyId, user.sap_card_code]
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

    // Generate JWT token — 30d either way; what differs with "remember me"
    // is the COOKIE's own lifetime below, not the token's.
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
      },
      JWT_SECRET,
      { expiresIn: "30d" }
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
      // "Remember me": a persistent 30-day cookie that survives closing the
      // browser; unchecked, a session cookie (no maxAge) that the browser
      // clears on its own when closed — the token itself is valid either
      // way, only the cookie's own lifetime differs.
      ...(rememberMe ? { maxAge: 30 * 24 * 60 * 60 } : {}),
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
