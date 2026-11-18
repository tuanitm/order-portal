import { NextRequest, NextResponse } from "next/server";
import { loginResponse } from "@/lib/auth/login";

/**
 * POST /api/auth/login — the one login for every role.
 * Body: { identifier, password, rememberMe? } — identifier is a userid, email,
 * phone or tax code. See loginResponse for the role detection and redirect.
 */
export async function POST(request: NextRequest) {
  try {
    const { identifier, password, rememberMe } = await request.json();
    return await loginResponse(request, identifier, password, !!rememberMe);
  } catch (error) {
    console.error("[API] Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
