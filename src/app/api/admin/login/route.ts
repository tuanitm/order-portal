import { NextRequest, NextResponse } from "next/server";
import { loginResponse } from "@/lib/auth/login";

/**
 * POST /api/admin/login — kept as an alias of the one login (POST
 * /api/auth/login). Body: { email | identifier, password } — a userid or email.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, identifier, password } = await request.json();
    return await loginResponse(request, identifier ?? email, password, false);
  } catch (error) {
    console.error("[API] Admin login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
