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
    `SELECT id, sap_item_code, item_name, quantity, uom, unit_price, discount_percent, line_total,
            confirm_qty, customer_confirm_status
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

/**
 * PATCH /api/orders/[id] — the customer editing their own order's
 * delivery_address / contact_phone / remark (e.g. a wrong address flagged
 * by admin in the message thread). Only while the order hasn't been
 * pushed to SAP yet — once it has, this is SAP's record, not something to
 * silently change here. Body: any subset of { deliveryAddress, contactPhone, remark }.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  const order = await queryOne<{ sap_doc_entry: number | null }>(
    `SELECT sap_doc_entry FROM orders WHERE id = ? AND user_id = ?`,
    [orderId, user.id]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.sap_doc_entry) {
    return NextResponse.json({ error: "This order has already been pushed to SAP and can no longer be edited" }, { status: 409 });
  }

  const body = await request.json();
  const updates: string[] = [];
  const values: string[] = [];

  if (typeof body.deliveryAddress === "string") {
    updates.push("delivery_address = ?");
    values.push(body.deliveryAddress.trim());
  }
  if (typeof body.contactPhone === "string") {
    updates.push("contact_phone = ?");
    values.push(body.contactPhone.trim());
  }
  if (typeof body.remark === "string") {
    updates.push("remark = ?");
    values.push(body.remark.trim());
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(String(orderId));
  await query(`UPDATE orders SET ${updates.join(", ")} WHERE id = ?`, values);
  return NextResponse.json({ success: true });
}
