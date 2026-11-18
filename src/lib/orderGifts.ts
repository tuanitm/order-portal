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
  promo_buy_qty: number | null;
  promo_give_qty: number | null;
}

export interface GiftQtyAdjustment {
  /** The gift line that changed. */
  lineId: number;
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
 * A buy line can have more than one gift line (promotion "case c": a
 * different free item plus the bought item itself). Each gift line uses its
 * own promo_buy_qty/promo_give_qty when set, else the buy line's (older
 * orders stored the ratio on the buy line only). Returns the gift lines that
 * changed — empty when there's nothing to recalculate.
 */
export async function recalculateLinkedGiftQty(
  buyLineId: number,
  newBuyConfirmQty: number
): Promise<GiftQtyAdjustment[]> {
  const companyId = getCompanyId();
  const buyLine = await queryOne<BuyLineRow>(
    `SELECT promo_buy_qty, promo_give_qty FROM order_lines WHERE company_id = ? AND id = ?`,
    [companyId, buyLineId]
  );
  if (!buyLine) return [];

  const giftLines = await query<GiftLineRow[]>(
    `SELECT id, sap_item_code, quantity, confirm_qty, promo_buy_qty, promo_give_qty
       FROM order_lines WHERE company_id = ? AND source_line_id = ? AND is_gift_line = TRUE`,
    [companyId, buyLineId]
  );

  const changes: GiftQtyAdjustment[] = [];
  for (const g of giftLines) {
    const buyQty = Number(g.promo_buy_qty || buyLine.promo_buy_qty);
    const giveQty = Number(g.promo_give_qty || buyLine.promo_give_qty);
    if (!buyQty || !giveQty) continue;
    const to = Math.max(0, Math.floor(newBuyConfirmQty / buyQty) * giveQty);
    if (to === g.confirm_qty) continue;
    await query(
      `UPDATE order_lines SET confirm_qty = ?, customer_confirm_status = ? WHERE company_id = ? AND id = ?`,
      [to, to === g.quantity ? "accepted" : "pending", companyId, g.id]
    );
    changes.push({ lineId: g.id, sapItemCode: g.sap_item_code, from: g.confirm_qty, to });
  }
  return changes;
}
