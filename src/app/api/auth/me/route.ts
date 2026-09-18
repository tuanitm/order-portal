import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

/**
 * GET /api/auth/me — Check current session and return user info
 * Returns 401 if not authenticated
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    return NextResponse.json({ user });
  } catch (error) {
    console.error("[API] Auth me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
