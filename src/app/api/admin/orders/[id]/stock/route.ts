import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getLiveAvailabilityForOrder } from "@/lib/orderStock";
import { isOrderInAdminScope } from "@/lib/adminScope";

/**
 * GET /api/admin/orders/[id]/stock?warehouseCode=XXXX — LIVE (not the
 * cached item_warehouse_stock table) on-hand/committed stock from SAP for
 * every item on this order, in the one admin-selected warehouse, gated by
 * this customer's applicable customer_require_shelflife rules — see
 * getLiveAvailabilityForOrder in src/lib/orderStock.ts, which is shared
 * with the final safety cap POST .../confirm applies right before the SAP
 * push. Powers the "Avail Qty" column and the "Get Stock" button on the
 * admin Order Review page; runs automatically on page load (first
 * warehouse) and whenever the warehouse dropdown changes, in addition to
 * the manual button.
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

  const warehouseCode = new URL(request.url).searchParams.get("warehouseCode")?.trim();
  if (!warehouseCode) {
    return NextResponse.json({ error: "warehouseCode query param is required" }, { status: 400 });
  }

  let items;
  try {
    items = await getLiveAvailabilityForOrder(orderId, warehouseCode);
  } catch (error) {
    console.error("[Admin] Live stock check failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch live stock from SAP", message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }

  return NextResponse.json({ warehouseCode, items });
}
