import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
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
 *
 * A gift line itself (is_gift_line) can never be PATCHed directly — its
 * quantity must always stay the buy line's own confirm_qty times the
 * promo's buy/give ratio, never an independently admin-typed number (the
 * UI already hides the input for these lines; this is the server-side
 * enforcement of that same rule).
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

  const companyId = getCompanyId();
  const line = await queryOne<{ id: number; quantity: number; is_gift_line: number }>(
    `SELECT id, quantity, is_gift_line FROM order_lines WHERE company_id = ? AND id = ? AND order_id = ?`,
    [companyId, orderLineId, orderId]
  );
  if (!line) return NextResponse.json({ error: "Order line not found" }, { status: 404 });
  if (line.is_gift_line) {
    return NextResponse.json(
      { error: "Free item quantity follows its buy line's promotion ratio automatically — edit the buy line's quantity instead" },
      { status: 400 }
    );
  }

  const customerConfirmStatus = confirmQty === line.quantity ? "accepted" : "pending";
  await query(
    `UPDATE order_lines SET confirm_qty = ?, customer_confirm_status = ? WHERE company_id = ? AND id = ?`,
    [confirmQty, customerConfirmStatus, companyId, orderLineId]
  );

  const giftAdjustment = await recalculateLinkedGiftQty(orderLineId, confirmQty);
  return NextResponse.json({ success: true, giftAdjustment });
}
