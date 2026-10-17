import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { listOrderMessages, postOrderMessage, markOrderMessagesReadByAdmin } from "@/lib/orderMessages";
import { sendOrderMessageEmail } from "@/lib/email/sender";
import { sendPushToUser } from "@/lib/webPush";
import { isOrderInAdminScope } from "@/lib/adminScope";

interface OrderCustomerContact {
  order_number: string;
  user_id: number | null;
  email: string | null;
  full_name: string | null;
  language: "vi" | "en" | null;
}

/**
 * GET/POST /api/admin/orders/[id]/messages — the admin side of an order's
 * message thread with the customer (see order_messages in schema.sql) —
 * for exactly the cases that come up after an order is placed: not enough
 * stock, qty over available stock, shelf-life requirement not met, etc.
 * A POST also emails the customer (best-effort — a failed send doesn't
 * fail the message post, same pattern as every other email in this app).
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

  const messages = await listOrderMessages(orderId);
  // Opening the thread is what clears the admin portal's notification
  // badge for this order — same convention as the customer side.
  await markOrderMessagesReadByAdmin(orderId);
  return NextResponse.json({ messages });
}

export async function POST(
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

  const body = await request.json();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const customer = await queryOne<OrderCustomerContact>(
    `SELECT o.order_number, o.user_id, u.email, u.full_name, u.language
     FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?`,
    [orderId]
  );
  if (!customer) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // The admin's own display name (e.g. "Admin SO"), shown to the customer
  // in place of a generic "Support" label — never the login email/username.
  // If full_name is somehow unset, leave sender_name null rather than
  // falling back to the email; the UI's own generic label covers that.
  const admin = await queryOne<{ full_name: string | null }>(
    `SELECT full_name FROM admin_users WHERE id = ?`,
    [guard.session.adminId]
  );
  await postOrderMessage(orderId, "admin", admin?.full_name || null, message);

  if (customer.email) {
    try {
      await sendOrderMessageEmail(
        customer.email,
        customer.full_name || customer.email,
        customer.order_number,
        message,
        customer.language || "vi"
      );
    } catch (error) {
      console.error("[Admin] Failed to send order message notification email:", error);
    }
  }

  if (customer.user_id) {
    try {
      await sendPushToUser(customer.user_id, {
        title: `${customer.order_number}`,
        body: message,
        url: `/orders/${orderId}`,
      });
    } catch (error) {
      console.error("[Admin] Failed to send order message push notification:", error);
    }
  }

  return NextResponse.json({ success: true });
}
