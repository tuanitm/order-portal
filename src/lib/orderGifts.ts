import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

interface BuyLineRow {
  promo_buy_qty: number | null;
  promo_give_qty: number | null;
}

interface GiftLineRow {
  id: number;
  sap_item_code: string;
  quantity: number;
  confirm_qty: number;
}

export interface GiftQtyAdjustment {
  sapItemCode: string;
  from: number;
  to: number;
}

/**
 * Keeps a buy-X-get-Y promo's gift line in sync whenever its "buy" line's
 * own confirm_qty changes — whoever caused that change (an admin editing
 * Confirm Qty directly, or the pre-SAP-push live-stock cap). Recomputes
 * the gift line's confirm_qty from the SAME ratio the checkout page used
 * to grant it (floor(buyQty / promo_buy_qty) * promo_give_qty — see
 * calculateFreeQty in useCart.tsx). Not clamped to the gift line's
 * original `quantity` — confirm_qty itself can now go above the original
 * ordered quantity (an admin correcting an under-order, rounding up to a
 * case-pack size, ...), so a proportionally larger gift is the correct
 * result, not a bug; only a floor of 0 is enforced. Resets
 * customer_confirm_status the same way a direct edit would (accepted if
 * the recalculated gift qty happens to still equal its original ordered
 * quantity, pending otherwise).
 *
 * A no-op (returns null) if `buyLineId` isn't actually a buy line with an
 * attached gift (promo_buy_qty unset) or has no linked gift line.
 */
export async function recalculateLinkedGiftQty(
  buyLineId: number,
  newBuyConfirmQty: number
): Promise<GiftQtyAdjustment | null> {
  const companyId = getCompanyId();
  const buyLine = await queryOne<BuyLineRow>(
    `SELECT promo_buy_qty, promo_give_qty FROM order_lines WHERE company_id = ? AND id = ?`,
    [companyId, buyLineId]
  );
  if (!buyLine || !buyLine.promo_buy_qty || !buyLine.promo_give_qty) return null;

  const giftLine = await queryOne<GiftLineRow>(
    `SELECT id, sap_item_code, quantity, confirm_qty FROM order_lines WHERE company_id = ? AND source_line_id = ?`,
    [companyId, buyLineId]
  );
  if (!giftLine) return null;

  const newGiftConfirmQty = Math.max(0, Math.floor(newBuyConfirmQty / buyLine.promo_buy_qty) * buyLine.promo_give_qty);
  if (newGiftConfirmQty === giftLine.confirm_qty) return null;

  await query(
    `UPDATE order_lines SET confirm_qty = ?, customer_confirm_status = ? WHERE company_id = ? AND id = ?`,
    [newGiftConfirmQty, newGiftConfirmQty === giftLine.quantity ? "accepted" : "pending", companyId, giftLine.id]
  );

  return { sapItemCode: giftLine.sap_item_code, from: giftLine.confirm_qty, to: newGiftConfirmQty };
}
