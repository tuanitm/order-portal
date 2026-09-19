import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getSessionUser } from "@/lib/auth/session";

/**
 * GET /api/orders/[id] — a single order's detail, for the customer who
 * placed it. Scoped to `user_id = session user` — returns 404 (not 403, to
 * avoid confirming an order id exists) for anyone else's order.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const order = await queryOne(
    `SELECT id, order_number, customer_name, delivery_address, contact_phone, contact_email,
            subtotal, discount_total, grand_total, remark, status, sap_doc_entry, sap_doc_num, created_at
     FROM orders WHERE id = ? AND user_id = ?`,
    [orderId, user.id]
  );
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const lines = await query(
    `SELECT id, sap_item_code, item_name, quantity, uom, unit_price, discount_percent, line_total
     FROM order_lines WHERE order_id = ?`,
    [orderId]
  );

  const history = await query<{ status: string; created_at: string }[]>(
    `SELECT status, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC, id DESC`,
    [orderId]
  );

  // Orders placed before status history existed have no rows — fall back to
  // the one status/time we do know.
  const o = order as { status: string; created_at: string };
  return NextResponse.json({
    order,
    lines,
    history: history.length > 0 ? history : [{ status: o.status, created_at: o.created_at }],
  });
}
