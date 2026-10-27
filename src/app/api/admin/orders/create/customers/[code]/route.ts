import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getCustomerForAdmin, getCustomerDetail } from "@/lib/adminOrderCreate";

/**
 * GET /api/admin/orders/create/customers/[code] — everything the "Self create"
 * dialog needs once a customer is picked: their SAP bill-to / ship-to
 * addresses and defaults, the warehouses they can order from, the Sales
 * Supervisor list and their portal login (if any).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { code } = await params;
  const customer = await getCustomerForAdmin(guard.session, decodeURIComponent(code));
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  try {
    return NextResponse.json(await getCustomerDetail(guard.session, customer));
  } catch (error) {
    console.error("[Admin] Self-create customer detail failed:", error);
    return NextResponse.json({ error: "Failed to load customer" }, { status: 500 });
  }
}
