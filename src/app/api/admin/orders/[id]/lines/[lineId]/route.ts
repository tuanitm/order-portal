import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { recalculateLinkedGiftQty } from "@/lib/orderGifts";
import { isOrderInAdminScope } from "@/lib/adminScope";

/**
 * PATCH /api/admin/orders/[id]/lines/[lineId] — Body: { confirmQty: number }.
 * Sets the quantity actually pushed to SAP on confirm (see .../confirm).
 * Can be lowered OR raised relative to the originally-ordered `quantity`
 * (e.g. insufficient live stock calls for lower; correcting an
 * under-order, or rounding up to a case-pack size, calls for higher) — the
 * only hard floor is 0 (which drops the line entirely rather than sending
 * SAP a 0-quantity line — see the confirm route).
 *
 * Also sets `customer_confirm_status`: 'accepted' automatically when
 * confirmQty still equals the original ordered quantity (nothing to
 * confirm), otherwise 'pending' — every adjustment away from what the
 * customer actually ordered is a fresh decision for them to Accept/Reject
 * on their own order page (see POST .../lines/[lineId]/confirm), even if
 * it happens to match a value they already responded to before.
 *
 * If this line is the "buy" side of a buy-X-get-Y promo, its linked gift
 * line's own confirm_qty is recalculated from the new ratio right here —
 * see recalculateLinkedGiftQty — and reported back in `giftAdjustment` so
 * the admin UI can show it alongside this line's own change.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { id, lineId } = await params;
  const orderId = parseInt(id, 10);
  const orderLineId = parseInt(lineId, 10);
  if (isNaN(orderId) || isNaN(orderLineId)) {
    return NextResponse.json({ error: "Invalid order or line ID" }, { status: 400 });
  }

  if (!(await isOrderInAdminScope(guard.session, orderId))) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const body = await request.json();
  const confirmQty = Number(body.confirmQty);
  if (!Number.isFinite(confirmQty) || confirmQty < 0 || !Number.isInteger(confirmQty)) {
    return NextResponse.json({ error: "confirmQty must be a non-negative integer" }, { status: 400 });
  }

  const line = await queryOne<{ id: number; quantity: number }>(
    `SELECT id, quantity FROM order_lines WHERE id = ? AND order_id = ?`,
    [orderLineId, orderId]
  );
  if (!line) return NextResponse.json({ error: "Order line not found" }, { status: 404 });

  const customerConfirmStatus = confirmQty === line.quantity ? "accepted" : "pending";
  await query(
    `UPDATE order_lines SET confirm_qty = ?, customer_confirm_status = ? WHERE id = ?`,
    [confirmQty, customerConfirmStatus, orderLineId]
  );

  const giftAdjustment = await recalculateLinkedGiftQty(orderLineId, confirmQty);
  return NextResponse.json({ success: true, giftAdjustment });
}
