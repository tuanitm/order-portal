import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncCustomerGroupsForCard } from "@/lib/sap-b1/sync";
import { getAllowedCustomerGroupCodes, inScope } from "@/lib/adminScope";

/**
 * POST /api/admin/customers/[id]/resync-sap — refresh a customer's channel
 * price list + customer group codes (U_CusGrp01/02/03) from their current
 * SAP BusinessPartner record.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "customers");
  if (guard.response) return guard.response;

  const { id } = await params;
  const customerId = parseInt(id, 10);
  if (isNaN(customerId)) return NextResponse.json({ error: "Invalid customer ID" }, { status: 400 });

  const customer = await queryOne<{
    sap_card_code: string | null;
    sap_cus_grp01: string | null;
    sap_cus_grp02: string | null;
    sap_cus_grp03: string | null;
  }>(
    `SELECT sap_card_code, sap_cus_grp01, sap_cus_grp02, sap_cus_grp03 FROM users WHERE id = ?`,
    [customerId]
  );
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const allowed = await getAllowedCustomerGroupCodes(guard.session);
  if (!inScope(allowed, [customer.sap_cus_grp01, customer.sap_cus_grp02, customer.sap_cus_grp03])) {
    return NextResponse.json({ error: "Forbidden — this customer is outside your assigned scope" }, { status: 403 });
  }

  if (!customer.sap_card_code) {
    return NextResponse.json({ error: "Customer has no linked SAP card code" }, { status: 400 });
  }

  try {
    const result = await syncCustomerGroupsForCard(customer.sap_card_code);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Resync SAP failed:", error);
    return NextResponse.json({ error: "Resync failed" }, { status: 500 });
  }
}
