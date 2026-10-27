import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getOrderWarehouses } from "@/lib/adminOrderCreate";
import { isOrderInAdminScope } from "@/lib/adminScope";

/**
 * GET /api/admin/orders/[id]/warehouses — the warehouses this admin may
 * check stock in and push the order from: their own (Admin Users →
 * Warehouse; root = all of masterdata.wareHouse — see getOrderWarehouses).
 * Populates the warehouse dropdown on the admin Order Review page; the page
 * pre-selects the order's saved warehouse, else the first one returned.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  if (!(await isOrderInAdminScope(guard.session, orderId))) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // The admin's own warehouses (Admin Users → Warehouse) — Warehouse Visibility is the customers' rule.
  const warehouses = await getOrderWarehouses(guard.session);
  return NextResponse.json({ warehouses });
}
