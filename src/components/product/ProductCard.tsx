"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { useCart, CartItem, getCartLineKey } from "@/hooks/useCart";
import { useShowAvailable, useShowDiscounts } from "@/hooks/useAppName";
import QtyInput from "@/components/common/QtyInput";
import type { ProductWithPricing } from "@/types/product";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
}

type GiveawayOption = ProductWithPricing["giveawayOptions"][number];

interface ProductCardProps {
  product: ProductWithPricing;
  /** One FIXED selling-item + free-item pairing to render, when the item
   *  has more than one giveaway option — the page renders one ProductCard
   *  per pairing in that case (see page.tsx) rather than a single card with
   *  an in-card picker, so each pairing is its own separately addable card.
   *  Omitted (or the item has 0/1 option) falls back to the one auto-best
   *  default, same as always. */
  giveawayOverride?: GiveawayOption;
}

export default function ProductCard({ product, giveawayOverride }: ProductCardProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { items, addItem, updateQuantity, showToast } = useCart();
  const showAvailable = useShowAvailable();
  const showDiscounts = useShowDiscounts();

  // The Discount 1/Discount 2 hover tooltip is rendered via a portal
  // straight to document.body, positioned with `position: fixed` from the
  // badge's own screen coordinates — `.product-card` has `overflow: hidden`
  // (needed to clip the image to its rounded corners), which would
  // otherwise truncate an absolutely-positioned tooltip that overflows the
  // card's narrow width.
  const discountBadgeRef = useRef<HTMLSpanElement | null>(null);
  const [discountTooltipPos, setDiscountTooltipPos] = useState<{ top: number; left: number } | null>(null);

  // Full-name hover tooltip for the photo and the 2-line-clamped name — a
  // custom, high-contrast (dark bg / yellow text) tooltip instead of the
  // browser's native `title` one, which can't be styled. Portal'd like the
  // discount tooltip; flips below the element when there's no room above.
  const [nameTooltip, setNameTooltip] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const showNameTooltip = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const halfWidth = 160;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, halfWidth + 8),
      window.innerWidth - halfWidth - 8
    );
    const below = rect.top < 80;
    setNameTooltip({ top: below ? rect.bottom : rect.top, left, below });
  };
  const hideNameTooltip = () => setNameTooltip(null);

  // Product detail pop-up — opened by clicking the photo or the name (the
  // name itself is clamped to 2 lines on the card; hovering either shows the
  // full name via the native `title` tooltip). Portal'd to document.body for
  // the same overflow:hidden reason as the discount tooltip above.
  const [showDetail, setShowDetail] = useState(false);
  // Quantity the customer types in the pop-up before pressing Add to Cart —
  // reset to 1 each time the pop-up opens.
  const [detailQty, setDetailQty] = useState(1);
  const openDetail = () => { setNameTooltip(null); setDetailQty(1); setShowDetail(true); };
  useEffect(() => {
    if (!showDetail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowDetail(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDetail]);

  // Most items have 0 or 1 currently-valid promotion program; a picker only
  // renders when more than one genuinely competes for this item right now
  // (see productPricing.ts's promotionOptions/giveawayOptions — index 0 is
  // always the auto-best default). Selection resets to the server's default
  // whenever the product prop's own default changes (e.g. a page refetch).
  const promoOptions = product.promotionOptions ?? [];
  const giveawayOptionsList = product.giveawayOptions ?? [];
  const [selectedPromoCode, setSelectedPromoCode] = useState<string | undefined>(promoOptions[0]?.code ?? undefined);

  const selectedPromo = promoOptions.find((o) => o.code === selectedPromoCode) ?? promoOptions[0];
  const selectedGiveaway = giveawayOverride ?? giveawayOptionsList[0];
  const effectivePromoPct = selectedPromo?.pct ?? 0;

  // This card's own cart line identity — includes the chosen free item, so
  // two ProductCards for the same selling item but different pairings each
  // track (and add/remove/adjust) their OWN line instead of colliding.
  const lineKey = getCartLineKey({
    sapItemCode: product.sapItemCode,
    giveawayCode: selectedGiveaway?.code ?? undefined,
    promoGiveItemCode: selectedGiveaway?.giveItemCode,
    promotionCode: selectedPromo?.code ?? undefined,
  });
  // How much of THIS specific pairing is already in the cart — drives
  // whether the card shows the "Add to Cart" button or the qty stepper
  // below, so the customer can see/adjust it without opening the cart
  // sidebar (the sidebar no longer auto-opens on add — see useCart's
  // ADD_ITEM case).
  const cartQty = items.find((i) => getCartLineKey(i) === lineKey)?.quantity ?? 0;

  // product.basePrice is already net of Period Discount (see
  // mapRowToProductWithPricing) — Contract and Promotion Discount are each
  // independently a % of THIS price, not chained after it or after each
  // other, so their percentages simply add. Re-run with whichever promotion
  // the customer picked (contractDiscPct is already fixed — only the
  // Promotion Discount varies by picker choice), so switching the dropdown
  // updates price instantly with no extra network round trip.
  const combinedDiscPct = product.contractDiscPct + effectivePromoPct;
  const displayPrice = Math.max(0, product.basePrice * (1 - combinedDiscPct / 100));
  const hasDiscount = displayPrice < product.basePrice;
  const discountPercent = hasDiscount ? Math.round(combinedDiscPct) : 0;

  // SAP only ever carries one (Vietnamese) item name — item_name_en is never
  // populated by the sync (see syncItems in sap-b1/sync.ts), so on an "en"
  // locale this always falls through to the Vietnamese name rather than the
  // raw SAP item code. Same fallback chain as ReorderButton.
  const name =
    (locale === "vi" ? product.itemNameVi : product.itemNameEn) ||
    product.itemNameVi || product.itemNameEn;

  const addToCart = (quantity: number) => {
    const cartItem: CartItem = {
      sapItemCode: product.sapItemCode,
      itemName: name || product.sapItemCode,
      unitPrice: displayPrice,
      originalPrice: product.basePrice,
      quantity,
      uom: product.uom || "PCS",
      imageUrl: product.imageUrl,
      discountPercent: discountPercent,
      promoBuyQty: selectedGiveaway?.buyQty ?? product.promoBuyQty,
      promoGiveQty: selectedGiveaway?.giveQty ?? product.promoGiveQty,
      promoGiveItemCode: selectedGiveaway?.giveItemCode ?? product.promoGiveItemCode,
      promoGiveItemName: selectedGiveaway?.giveItemName ?? product.promoGiveItemName,
      extraGift: selectedGiveaway?.extra
        ? { code: selectedGiveaway.extra.code, name: selectedGiveaway.extra.name, buyQty: selectedGiveaway.extra.buyQty, giveQty: selectedGiveaway.extra.giveQty }
        : undefined,
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

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(1);
  };

  const handleDetailAddToCart = () => {
    if (detailQty < 1) return;
    addToCart(detailQty);
    setShowDetail(false);
  };

  // Decrementing to 0 auto-removes the line — updateQuantity's own
  // UPDATE_QUANTITY reducer case already filters out a quantity <= 0.
  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateQuantity(lineKey, cartQty - 1);
  };
  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateQuantity(lineKey, cartQty + 1);
  };
  const handleQtyCommit = (quantity: number) => {
    updateQuantity(lineKey, quantity);
  };

  // Shared by the card body and the detail pop-up so both always show the
  // same promotion choice and free-gift text (and switching the program in
  // either place updates both).
  const promoPicker = promoOptions.length > 1 && (
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
  );

  const giftBlock = product.hasBuyGivePromo && selectedGiveaway && (
    <div className="product-card__gift" style={{ flexDirection: "column", gap: "0.125rem" }}>
      {/* One 🎁 per free item, so the customer sees how many gifts they get.
          Promotion "case c": the bought item's own free qty first, then the other free item. */}
      {[
        ...(selectedGiveaway.extra
          ? [t("product.buyGetSamePromo", { buyQty: selectedGiveaway.extra.buyQty, giveQty: selectedGiveaway.extra.giveQty })]
          : []),
        selectedGiveaway.giveItemCode === product.sapItemCode
          ? t("product.buyGetSamePromo", {
              buyQty: selectedGiveaway.buyQty ?? 1,
              giveQty: selectedGiveaway.giveQty ?? 1,
            })
          : t("product.buyGetPromo", {
              buyQty: selectedGiveaway.buyQty ?? 1,
              giveQty: selectedGiveaway.giveQty ?? 1,
              giveItem: selectedGiveaway.giveItemName || selectedGiveaway.giveItemCode || "",
            }),
      ].map((text, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-1)" }}>
          <span aria-hidden>🎁</span>
          <span>{text}</span>
        </div>
      ))}
    </div>
  );

  return (
    <article className="product-card animate-fade-in-up" id={`product-${lineKey}`}>
      {/* Image */}
      <div
        className="product-card__image"
        onMouseEnter={showNameTooltip}
        onMouseLeave={hideNameTooltip}
        onClick={openDetail}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); } }}
      >
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
        <h3
          className="product-card__name product-card__name--clickable"
          onMouseEnter={showNameTooltip}
          onMouseLeave={hideNameTooltip}
          onClick={openDetail}
        >
          {name || product.sapItemCode}
        </h3>

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
              <span
                className="product-card__discount"
                ref={discountBadgeRef}
                onMouseEnter={() => {
                  const rect = discountBadgeRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  // Clamp so the tooltip (assumed up to ~260px wide) can't
                  // run off the left/right edge of the viewport for a card
                  // in the grid's first/last column.
                  const halfWidth = 130;
                  const left = Math.min(
                    Math.max(rect.left + rect.width / 2, halfWidth + 8),
                    window.innerWidth - halfWidth - 8
                  );
                  setDiscountTooltipPos({ top: rect.top, left });
                }}
                onMouseLeave={() => setDiscountTooltipPos(null)}
              >
                -{discountPercent}%
              </span>
              {/* Generic "Discount 1"/"Discount 2" labels only — never the
                  real discount-type names (contract/promotion) — per
                  config.json's admin.showDiscounts. Portal'd to document.body
                  (position: fixed from the badge's own screen coordinates)
                  so `.product-card`'s overflow:hidden (needed to clip the
                  image to its rounded corners) can't truncate it. */}
              {showDiscounts && discountTooltipPos && (product.contractDiscPct > 0 || effectivePromoPct > 0) &&
                createPortal(
                  <div
                    className="product-card__discount-tooltip"
                    style={{ top: discountTooltipPos.top, left: discountTooltipPos.left }}
                  >
                    {product.contractDiscPct > 0 && `${t("product.discountN", { n: 1 })}: ${product.contractDiscPct}%`}
                    {product.contractDiscPct > 0 && effectivePromoPct > 0 && " · "}
                    {effectivePromoPct > 0 && `${t("product.discountN", { n: 2 })}: ${effectivePromoPct}%`}
                  </div>,
                  document.body
                )}
            </>
          )}
        </div>

        {/* Promotion program picker — only rendered when this item genuinely
            qualifies for more than one currently-valid program at once (the
            common case is 0 or 1, where this stays invisible and the server's
            own best-match default silently applies, unchanged from before). */}
        {promoPicker}

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
        {giftBlock}

        {/* Actions */}
        <div className="product-card__actions" style={{ marginTop: "0.75rem" }}>
          {cartQty > 0 ? (
            <div className="product-card__qty-stepper" id={`qty-stepper-${lineKey}`}>
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
              id={`add-to-cart-${lineKey}`}
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

      {nameTooltip && !showDetail && createPortal(
        <div
          className={`product-card__name-tooltip${nameTooltip.below ? " product-card__name-tooltip--below" : ""}`}
          style={{ top: nameTooltip.top, left: nameTooltip.left }}
          role="tooltip"
        >
          {name || product.sapItemCode}
        </div>,
        document.body
      )}

      {showDetail && createPortal(
        <div className="product-detail-overlay" onClick={() => setShowDetail(false)}>
          <div
            className="product-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`product-detail-title-${lineKey}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="product-detail-modal__close"
              onClick={() => setShowDetail(false)}
              aria-label={t("common.close")}
            >
              ×
            </button>
            {product.imageUrl && (
              <div className="product-detail-modal__image">
                <img src={product.imageUrl} alt={name || ""} />
              </div>
            )}
            <h3 className="product-detail-modal__title" id={`product-detail-title-${lineKey}`}>
              {name || product.sapItemCode}
            </h3>
            <dl className="product-detail-modal__list">
              <dt>{t("product.itemCode")}</dt>
              <dd>{product.sapItemCode}</dd>
              <dt>{t("product.itemName")}</dt>
              <dd>{name || "—"}</dd>
              <dt>{t("product.uom")}</dt>
              <dd>{product.uom || "PCS"}</dd>
              {product.packSize && (
                <>
                  <dt>{t("product.packSize")}</dt>
                  <dd>{product.packSize}</dd>
                </>
              )}
            </dl>

            {/* Price + discounts/promotions — same figures as the card. The
                breakdown uses the generic "Discount 1"/"Discount 2" labels
                and only when config.json's admin.showDiscounts allows it. */}
            <div className="product-detail-modal__pricing">
              <div className="product-card__pricing">
                <span className="product-card__price">{formatPrice(displayPrice)}</span>
                {hasDiscount && (
                  <>
                    <span className="product-card__original-price">{formatPrice(product.basePrice)}</span>
                    <span className="product-card__discount">-{discountPercent}%</span>
                  </>
                )}
              </div>
              {showDiscounts && hasDiscount && (product.contractDiscPct > 0 || effectivePromoPct > 0) && (
                <div className="product-detail-modal__discounts">
                  {product.contractDiscPct > 0 && (
                    <span>{t("product.discountN", { n: 1 })}: {product.contractDiscPct}%</span>
                  )}
                  {effectivePromoPct > 0 && (
                    <span>{t("product.discountN", { n: 2 })}: {effectivePromoPct}%</span>
                  )}
                </div>
              )}
              {promoPicker}
              {giftBlock}
            </div>

            {/* Add to Cart with a typed quantity — adds ON TOP of whatever is
                already in the cart for this same line (ADD_ITEM sums qty). */}
            <div className="product-detail-modal__actions">
              <div className="product-card__qty-stepper">
                <button
                  type="button"
                  className="product-card__qty-btn"
                  onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                  aria-label="Decrease"
                >
                  −
                </button>
                <QtyInput
                  value={detailQty}
                  onCommit={(q) => setDetailQty(Math.max(1, q))}
                  className="product-card__qty-input"
                  ariaLabel={t("cart.quantity")}
                />
                <button
                  type="button"
                  className="product-card__qty-btn"
                  onClick={() => setDetailQty((q) => q + 1)}
                  aria-label="Increase"
                >
                  +
                </button>
              </div>
              <button type="button" className="product-card__add-btn" onClick={handleDetailAddToCart}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("product.addToCart")}
              </button>
            </div>
            {cartQty > 0 && (
              <div className="product-detail-modal__in-cart">
                {t("product.inCart", { qty: cartQty, uom: product.uom || "PCS" })}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </article>
  );
}
