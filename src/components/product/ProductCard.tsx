"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useCart, CartItem } from "@/hooks/useCart";
import { useShowAvailable } from "@/hooks/useAppName";
import QtyInput from "@/components/common/QtyInput";
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
  const { items, addItem, updateQuantity, showToast } = useCart();
  const showAvailable = useShowAvailable();

  // How much of THIS item is already in the cart — drives whether the
  // card shows the "Add to Cart" button or the qty stepper below, so the
  // customer can see/adjust it without opening the cart sidebar (the
  // sidebar no longer auto-opens on add — see useCart's ADD_ITEM case).
  const cartQty = items.find((i) => i.sapItemCode === product.sapItemCode)?.quantity ?? 0;

  // Most items have 0 or 1 currently-valid promotion program; a picker only
  // renders when more than one genuinely competes for this item right now
  // (see productPricing.ts's promotionOptions/giveawayOptions — index 0 is
  // always the auto-best default). Selection resets to the server's default
  // whenever the product prop's own default changes (e.g. a page refetch).
  const promoOptions = product.promotionOptions ?? [];
  const giveawayOptionsList = product.giveawayOptions ?? [];
  const [selectedPromoCode, setSelectedPromoCode] = useState<string | undefined>(promoOptions[0]?.code ?? undefined);
  // Keyed by the FREE ITEM's own code, not the promotion program's code —
  // one program can legitimately offer a choice of several different free
  // items off the same selling item (same promotion code/name on every
  // option), so the program code alone can't tell two options apart.
  const [selectedGiveItemCode, setSelectedGiveItemCode] = useState<string | undefined>(giveawayOptionsList[0]?.giveItemCode ?? undefined);

  const selectedPromo = promoOptions.find((o) => o.code === selectedPromoCode) ?? promoOptions[0];
  const selectedGiveaway = giveawayOptionsList.find((o) => o.giveItemCode === selectedGiveItemCode) ?? giveawayOptionsList[0];
  const effectivePromoPct = selectedPromo?.pct ?? 0;

  // Re-run the same waterfall's last step with whichever promotion the
  // customer picked (periodDiscPct/contractDiscPct are already fixed —
  // only the Promotion Discount step varies by picker choice), so switching
  // the dropdown updates price instantly with no extra network round trip.
  const periodPrice = product.basePrice * (1 - product.periodDiscPct / 100);
  const contractPrice = periodPrice * (1 - product.contractDiscPct / 100);
  const displayPrice = Math.max(0, contractPrice * (1 - effectivePromoPct / 100));
  const hasDiscount = displayPrice < product.basePrice;
  const discountPercent = hasDiscount
    ? Math.round(((product.basePrice - displayPrice) / product.basePrice) * 100)
    : 0;

  // SAP only ever carries one (Vietnamese) item name — item_name_en is never
  // populated by the sync (see syncItems in sap-b1/sync.ts), so on an "en"
  // locale this always falls through to the Vietnamese name rather than the
  // raw SAP item code. Same fallback chain as ReorderButton.
  const name =
    (locale === "vi" ? product.itemNameVi : product.itemNameEn) ||
    product.itemNameVi || product.itemNameEn;

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
      promoBuyQty: selectedGiveaway?.buyQty ?? product.promoBuyQty,
      promoGiveQty: selectedGiveaway?.giveQty ?? product.promoGiveQty,
      promoGiveItemCode: selectedGiveaway?.giveItemCode ?? product.promoGiveItemCode,
      promoGiveItemName: selectedGiveaway?.giveItemName ?? product.promoGiveItemName,
      periodDiscPct: product.periodDiscPct,
      contractDiscPct: product.contractDiscPct,
      promoDiscPct: effectivePromoPct,
      promotionCode: selectedPromo?.code ?? undefined,
      promotionName: selectedPromo?.name ?? undefined,
      giveawayCode: selectedGiveaway?.code ?? undefined,
      giveawayName: selectedGiveaway?.name ?? undefined,
      brandCode: product.brandCode,
      brandName: product.brandName,
    };
    addItem(cartItem);
    showToast(t("product.addedToCart"));
  };

  // Decrementing to 0 auto-removes the line — updateQuantity's own
  // UPDATE_QUANTITY reducer case already filters out a quantity <= 0.
  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateQuantity(product.sapItemCode, cartQty - 1);
  };
  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateQuantity(product.sapItemCode, cartQty + 1);
  };
  const handleQtyCommit = (quantity: number) => {
    updateQuantity(product.sapItemCode, quantity);
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

        {/* Promotion program picker — only rendered when this item genuinely
            qualifies for more than one currently-valid program at once (the
            common case is 0 or 1, where this stays invisible and the server's
            own best-match default silently applies, unchanged from before). */}
        {promoOptions.length > 1 && (
          <select
            className="input"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.375rem", width: "100%" }}
            value={selectedPromoCode}
            onChange={(e) => setSelectedPromoCode(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            aria-label={t("product.choosePromotion")}
          >
            {promoOptions.map((o) => (
              <option key={o.code ?? o.name ?? Math.random()} value={o.code ?? ""}>
                {(o.name || o.code || t("product.promotion"))} (-{o.pct}%)
              </option>
            ))}
          </select>
        )}

        {/* Available stock — only rendered once stock tracking is active for
            this customer (availableQty is null otherwise, e.g. no warehouse
            configured yet); an out-of-stock item never reaches this card at
            all, the storefront's stock gate already excludes it. Admin can
            also hide this line entirely via config.json's admin.showAvailable
            (e.g. this business wants customers ordering freely, not anchored
            to an exact stock figure), independent of the gate itself. */}
        {showAvailable && product.availableQty !== null && product.availableQty !== undefined && (
          <div className="product-card__stock" style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginTop: "0.25rem" }}>
            {t("product.stockAvailable", { qty: product.availableQty, uom: product.uom || "" })}
          </div>
        )}

        {/* Buy-X-Get-Y bonus item — kept visually distinct (green "gift" box)
            from the orange percent-discount badge above, so both benefits
            are legible at a glance without being confused for one another. */}
        {product.hasBuyGivePromo && selectedGiveaway && (
          <div className="product-card__gift">
            <span aria-hidden>🎁</span>
            <span>
              {selectedGiveaway.giveItemCode === product.sapItemCode
                ? t("product.buyGetSamePromo", {
                    buyQty: selectedGiveaway.buyQty ?? 1,
                    giveQty: selectedGiveaway.giveQty ?? 1,
                  })
                : t("product.buyGetPromo", {
                    buyQty: selectedGiveaway.buyQty ?? 1,
                    giveQty: selectedGiveaway.giveQty ?? 1,
                    giveItem: selectedGiveaway.giveItemName || selectedGiveaway.giveItemCode || "",
                  })}
            </span>
          </div>
        )}

        {/* Buy-give program picker — same "only when 2+ genuinely compete" rule
            as the promotion picker above, BUT here "2+" means 2+ different
            free items (several options can share one promotion code/name, so
            the dropdown must be keyed and labeled by the free item itself —
            see selectedGiveItemCode above). */}
        {giveawayOptionsList.length > 1 && (
          <select
            className="input"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginTop: "0.375rem", width: "100%" }}
            value={selectedGiveItemCode}
            onChange={(e) => setSelectedGiveItemCode(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            aria-label={t("product.chooseGiveaway")}
          >
            {giveawayOptionsList.map((o) => (
              <option key={`${o.code ?? o.name ?? ""}::${o.giveItemCode}`} value={o.giveItemCode}>
                {o.giveItemCode === product.sapItemCode
                  ? t("product.buyGetSamePromo", { buyQty: o.buyQty ?? 1, giveQty: o.giveQty ?? 1 })
                  : t("product.buyGetPromo", { buyQty: o.buyQty ?? 1, giveQty: o.giveQty ?? 1, giveItem: o.giveItemName || o.giveItemCode })}
              </option>
            ))}
          </select>
        )}

        {/* Actions */}
        <div className="product-card__actions" style={{ marginTop: "0.75rem" }}>
          {cartQty > 0 ? (
            <div className="product-card__qty-stepper" id={`qty-stepper-${product.sapItemCode}`}>
              <button
                type="button"
                className="product-card__qty-btn"
                onClick={handleDecrement}
                aria-label="Decrease"
              >
                −
              </button>
              <QtyInput
                value={cartQty}
                onCommit={handleQtyCommit}
                className="product-card__qty-input"
                ariaLabel="Quantity"
              />
              <button
                type="button"
                className="product-card__qty-btn"
                onClick={handleIncrement}
                aria-label="Increase"
              >
                +
              </button>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </article>
  );
}
