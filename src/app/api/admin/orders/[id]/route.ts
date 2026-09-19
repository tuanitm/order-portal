import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { recordOrderStatus } from "@/lib/orderHistory";

const VALID_STATUSES = ["draft", "submitted", "processing", "sap_draft_created", "approved", "rejected", "completed"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  const order = await queryOne(
    `SELECT o.*, u.email AS customer_email, u.sap_card_code
     FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?`,
    [orderId]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const lines = await query(
    `SELECT * FROM order_lines WHERE order_id = ?`,
    [orderId]
  );

  return NextResponse.json({ order, lines });
}

/** PATCH /api/admin/orders/[id] — update status. Body: { status: string } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  const body = await request.json();
  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const current = await queryOne<{ status: string }>(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  if (!current) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  await query(`UPDATE orders SET status = ? WHERE id = ?`, [body.status, orderId]);
  if (current.status !== body.status) await recordOrderStatus(orderId, body.status);
  return NextResponse.json({ success: true });
}
