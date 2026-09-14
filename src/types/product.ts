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
