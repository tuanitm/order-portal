"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import ProductCard from "@/components/product/ProductCard";
import type { ProductWithPricing, ProductListResponse } from "@/types/product";

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductWithPricing[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Debounced fetch whenever search/category changes
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (searchQuery) params.set("search", searchQuery);
        if (activeCategory) params.set("category", activeCategory);
        params.set("limit", "100");

        const res = await fetch(`/api/products?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Failed to load products");
        const data: ProductListResponse & { categories: string[] } = await res.json();
        setProducts(data.items);
        setTotal(data.total);
        setCategories(data.categories || []);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Failed to load products:", err);
        }
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, activeCategory]);

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
        {categories.length > 0 && (
          <div className="category-filter" style={{ marginBottom: "1.5rem" }} id="category-filter">
            <button
              className={`category-chip ${!activeCategory ? "active" : ""}`}
              onClick={() => setActiveCategory(null)}
            >
              {t("common.all")}
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`category-chip ${activeCategory === cat ? "active" : ""}`}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

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
            {total} {locale === "vi" ? "sản phẩm" : "products"}
          </span>
        </div>

        {/* Product Grid */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "4rem 2rem", color: "var(--text-tertiary)" }}>
            {t("common.loading")}
          </div>
        ) : products.length > 0 ? (
          <div className="product-grid" id="product-grid">
            {products.map((product, index) => (
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
