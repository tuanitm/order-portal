import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getSessionUser } from "@/lib/auth/session";
import { postOrderMessage } from "@/lib/orderMessages";

/**
 * POST /api/orders/[id]/lines/[lineId]/confirm — Body: { accept: boolean }.
 * The customer's Accept/Reject response to an admin-adjusted Confirm Qty
 * (not enough stock, shelf-life gate, ...) on their own order page. Only
 * actionable while the line is actually 'pending' (an admin adjustment
 * they haven't responded to yet) and the order hasn't been pushed to SAP.
 * Logs the decision to the order's message thread either way, so the
 * admin sees it without a separate notification.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, lineId } = await params;
  const orderId = parseInt(id, 10);
  const orderLineId = parseInt(lineId, 10);
  if (isNaN(orderId) || isNaN(orderLineId)) {
    return NextResponse.json({ error: "Invalid order or line ID" }, { status: 400 });
  }

  const body = await request.json();
  if (typeof body.accept !== "boolean") {
    return NextResponse.json({ error: "accept must be a boolean" }, { status: 400 });
  }

  const order = await queryOne<{ sap_doc_entry: number | null }>(
    `SELECT sap_doc_entry FROM orders WHERE id = ? AND user_id = ?`,
    [orderId, user.id]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.sap_doc_entry) {
    return NextResponse.json({ error: "This order has already been pushed to SAP" }, { status: 409 });
  }

  const line = await queryOne<{ id: number; sap_item_code: string; item_name: string; confirm_qty: number; customer_confirm_status: string }>(
    `SELECT id, sap_item_code, item_name, confirm_qty, customer_confirm_status FROM order_lines WHERE id = ? AND order_id = ?`,
    [orderLineId, orderId]
  );
  if (!line) return NextResponse.json({ error: "Order line not found" }, { status: 404 });
  if (line.customer_confirm_status !== "pending") {
    return NextResponse.json({ error: "This line has no pending adjustment to respond to" }, { status: 409 });
  }

  await query(
    `UPDATE order_lines SET customer_confirm_status = ? WHERE id = ?`,
    [body.accept ? "accepted" : "rejected", orderLineId]
  );

  await postOrderMessage(
    orderId,
    "customer",
    user.fullName,
    body.accept
      ? `Accepted the adjusted quantity (${line.confirm_qty}) for ${line.item_name} (${line.sap_item_code}).`
      : `Rejected the adjusted quantity (${line.confirm_qty}) for ${line.item_name} (${line.sap_item_code}) — please follow up.`
  );

  return NextResponse.json({ success: true });
}
