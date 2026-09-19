import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { queryOne } from "@/lib/db/connection";

/**
 * GET /api/auth/me — Check current session and return user info
 * Returns 401 if not authenticated
 *
 * Also resolves `address` from the linked SAP customer master (`customers`,
 * by sap_card_code) — not part of SessionUser/getSessionUser, since that's
 * called on every request across the app and this is only needed here (the
 * checkout form, to prefill delivery address from BP master data).
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

    let address: string | null = null;
    let bpPhone: string | null = null;
    if (user.sapCardCode) {
      const customer = await queryOne<{ address: string | null; phone: string | null }>(
        "SELECT address, phone FROM customers WHERE sap_card_code = ? LIMIT 1",
        [user.sapCardCode]
      );
      address = customer?.address ?? null;
      bpPhone = customer?.phone?.trim() || null;
    }

    // `phone` (the portal user's own) is left as-is; `bpPhone` is the BP
    // master's, which the checkout form prefers, falling back to `phone`.
    return NextResponse.json({ user: { ...user, address, bpPhone } });
  } catch (error) {
    console.error("[API] Auth me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
