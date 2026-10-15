import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/connection";
import { getSessionUser } from "@/lib/auth/session";
import { listOrderMessages, postOrderMessage, markOrderMessagesRead } from "@/lib/orderMessages";

/**
 * GET/POST /api/orders/[id]/messages — the customer side of an order's
 * message thread with admin (see order_messages in schema.sql). Scoped to
 * `user_id = session user`, same 404-not-403 pattern as GET /api/orders/[id]
 * — an order that isn't theirs simply doesn't exist as far as they can tell.
 */
async function loadOwnedOrderId(request: NextRequest, id: string): Promise<{ orderId: number; userFullName: string } | NextResponse> {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  const order = await queryOne<{ id: number }>(`SELECT id FROM orders WHERE id = ? AND user_id = ?`, [orderId, user.id]);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  return { orderId, userFullName: user.fullName };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await loadOwnedOrderId(request, id);
  if (result instanceof NextResponse) return result;

  const messages = await listOrderMessages(result.orderId);
  // Opening the thread is what clears the navbar notification badge for
  // this order — same convention as any chat/notification UI.
  await markOrderMessagesRead(result.orderId);
  return NextResponse.json({ messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await loadOwnedOrderId(request, id);
  if (result instanceof NextResponse) return result;

  const body = await request.json();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  await postOrderMessage(result.orderId, "customer", result.userFullName, message);
  return NextResponse.json({ success: true });
}
