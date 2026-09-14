import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import bcrypt from "bcryptjs";

/**
 * POST /api/auth/signup — Create a new user account (pending approval)
 * Body: { fullName, email, phone?, mstCode?, sapCardCode?, sapCardName?, password }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      fullName,
      email,
      phone,
      mstCode,
      sapCardCode,
      sapCardName,
      password,
      emailVerified,
    } = body;

    // Validate required fields
    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      return NextResponse.json(
        { error: "Full name is required" },
        { status: 400 }
      );
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    if (!emailVerified) {
      return NextResponse.json(
        { error: "Email must be verified via OTP" },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existingEmail = await queryOne<{ id: number }>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email.trim().toLowerCase()]
    );
    if (existingEmail) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    // Check if phone already exists (if provided)
    if (phone && phone.trim()) {
      const existingPhone = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE phone = ? LIMIT 1",
        [phone.trim()]
      );
      if (existingPhone) {
        return NextResponse.json(
          { error: "Phone number already registered" },
          { status: 409 }
        );
      }
    }

    // Check if MST already exists (if provided)
    if (mstCode && mstCode.trim()) {
      const existingMst = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE mst_code = ? LIMIT 1",
        [mstCode.trim()]
      );
      if (existingMst) {
        return NextResponse.json(
          { error: "MST code already registered" },
          { status: 409 }
        );
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert user with pending approval status
    const result = await query<{ insertId: number }>(
      `INSERT INTO users (email, phone, password_hash, full_name, mst_code, sap_card_code, sap_card_name, approval_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        email.trim().toLowerCase(),
        phone?.trim() || null,
        passwordHash,
        fullName.trim(),
        mstCode?.trim() || null,
        sapCardCode || null,
        sapCardName || null,
      ]
    );

    console.log("[API] New user registered (pending approval):", email);

    return NextResponse.json({
      success: true,
      userId: (result as unknown as { insertId: number }).insertId,
      approvalStatus: "pending",
    });
  } catch (error) {
    console.error("[API] Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
