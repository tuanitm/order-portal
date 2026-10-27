import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getLiveAvailabilityForOrder } from "@/lib/orderStock";
import { isOrderInAdminScope } from "@/lib/adminScope";
import { getAdminWarehouseCodes } from "@/lib/adminWarehouses";

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

  const companyId = getCompanyId();
  const order = await queryOne<{ sap_doc_entry: number | null }>(
    `SELECT sap_doc_entry FROM orders WHERE company_id = ? AND id = ?`,
    [companyId, orderId]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.sap_doc_entry) {
    return NextResponse.json(
      { error: "Order is already pushed to SAP — live stock cannot be fetched again" },
      { status: 400 }
    );
  }

  const warehouseCode = new URL(request.url).searchParams.get("warehouseCode")?.trim();
  if (!warehouseCode) {
    return NextResponse.json({ error: "warehouseCode query param is required" }, { status: 400 });
  }
  if (!(await getAdminWarehouseCodes(guard.session)).includes(warehouseCode)) {
    return NextResponse.json({ error: `Warehouse ${warehouseCode} is not one of your warehouses (Admin Users → Warehouse)` }, { status: 403 });
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

  // Persist live availability snapshot on order lines and warehouse on orders
  try {
    for (const item of items) {
      await query(
        `UPDATE order_lines SET avail_qty = ? WHERE company_id = ? AND order_id = ? AND sap_item_code = ?`,
        [item.availableQty, companyId, orderId, item.sapItemCode]
      );
    }
    await query(
      `UPDATE orders SET warehouse_code = ? WHERE company_id = ? AND id = ? AND sap_doc_entry IS NULL`,
      [warehouseCode, companyId, orderId]
    );
  } catch (err) {
    console.error("[Admin] Failed to persist stock snapshot:", err);
  }

  return NextResponse.json({ warehouseCode, items });
}
