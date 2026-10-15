import { query } from "@/lib/db/connection";

export interface OrderMessage {
  id: number;
  sender_type: "admin" | "customer";
  sender_name: string | null;
  message: string;
  created_at: string;
}

export interface UnreadOrderSummary {
  order_id: number;
  order_number: string;
  unread_count: number;
  latest_message: string;
  latest_created_at: string;
}

export interface UnreadCustomerMessageSummary extends UnreadOrderSummary {
  customer_name: string | null;
}

/** Every message on an order's thread, oldest first (chat-style). */
export async function listOrderMessages(orderId: number): Promise<OrderMessage[]> {
  return query<OrderMessage[]>(
    `SELECT id, sender_type, sender_name, message, created_at
     FROM order_messages WHERE order_id = ? ORDER BY created_at ASC, id ASC`,
    [orderId]
  );
}

/** Appends one message to an order's thread — see order_messages in schema.sql. */
export async function postOrderMessage(
  orderId: number,
  senderType: "admin" | "customer",
  senderName: string | null,
  message: string
): Promise<void> {
  await query(
    `INSERT INTO order_messages (order_id, sender_type, sender_name, message) VALUES (?, ?, ?, ?)`,
    [orderId, senderType, senderName, message]
  );
}

/**
 * Marks every unread admin message on one order as read — called when the
 * customer actually opens that order's own message thread (see GET
 * /api/orders/[id]/messages), the same "opening it clears it" convention
 * most chat/notification UIs use.
 */
export async function markOrderMessagesRead(orderId: number): Promise<void> {
  await query(
    `UPDATE order_messages SET read_at = NOW() WHERE order_id = ? AND sender_type = 'admin' AND read_at IS NULL`,
    [orderId]
  );
}

/**
 * The customer storefront navbar's notification badge: total unread admin
 * messages across every order this customer owns, plus one row per order
 * that has any (for the dropdown preview) — newest order first.
 */
export async function getUnreadMessageSummaryForUser(
  userId: number
): Promise<{ totalUnread: number; orders: UnreadOrderSummary[] }> {
  const orders = await query<UnreadOrderSummary[]>(
    `WITH unread AS (
       SELECT om.order_id, om.message, om.created_at, o.order_number,
              ROW_NUMBER() OVER (PARTITION BY om.order_id ORDER BY om.created_at DESC) AS rn
       FROM order_messages om
       JOIN orders o ON o.id = om.order_id
       WHERE o.user_id = ? AND om.sender_type = 'admin' AND om.read_at IS NULL
     )
     SELECT order_id, order_number, COUNT(*) AS unread_count,
            MAX(CASE WHEN rn = 1 THEN message END) AS latest_message,
            MAX(created_at) AS latest_created_at
     FROM unread
     GROUP BY order_id, order_number
     ORDER BY latest_created_at DESC`,
    [userId]
  );
  const totalUnread = orders.reduce((sum, o) => sum + Number(o.unread_count), 0);
  return { totalUnread, orders };
}

/**
 * Marks every unread customer message on one order as read — called when
 * an admin opens that order's Review page (see GET
 * /api/admin/orders/[id]/messages). Global, not per-admin-account: this
 * app has no per-admin read-state for orders elsewhere either (orders
 * themselves aren't scoped per admin), so any admin opening the thread
 * clears it for every admin, same as a shared team inbox.
 */
export async function markOrderMessagesReadByAdmin(orderId: number): Promise<void> {
  await query(
    `UPDATE order_messages SET read_at = NOW() WHERE order_id = ? AND sender_type = 'customer' AND read_at IS NULL`,
    [orderId]
  );
}

/**
 * The admin portal's top-right notification badge: total unread customer
 * messages across every order (orders aren't scoped per admin, so this is
 * global, not filtered to the requesting admin), plus one row per order
 * that has any (for the dropdown preview) — newest first.
 */
export async function getUnreadCustomerMessageSummaryForAdmins(): Promise<{
  totalUnread: number;
  orders: UnreadCustomerMessageSummary[];
}> {
  const orders = await query<UnreadCustomerMessageSummary[]>(
    `WITH unread AS (
       SELECT om.order_id, om.message, om.created_at, o.order_number, o.customer_name,
              ROW_NUMBER() OVER (PARTITION BY om.order_id ORDER BY om.created_at DESC) AS rn
       FROM order_messages om
       JOIN orders o ON o.id = om.order_id
       WHERE om.sender_type = 'customer' AND om.read_at IS NULL
     )
     SELECT order_id, order_number, customer_name, COUNT(*) AS unread_count,
            MAX(CASE WHEN rn = 1 THEN message END) AS latest_message,
            MAX(created_at) AS latest_created_at
     FROM unread
     GROUP BY order_id, order_number, customer_name
     ORDER BY latest_created_at DESC`
  );
  const totalUnread = orders.reduce((sum, o) => sum + Number(o.unread_count), 0);
  return { totalUnread, orders };
}
