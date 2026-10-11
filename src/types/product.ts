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

export interface ProductWithPricing extends Product {
  displayPrice: number;
  specialPrice: number | null;
  discountPercent: number | null;
  hasPromotion: boolean;
  promotionTitle?: string;
  /** Buy-X-get-Y ("bonus item") promotion, independent of the percent discount above. */
  hasBuyGivePromo: boolean;
  promoBuyQty?: number;
  promoGiveItemCode?: string;
  promoGiveItemName?: string;
  promoGiveQty?: number;
  /** On-hand minus committed, summed across this customer's resolved warehouses (their
   *  Customer Group's assigned warehouses, falling back to the globally Included ones).
   *  null when stock tracking isn't active — distinct from 0 ("really out of stock"). */
  availableQty?: number | null;
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
