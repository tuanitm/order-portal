// ── Product Types ──

export interface Product {
  id: number;
  sapItemCode: string;
  itemNameVi: string;
  itemNameEn: string;
  uom: string;
  packSize: string;
  category: string;
  basePrice: number;
  imageUrl: string | null;
  isActive: boolean;
}

/** One free gift of a buy-X-get-Y program. */
export interface GiftRule { code: string | null; name: string | null; buyQty: number; giveItemCode: string; giveItemName: string | null; giveQty: number; /** Program end date YYYY-MM-DD (null = open-ended). */ validTo?: string | null; /** Portal-set program priority (1 = first); null = none. */ priority?: number | null }

/**
 * A buy-X-get-Y choice. `extra` is set when the SAME program also gives the
 * bought item itself for free (promotion "case c", e.g. GT261100022: buy 10
 * D11123501 → 1 D11123501, and buy 1 → 1 D72305104): that same-item gift is
 * granted on top of whichever different-item gift is chosen.
 */
export interface GiveawayOption extends GiftRule { extra?: GiftRule }

export interface ProductWithPricing extends Product {
  displayPrice: number;
  specialPrice: number | null;
  discountPercent: number | null;
  /** Individual waterfall percentages that compound into discountPercent above — 0 when that step didn't apply. */
  periodDiscPct: number;
  contractDiscPct: number;
  promoDiscPct: number;
  /** End date (YYYY-MM-DD) of today's period / contract discount; null = open-ended or none. */
  periodDiscValidTo?: string | null;
  contractDiscValidTo?: string | null;
  hasPromotion: boolean;
  promotionTitle?: string;
  /** The chosen (default: best-match) percent-discount program's code — see promotionOptions. */
  promotionCode?: string;
  /** Every currently-valid percent-discount program for this item, best-match first (index 0 matches promoDiscPct/promotionTitle/promotionCode above).
   *  Length > 1 means the customer qualifies for more than one program at once — the product card shows a picker only in that case. */
  promotionOptions: { code: string | null; name: string | null; pct: number; validTo?: string | null; priority?: number | null }[];
  /** Buy-X-get-Y ("bonus item") promotion, independent of the percent discount above. */
  hasBuyGivePromo: boolean;
  promoBuyQty?: number;
  promoGiveItemCode?: string;
  promoGiveItemName?: string;
  promoGiveQty?: number;
  /** The chosen (default: best-match) buy-give program's code — see giveawayOptions. */
  giveawayCode?: string;
  /** Every currently-valid buy-give program for this item, best-match first (index 0 matches the promoBuyQty/promoGiveItemCode/etc. fields above). */
  giveawayOptions: GiveawayOption[];
  /** On-hand minus committed, summed across this customer's resolved warehouses (their
   *  Customer Group's assigned warehouses, falling back to the globally Included ones).
   *  null when stock tracking isn't active — distinct from 0 ("really out of stock"). */
  availableQty?: number | null;
  /** Display-only — see src/lib/pricing/productPricing.ts's own comment on where this is (and isn't) trusted. */
  brandCode: string | null;
  brandName: string | null;
}

export interface ProductQuery {
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export interface ProductListResponse {
  items: ProductWithPricing[];
  total: number;
  page: number;
  totalPages: number;
}
