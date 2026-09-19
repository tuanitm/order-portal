import { query } from "@/lib/db/connection";

/**
 * Append a row to order_status_history — call whenever an order enters a
 * status (order placement, admin status change, SAP push). Not called for
 * no-op changes where the status is already the current one.
 */
export async function recordOrderStatus(orderId: number, status: string): Promise<void> {
  await query(`INSERT INTO order_status_history (order_id, status) VALUES (?, ?)`, [orderId, status]);
}
