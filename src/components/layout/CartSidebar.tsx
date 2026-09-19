"use client";

import { useTranslations } from "next-intl";
import { useCart, calculateFreeQty, type CartItem } from "@/hooks/useCart";
import { Link } from "@/i18n/navigation";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
}

/**
 * Free/bonus item quantity for a buy-give promo, recalculated live from the
 * line's current quantity (see calculateFreeQty) — updates immediately as
 * the customer changes quantity in the cart.
 */
function FreeGiftLine({ item }: { item: CartItem }) {
  const t = useTranslations();
  const freeQty = calculateFreeQty(item);
  if (freeQty <= 0) return null;

  const isSameItem = item.promoGiveItemCode === item.sapItemCode;
  return (
    <div className="cart-item__free-gift">
      🎁{" "}
      {isSameItem
        ? t("cart.freeGiftSame", { qty: freeQty })
        : t("cart.freeGift", { qty: freeQty, item: item.promoGiveItemName || item.promoGiveItemCode || "" })}
    </div>
  );
}

export default function CartSidebar() {
  const t = useTranslations();
  const {
    items,
    isOpen,
    subtotal,
    discountTotal,
    grandTotal,
    closeCart,
    removeItem,
    updateQuantity,
  } = useCart();

  return (
    <>
      {/* Overlay */}
      <div
        className={`cart-overlay ${isOpen ? "open" : ""}`}
        onClick={closeCart}
        id="cart-overlay"
      />

      {/* Sidebar */}
      <aside
        className={`cart-sidebar ${isOpen ? "open" : ""}`}
        id="cart-sidebar"
        role="dialog"
        aria-label={t("cart.title")}
      >
        {/* Header */}
        <div className="cart-sidebar__header">
          <h2 className="cart-sidebar__title">
            {t("cart.title")} ({items.length})
          </h2>
          <button
            className="cart-sidebar__close"
            onClick={closeCart}
            id="cart-close"
            aria-label={t("common.close")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Items */}
        <div className="cart-sidebar__items">
          {items.length === 0 ? (
            <div className="cart-sidebar__empty">
              <div className="cart-sidebar__empty-icon">🛒</div>
              <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                {t("cart.empty")}
              </p>
              <p style={{ fontSize: "0.875rem" }}>
                {t("cart.emptyMessage")}
              </p>
            </div>
          ) : (
            items.map((item) => (
              <div className="cart-item" key={item.sapItemCode} id={`cart-item-${item.sapItemCode}`}>
                <div className="cart-item__image">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.itemName} />
                  ) : (
                    <div style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.5rem",
                      color: "var(--text-tertiary)",
                    }}>
                      📦
                    </div>
                  )}
                </div>
                <div className="cart-item__info">
                  <div className="cart-item__name">{item.itemName}</div>
                  <div className="cart-item__price">
                    {formatPrice(item.unitPrice)}
                    <span className="cart-item__uom" style={{ marginLeft: "4px", fontWeight: 400, color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
                      / {item.uom}
                    </span>
                  </div>
                  <FreeGiftLine item={item} />
                  <div className="cart-item__controls">
                    <button
                      className="cart-item__qty-btn"
                      onClick={() => updateQuantity(item.sapItemCode, item.quantity - 1)}
                      aria-label="Decrease"
                    >
                      −
                    </button>
                    <span className="cart-item__qty">{item.quantity}</span>
                    <button
                      className="cart-item__qty-btn"
                      onClick={() => updateQuantity(item.sapItemCode, item.quantity + 1)}
                      aria-label="Increase"
                    >
                      +
                    </button>
                    <button
                      className="cart-item__remove"
                      onClick={() => removeItem(item.sapItemCode)}
                      aria-label={t("cart.remove")}
                    >
                      {t("cart.remove")}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="cart-sidebar__footer">
            <div className="cart-sidebar__totals">
              <div className="cart-sidebar__total-row">
                <span>{t("cart.subtotal")}</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="cart-sidebar__total-row" style={{ color: "var(--color-success)" }}>
                  <span>{t("cart.discount")}</span>
                  <span>-{formatPrice(discountTotal)}</span>
                </div>
              )}
              <div className="cart-sidebar__total-row cart-sidebar__total-row--grand">
                <span>{t("cart.total")}</span>
                <span>{formatPrice(grandTotal)}</span>
              </div>
            </div>
            <Link
              href="/checkout"
              className="btn btn-primary btn-lg cart-sidebar__checkout-btn"
              onClick={closeCart}
              id="checkout-btn"
            >
              {t("cart.checkout")}
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
