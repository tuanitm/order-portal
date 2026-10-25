import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { sendPushToUser } from "@/lib/webPush";
import { getOrderStatusLabel } from "@/lib/orderStatusLabels";

/**
 * Append a row to order_status_history — call whenever an order enters a
 * status (order placement, admin status change, SAP push). Not called for
 * no-op changes where the status is already the current one.
 */
export async function recordOrderStatus(orderId: number, status: string): Promise<void> {
  await query(
    `INSERT INTO order_status_history (company_id, order_id, status) VALUES (?, ?, ?)`,
    [getCompanyId(), orderId, status]
  );
}

interface OrderCustomerForNotify {
  order_number: string;
  user_id: number | null;
  language: "vi" | "en" | null;
}

/**
 * Push-notifies the customer that their order's status changed — admin's
 * status dropdown, or the SAP push in POST .../confirm (which sets
 * 'sap_draft_created'). Best-effort, same pattern as every other
 * notification in this app: a failure here never fails the status change
 * itself. Deliberately NOT called from the customer's own self-cancel
 * (POST /api/orders/[id]/cancel) — they already know, they just did it.
 */
export async function notifyCustomerOfStatusChange(orderId: number, status: string): Promise<void> {
  try {
    const order = await queryOne<OrderCustomerForNotify>(
      `SELECT o.order_number, o.user_id, u.language FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.company_id = ? AND o.id = ?`,
      [getCompanyId(), orderId]
    );
    if (!order || !order.user_id) return;

    await sendPushToUser(order.user_id, {
      title: order.order_number,
      body: getOrderStatusLabel(status, order.language || "vi"),
      url: `/orders/${orderId}`,
    });
  } catch (error) {
    console.error("[OrderHistory] Failed to push-notify status change:", error);
  }
}
