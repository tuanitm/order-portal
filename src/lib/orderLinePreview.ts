import type { ProductWithPricing } from "@/types/product";

/**
 * Browser-side PREVIEW of one order line: the same formulas as the server's
 * buildOrderLines (lib/adminOrderCreate.ts) — the picked promotion program's
 * % (else the best match), contract + promotion % off the period-discounted
 * base price, free quantity from the picked (else best) gift program. Only a
 * preview: the server prices every line again on save.
 */
export const giveawayKeyOf = (o: { code: string | null; giveItemCode: string }) => `${o.code ?? ""}::${o.giveItemCode}`;

export function previewLine(p: ProductWithPricing, qty: number, promotionCode: string | null, giveawayKey: string | null) {
  const promo = p.promotionOptions.find((o) => o.code === promotionCode) ?? p.promotionOptions[0];
  const promoPct = promo ? Number(promo.pct) : 0;
  const unit = Math.max(0, p.basePrice * (1 - (p.contractDiscPct + promoPct) / 100));
  const giveaway = giveawayKey === "none" ? undefined : p.giveawayOptions.find((o) => giveawayKeyOf(o) === giveawayKey) ?? p.giveawayOptions[0];
  const freeQty = giveaway && giveaway.buyQty && giveaway.giveQty ? Math.floor(qty / giveaway.buyQty) * giveaway.giveQty : 0;
  const extra = giveaway?.extra;
  const extraQty = extra && extra.buyQty && extra.giveQty ? Math.floor(qty / extra.buyQty) * extra.giveQty : 0;
  return { promo, promoPct, unit, total: Math.round(unit * qty), base: p.basePrice * qty, giveaway, freeQty, extraQty };
}
