import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getCustomerForAdmin, getOrderWarehouses, priceItemsForCustomer } from "@/lib/adminOrderCreate";
import { getAllowedBrandCodes, isOrderInAdminScope } from "@/lib/adminScope";
import { orderBrandOf, staffEditPricer } from "@/lib/orderEdit";

/**
 * POST /api/admin/orders/create/pricing { customer, warehouse, search? | codes?, orderId? }
 * (orderId = Order Edit: limited to that order's brand; its own lines priced even when out of stock)
 * — items priced for that customer with Avail Qty from that warehouse: the
 * dialog's item picker (`search`) and the re-pricing of its lines (`codes`)
 * when the customer or warehouse changes.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const body = await request.json().catch(() => ({}));
  const { customer: cardCode, warehouse, search, codes, orderId } = body as {
    customer?: string; warehouse?: string; search?: string; codes?: string[]; orderId?: number;
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
    // Order Edit: the order's brand only; lines already on the order are priced even if their stock ran out.
    if (orderId) {
      if (!(await isOrderInAdminScope(guard.session, Number(orderId)))) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      const brand = await orderBrandOf(Number(orderId));
      const pricer = await staffEditPricer(guard.session, Number(orderId), customer, warehouse, brand);
      const list = codes ? codes.map((c) => String(c).trim()).filter(Boolean) : undefined;
      return NextResponse.json({ items: await pricer(list ? { codes: list } : { search: typeof search === "string" ? search : "" }), brand });
    }
    const items = await priceItemsForCustomer(customer, warehouse, {
      brands: getAllowedBrandCodes(guard.session),
      search: typeof search === "string" ? search : undefined,
      codes: codes?.map((c) => String(c).trim()).filter(Boolean),
    });
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[Admin] Self-create pricing failed:", error);
    return NextResponse.json({ error: "Failed to price items" }, { status: 500 });
  }
}
