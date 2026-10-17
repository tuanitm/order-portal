import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getAllowedCustomerGroupCodes, inScope } from "@/lib/adminScope";

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

  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only Super Admin can activate or inactivate SAP customers" }, { status: 403 });
  }

  const { cardCode } = await params;
  const body = await request.json();
  if (typeof body.isEnabled !== "boolean") {
    return NextResponse.json({ error: "isEnabled (boolean) is required" }, { status: 400 });
  }

  const allowed = await getAllowedCustomerGroupCodes(guard.session);
  if (allowed !== null) {
    const target = await queryOne<{ cus_grp01: string | null; cus_grp02: string | null; cus_grp03: string | null }>(
      `SELECT cus_grp01, cus_grp02, cus_grp03 FROM customers WHERE sap_card_code = ?`,
      [cardCode]
    );
    if (!target || !inScope(allowed, [target.cus_grp01, target.cus_grp02, target.cus_grp03])) {
      return NextResponse.json({ error: "Forbidden — this customer is outside your assigned scope" }, { status: 403 });
    }
  }

  await query(`UPDATE customers SET is_enabled = ? WHERE sap_card_code = ?`, [body.isEnabled, cardCode]);
  return NextResponse.json({ success: true });
}
