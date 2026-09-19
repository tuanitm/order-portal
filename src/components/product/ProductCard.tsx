"use client";

import { useTranslations, useLocale } from "next-intl";
import { useCart, CartItem } from "@/hooks/useCart";
import type { ProductWithPricing } from "@/types/product";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
}

interface ProductCardProps {
  product: ProductWithPricing;
}

export default function ProductCard({ product }: ProductCardProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { addItem } = useCart();

  const name = locale === "vi" ? product.itemNameVi : product.itemNameEn;
  const hasDiscount = product.specialPrice !== null && product.specialPrice < product.basePrice;
  const displayPrice = hasDiscount ? product.specialPrice! : product.basePrice;
  const discountPercent = hasDiscount
    ? Math.round(((product.basePrice - product.specialPrice!) / product.basePrice) * 100)
    : 0;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cartItem: CartItem = {
      sapItemCode: product.sapItemCode,
      itemName: name || product.sapItemCode,
      unitPrice: displayPrice,
      originalPrice: product.basePrice,
      quantity: 1,
      uom: product.uom || "PCS",
      imageUrl: product.imageUrl,
      discountPercent: discountPercent,
      promoBuyQty: product.promoBuyQty,
      promoGiveQty: product.promoGiveQty,
      promoGiveItemCode: product.promoGiveItemCode,
      promoGiveItemName: product.promoGiveItemName,
    };
    addItem(cartItem);
  };

  return (
    <article className="product-card animate-fade-in-up" id={`product-${product.sapItemCode}`}>
      {/* Image */}
      <div className="product-card__image">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={name || ""} loading="lazy" />
        ) : (
          <div style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "3rem",
            color: "var(--text-tertiary)",
            background: "linear-gradient(135deg, var(--color-gray-50) 0%, var(--color-gray-100) 100%)",
          }}>
            📦
          </div>
        )}
        {/* Promo badge — any deal at all (percent off and/or a bonus-item promo) */}
        {(product.hasPromotion || product.hasBuyGivePromo) && (
          <div className="product-card__badge">
            <span className="badge badge-primary">{t("product.promotion")}</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="product-card__body">
        <h3 className="product-card__name">{name || product.sapItemCode}</h3>

        <div className="product-card__meta-row">
          <span className="product-card__code">{product.sapItemCode}</span>
          <span className="product-card__uom">{product.uom || "PCS"}</span>
        </div>

        {product.packSize && (
          <div className="product-card__pack-size">
            {t("product.packSize")}: {product.packSize}
          </div>
        )}

        {/* Pricing */}
        <div className="product-card__pricing">
          <span className="product-card__price">{formatPrice(displayPrice)}</span>
          {hasDiscount && (
            <>
              <span className="product-card__original-price">
                {formatPrice(product.basePrice)}
              </span>
              <span className="product-card__discount">-{discountPercent}%</span>
            </>
          )}
        </div>

        {/* Buy-X-Get-Y bonus item — kept visually distinct (green "gift" box)
            from the orange percent-discount badge above, so both benefits
            are legible at a glance without being confused for one another. */}
        {product.hasBuyGivePromo && (
          <div className="product-card__gift">
            <span aria-hidden>🎁</span>
            <span>
              {product.promoGiveItemCode === product.sapItemCode
                ? t("product.buyGetSamePromo", {
                    buyQty: product.promoBuyQty ?? 1,
                    giveQty: product.promoGiveQty ?? 1,
                  })
                : t("product.buyGetPromo", {
                    buyQty: product.promoBuyQty ?? 1,
                    giveQty: product.promoGiveQty ?? 1,
                    giveItem: product.promoGiveItemName || product.promoGiveItemCode || "",
                  })}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="product-card__actions" style={{ marginTop: "0.75rem" }}>
          <button
            className="product-card__add-btn"
            onClick={handleAddToCart}
            id={`add-to-cart-${product.sapItemCode}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("product.addToCart")}
          </button>
        </div>
      </div>
    </article>
  );
}
