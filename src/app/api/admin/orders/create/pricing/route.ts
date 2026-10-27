import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getCustomerForAdmin, getOrderWarehouses, priceItemsForCustomer } from "@/lib/adminOrderCreate";

/**
 * POST /api/admin/orders/create/pricing { customer, warehouse, search? | codes? }
 * — items priced for that customer with Avail Qty from that warehouse: the
 * dialog's item picker (`search`) and the re-pricing of its lines (`codes`)
 * when the customer or warehouse changes.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const body = await request.json().catch(() => ({}));
  const { customer: cardCode, warehouse, search, codes } = body as {
    customer?: string; warehouse?: string; search?: string; codes?: string[];
  };
  if (!cardCode || !warehouse) {
    return NextResponse.json({ error: "customer and warehouse are required" }, { status: 400 });
  }
  if (codes && (!Array.isArray(codes) || codes.length > 500)) {
    return NextResponse.json({ error: "codes must be a list of at most 500 item codes" }, { status: 400 });
  }
  const customer = await getCustomerForAdmin(guard.session, cardCode);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (!(await getOrderWarehouses(guard.session)).some((w) => w.code === warehouse)) {
    return NextResponse.json({ error: `Warehouse ${warehouse} is not one of your warehouses (Admin Users → Warehouse)` }, { status: 400 });
  }

  try {
    const items = await priceItemsForCustomer(customer, warehouse, {
      search: typeof search === "string" ? search : undefined,
      codes: codes?.map((c) => String(c).trim()).filter(Boolean),
    });
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[Admin] Self-create pricing failed:", error);
    return NextResponse.json({ error: "Failed to price items" }, { status: 500 });
  }
}
