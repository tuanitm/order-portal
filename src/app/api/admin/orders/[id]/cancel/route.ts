import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getSapClient } from "@/lib/sap-b1/client";
import { recordOrderStatus, notifyCustomerOfStatusChange } from "@/lib/orderHistory";
import { postOrderMessage } from "@/lib/orderMessages";

const TERMINAL_STATUSES = ["cancelled", "completed", "rejected"];

interface OrderRow {
  status: string;
  sap_doc_entry: number | null;
}

/**
 * POST /api/admin/orders/[id]/cancel — the admin cancelling an order. This
 * is the ONLY place that should ever set status = 'cancelled' on the admin
 * side (the generic PATCH /api/admin/orders/[id] status dropdown rejects
 * it — see VALID_STATUSES there) because, unlike every other status, it
 * has a SAP-side consequence: if the order was already confirmed and
 * pushed as a SAP Draft Sales Order, that Draft is deleted here too.
 *
 * A Draft (ObjectType 112) is just a proposal sitting in SAP — it hasn't
 * reserved stock or posted anything — so there's nothing to "cancel" there
 * in the accounting sense; deleting it is correct and final. If that
 * delete fails for a reason other than the Draft already being gone, this
 * aborts WITHOUT marking the order cancelled, so the portal's status never
 * drifts from what's actually true in SAP.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  const order = await queryOne<OrderRow>(
    `SELECT status, sap_doc_entry FROM orders WHERE id = ?`,
    [orderId]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (TERMINAL_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: `Order is already ${order.status}` }, { status: 409 });
  }

  if (order.sap_doc_entry) {
    try {
      await getSapClient().deleteDraftSalesOrder(order.sap_doc_entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // "already gone" — e.g. someone deleted/converted it in SAP directly —
      // is fine to proceed past; anything else blocks the cancellation so
      // the portal doesn't claim cancelled while SAP still has a live Draft.
      const alreadyGone = /does not exist|not found|no matching records/i.test(message);
      if (!alreadyGone) {
        console.error("[Admin] Failed to delete SAP draft on cancel:", error);
        return NextResponse.json(
          { error: "Could not remove the SAP Draft Sales Order — order was NOT cancelled", message },
          { status: 502 }
        );
      }
    }
  }

  await query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [orderId]);
  await recordOrderStatus(orderId, "cancelled");
  await notifyCustomerOfStatusChange(orderId, "cancelled");

  const admin = await queryOne<{ full_name: string | null }>(
    `SELECT full_name FROM admin_users WHERE id = ?`,
    [guard.session.adminId]
  );
  await postOrderMessage(orderId, "admin", admin?.full_name || null, "Cancelled this order.");

  return NextResponse.json({ success: true });
}
