import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/session";
import { recordOrderStatus } from "@/lib/orderHistory";
import { postOrderMessage } from "@/lib/orderMessages";
import { logAuditEvent } from "@/lib/auditLog";

const TERMINAL_STATUSES = ["cancelled", "completed", "rejected"];

/**
 * POST /api/orders/[id]/cancel — the customer cancelling their own order
 * directly ("customer informs to cancel"), instead of asking admin to do
 * it via the message thread. Only while the order hasn't been pushed to
 * SAP yet, and not already in a terminal state. Logs the cancellation to
 * the message thread so the admin sees it without a separate notification.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  const companyId = getCompanyId();
  const order = await queryOne<{ status: string; sap_doc_entry: number | null }>(
    `SELECT status, sap_doc_entry FROM orders WHERE company_id = ? AND id = ? AND user_id = ?`,
    [companyId, orderId, user.id]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.sap_doc_entry) {
    return NextResponse.json({ error: "This order has already been pushed to SAP and can no longer be cancelled here" }, { status: 409 });
  }
  if (TERMINAL_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: `Order is already ${order.status}` }, { status: 409 });
  }

  await query(`UPDATE orders SET status = 'cancelled' WHERE company_id = ? AND id = ?`, [companyId, orderId]);
  await recordOrderStatus(orderId, "cancelled");
  await postOrderMessage(orderId, "customer", user.fullName, "Cancelled this order.");

  await logAuditEvent({
    actorType: "customer", actorId: user.id, actorLabel: user.email || user.fullName,
    action: "order_cancel", entityType: "order", entityId: orderId,
    details: { previousStatus: order.status },
    request,
  });

  return NextResponse.json({ success: true });
}
