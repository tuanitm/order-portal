import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";

/**
 * POST /api/auth/identify — Check if a user exists by email, phone, or MST code
 * Body: { identifier: string }
 * Returns: { exists: boolean, identifierType: 'email' | 'phone' | 'mst' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier } = body;

    if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
      return NextResponse.json(
        { error: "Identifier is required" },
        { status: 400 }
      );
    }

    const value = identifier.trim();

    // Determine identifier type
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9]{9,15}$/;

    let identifierType: "email" | "phone" | "mst";
    let sql: string;

    if (emailRegex.test(value)) {
      identifierType = "email";
      sql = "SELECT id FROM users WHERE email = ? LIMIT 1";
    } else if (phoneRegex.test(value.replace(/[+\-\s()]/g, ""))) {
      identifierType = "phone";
      sql = "SELECT id FROM users WHERE phone = ? LIMIT 1";
    } else {
      identifierType = "mst";
      sql = "SELECT id FROM users WHERE mst_code = ? LIMIT 1";
    }

    const rows = await query<{ id: number }[]>(sql, [value]);
    const exists = Array.isArray(rows) && rows.length > 0;

    return NextResponse.json({
      exists,
      identifierType,
    });
  } catch (error) {
    console.error("[API] Identify error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
