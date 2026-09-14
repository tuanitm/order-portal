"use client";

import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import ProductCard from "@/components/product/ProductCard";
import type { ProductWithPricing } from "@/types/product";

// ── Demo Products (will be replaced by API data) ──
const DEMO_PRODUCTS: ProductWithPricing[] = [
  {
    id: 1, sapItemCode: "KMD-SBN150", itemNameVi: "Bình Silicon Nâu 150ml (Núm 1 Tia)",
    itemNameEn: "Brown Silicone Bottle 150ml (Single Flow Nipple)", uom: "PCS",
    packSize: "1 PCS", category: "Bình sữa", basePrice: 359000, imageUrl: null,
    isActive: true, displayPrice: 359000, specialPrice: null, discountPercent: null, hasPromotion: false,
  },
  {
    id: 2, sapItemCode: "KMD-SBN250", itemNameVi: "Bình Silicon Nâu 250ml (Núm 3 Tia)",
    itemNameEn: "Brown Silicone Bottle 250ml (Triple Flow Nipple)", uom: "PCS",
    packSize: "1 PCS", category: "Bình sữa", basePrice: 379000, imageUrl: null,
    isActive: true, displayPrice: 329000, specialPrice: 329000, discountPercent: 13, hasPromotion: true,
  },
  {
    id: 3, sapItemCode: "KMD-SBT150", itemNameVi: "Bình Silicon Trắng 150ml (Núm 1 Tia)",
    itemNameEn: "White Silicone Bottle 150ml (Single Flow Nipple)", uom: "PCS",
    packSize: "1 PCS", category: "Bình sữa", basePrice: 359000, imageUrl: null,
    isActive: true, displayPrice: 299000, specialPrice: 299000, discountPercent: 17, hasPromotion: true,
  },
  {
    id: 4, sapItemCode: "KMD-SBT250", itemNameVi: "Bình Silicon Trắng 250ml (Núm 3 Tia)",
    itemNameEn: "White Silicone Bottle 250ml (Triple Flow Nipple)", uom: "PCS",
    packSize: "1 PCS", category: "Bình sữa", basePrice: 379000, imageUrl: null,
    isActive: true, displayPrice: 379000, specialPrice: null, discountPercent: null, hasPromotion: false,
  },
  {
    id: 5, sapItemCode: "KMD-PPSU210", itemNameVi: "Bình Nhựa PPSU 210ml (Núm 1 Tia)",
    itemNameEn: "PPSU Plastic Bottle 210ml (Single Flow Nipple)", uom: "PCS",
    packSize: "1 PCS", category: "Bình sữa", basePrice: 389000, imageUrl: null,
    isActive: true, displayPrice: 339000, specialPrice: 339000, discountPercent: 13, hasPromotion: true,
  },
  {
    id: 6, sapItemCode: "KMD-PPSU300", itemNameVi: "Bình Nhựa PPSU 300ml (Núm 3 Tia)",
    itemNameEn: "PPSU Plastic Bottle 300ml (Triple Flow Nipple)", uom: "PCS",
    packSize: "1 PCS", category: "Bình sữa", basePrice: 399000, imageUrl: null,
    isActive: true, displayPrice: 399000, specialPrice: null, discountPercent: null, hasPromotion: false,
  },
  {
    id: 7, sapItemCode: "KMD-BCQ01", itemNameVi: "Bộ Cọ Bình Sữa",
    itemNameEn: "Bottle Cleaning Brush Set", uom: "SET",
    packSize: "1 SET", category: "Phụ kiện", basePrice: 89000, imageUrl: null,
    isActive: true, displayPrice: 0, specialPrice: 0, discountPercent: 100, hasPromotion: true,
  },
  {
    id: 8, sapItemCode: "KMD-NUM01", itemNameVi: "Núm Ti Silicone Size S (0-3 tháng)",
    itemNameEn: "Silicone Nipple Size S (0-3 months)", uom: "PACK",
    packSize: "2 PCS/PACK", category: "Phụ kiện", basePrice: 119000, imageUrl: null,
    isActive: true, displayPrice: 99000, specialPrice: 99000, discountPercent: 17, hasPromotion: false,
  },
];

const CATEGORIES = ["Bình sữa", "Phụ kiện"];
const CATEGORIES_EN: Record<string, string> = {
  "Bình sữa": "Bottles",
  "Phụ kiện": "Accessories",
};

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    return DEMO_PRODUCTS.filter((product) => {
      // Category filter
      if (activeCategory && product.category !== activeCategory) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = locale === "vi" ? product.itemNameVi : product.itemNameEn;
        return (
          (name?.toLowerCase().includes(query)) ||
          product.sapItemCode.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [searchQuery, activeCategory, locale]);

  return (
    <div className="page">
      <div className="container">
        {/* Hero Section */}
        <section style={{
          background: "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 50%, #167872 100%)",
          borderRadius: "var(--radius-2xl)",
          padding: "3rem 2.5rem",
          marginBottom: "2rem",
          color: "white",
          position: "relative",
          overflow: "hidden",
        }} id="hero-section">
          <div style={{ position: "relative", zIndex: 1 }}>
            <h1 style={{
              fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
              fontWeight: 800,
              marginBottom: "0.75rem",
              lineHeight: 1.2,
            }}>
              {locale === "vi"
                ? "Đặt hàng nhanh chóng & tiện lợi"
                : "Fast & Convenient Ordering"}
            </h1>
            <p style={{
              fontSize: "1rem",
              opacity: 0.9,
              maxWidth: "500px",
              lineHeight: 1.6,
            }}>
              {locale === "vi"
                ? "Duyệt sản phẩm, thêm vào giỏ hàng và đặt hàng trực tiếp. Đơn hàng sẽ được xử lý và xác nhận nhanh chóng."
                : "Browse products, add to cart and place orders directly. Orders are processed and confirmed quickly."}
            </p>
          </div>
          {/* Decorative circles */}
          <div style={{
            position: "absolute", top: "-40px", right: "-40px",
            width: "200px", height: "200px", borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
          }} />
          <div style={{
            position: "absolute", bottom: "-60px", right: "100px",
            width: "150px", height: "150px", borderRadius: "50%",
            background: "rgba(255,255,255,0.05)",
          }} />
        </section>

        {/* Mobile Search */}
        <div style={{ marginBottom: "1.5rem" }} className="mobile-search">
          <div style={{ position: "relative" }}>
            <svg style={{
              position: "absolute", left: "1rem", top: "50%",
              transform: "translateY(-50%)", color: "var(--text-tertiary)",
              width: "18px", height: "18px",
            }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="input"
              style={{
                paddingLeft: "2.75rem",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-primary)",
              }}
              placeholder={t("product.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              id="search-input"
            />
          </div>
        </div>

        {/* Category Filter */}
        <div className="category-filter" style={{ marginBottom: "1.5rem" }} id="category-filter">
          <button
            className={`category-chip ${!activeCategory ? "active" : ""}`}
            onClick={() => setActiveCategory(null)}
          >
            {t("common.all")}
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`category-chip ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            >
              {locale === "vi" ? cat : CATEGORIES_EN[cat] || cat}
            </button>
          ))}
        </div>

        {/* Product Count */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}>
          <h2 className="page__title" style={{ fontSize: "var(--text-xl)" }}>
            {t("nav.products")}
          </h2>
          <span style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-tertiary)",
          }}>
            {filteredProducts.length} {locale === "vi" ? "sản phẩm" : "products"}
          </span>
        </div>

        {/* Product Grid */}
        {filteredProducts.length > 0 ? (
          <div className="product-grid" id="product-grid">
            {filteredProducts.map((product, index) => (
              <div
                key={product.sapItemCode}
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            textAlign: "center",
            padding: "4rem 2rem",
            color: "var(--text-tertiary)",
          }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
            <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
              {t("common.noResults")}
            </p>
            <p style={{ fontSize: "0.875rem" }}>
              {t("product.noProducts")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
