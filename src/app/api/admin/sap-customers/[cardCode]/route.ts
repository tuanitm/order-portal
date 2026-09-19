import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * PATCH /api/admin/sap-customers/[cardCode] — enable/disable a SAP customer.
 * A disabled customer's linked portal account (users.sap_card_code) is
 * blocked from signing in and from placing orders (see /api/auth/login and
 * /api/orders), shown the "contact admin" message instead.
 * Body: { isEnabled: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> }
) {
  const guard = await requireAdminPermission(request, "sap-customers");
  if (guard.response) return guard.response;

  const { cardCode } = await params;
  const body = await request.json();
  if (typeof body.isEnabled !== "boolean") {
    return NextResponse.json({ error: "isEnabled (boolean) is required" }, { status: 400 });
  }

  await query(`UPDATE customers SET is_enabled = ? WHERE sap_card_code = ?`, [body.isEnabled, cardCode]);
  return NextResponse.json({ success: true });
}
