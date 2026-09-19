"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useCart, calculateFreeQty } from "@/hooks/useCart";
import { Link } from "@/i18n/navigation";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
}

interface OrderLine {
  key: string;
  sapItemCode: string;
  itemName: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  originalPrice: number;
  discountPercent: number;
  isGift: boolean;
}

export default function CheckoutPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { items, subtotal, discountTotal, grandTotal, clearCart } = useCart();

  const [customerName, setCustomerName] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [remark, setRemark] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<{ orderNumber: string } | null>(null);
  const [error, setError] = useState("");

  // Prefill from the customer's own BP master data (SAP customer master),
  // still freely editable — the customer can override any of these before
  // submitting.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data?.user;
        if (!user) return;
        if (user.sapCardName || user.fullName) setCustomerName(user.sapCardName || user.fullName);
        if (user.address) setDeliveryAddress(user.address);
        if (user.email) setContactEmail(user.email);
        // BP master phone first; if the BP has none, fall back to the portal user's own phone.
        if (user.bpPhone || user.phone) setContactPhone(user.bpPhone || user.phone);
      })
      .catch(() => {
        // Not fatal — the customer can just fill the form in manually.
      });
  }, []);

  // "Buy item / give item, line by line" — a buy-give promo's free quantity
  // (recalculated live from cart quantity, see calculateFreeQty) shows as
  // its own line at 0₫, right under the paid item it came from.
  const orderLines: OrderLine[] = items.flatMap((item) => {
    const lines: OrderLine[] = [
      {
        key: item.sapItemCode,
        sapItemCode: item.sapItemCode,
        itemName: item.itemName,
        quantity: item.quantity,
        uom: item.uom,
        unitPrice: item.unitPrice,
        originalPrice: item.originalPrice,
        discountPercent: item.discountPercent,
        isGift: false,
      },
    ];
    const freeQty = calculateFreeQty(item);
    if (freeQty > 0) {
      const isSameItem = item.promoGiveItemCode === item.sapItemCode;
      lines.push({
        key: `${item.sapItemCode}-gift`,
        sapItemCode: item.promoGiveItemCode || item.sapItemCode,
        itemName: isSameItem ? item.itemName : (item.promoGiveItemName || item.promoGiveItemCode || ""),
        quantity: freeQty,
        uom: item.uom,
        unitPrice: 0,
        originalPrice: 0,
        discountPercent: 0,
        isGift: true,
      });
    }
    return lines;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          deliveryAddress,
          contactPhone,
          contactEmail,
          remark,
          language: locale,
          lines: orderLines.map((line) => ({
            sapItemCode: line.sapItemCode,
            itemName: line.itemName,
            quantity: line.quantity,
            uom: line.uom,
            unitPrice: line.unitPrice,
            originalPrice: line.originalPrice,
            discountPercent: line.discountPercent,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Order submission failed");
      }

      const data = await res.json();
      setOrderResult({ orderNumber: data.orderNumber });
      clearCart();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Order Success View ──
  if (orderResult) {
    return (
      <div className="page">
        <div className="container">
          <div className="order-success">
            <div className="order-success__icon">✓</div>
            <h1 className="order-success__title">{t("checkout.orderSuccess")}</h1>
            <div className="order-success__number">
              {t("checkout.orderNumber")}: {orderResult.orderNumber}
            </div>
            <p className="order-success__message">
              {t("checkout.orderConfirmMessage")}
            </p>
            <div style={{ display: "flex", gap: "1rem" }}>
              <Link href="/" className="btn btn-primary btn-lg">
                {t("cart.continueShopping")}
              </Link>
              <Link href="/orders" className="btn btn-secondary btn-lg">
                {t("order.title")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty Cart ──
  if (items.length === 0) {
    return (
      <div className="page">
        <div className="container">
          <div style={{
            textAlign: "center",
            padding: "4rem 2rem",
          }}>
            <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🛒</div>
            <h2 style={{ marginBottom: "0.5rem" }}>{t("cart.empty")}</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "2rem" }}>
              {t("cart.emptyMessage")}
            </p>
            <Link href="/" className="btn btn-primary btn-lg">
              {t("cart.continueShopping")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Checkout Form ──
  return (
    <div className="page">
      <div className="container">
        <div className="page__header">
          <h1 className="page__title">{t("checkout.title")}</h1>
        </div>

        <div className="checkout-layout">
          {/* Left: Delivery Form */}
          <form className="checkout-form-section" onSubmit={handleSubmit} id="checkout-form">
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "1.5rem" }}>
              {t("checkout.deliveryInfo")}
            </h2>

            {error && (
              <div style={{
                padding: "0.75rem 1rem",
                background: "var(--color-error-light)",
                color: "#991B1B",
                borderRadius: "var(--radius-lg)",
                fontSize: "0.875rem",
                fontWeight: 500,
                marginBottom: "1.5rem",
              }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div className="input-group">
                <label className="input-label" htmlFor="customerName">
                  {t("checkout.customerName")} *
                </label>
                <input type="text" className="input" id="customerName" value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)} required />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="deliveryAddress">
                  {t("checkout.deliveryAddress")} *
                </label>
                <textarea className="input" id="deliveryAddress" value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)} required
                  rows={3} style={{ resize: "vertical" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="input-group">
                  <label className="input-label" htmlFor="contactPhone">
                    {t("checkout.contactPhone")} *
                  </label>
                  <input type="tel" className="input" id="contactPhone" value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)} required placeholder="0901234567" />
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="contactEmail">
                    {t("checkout.contactEmail")}
                  </label>
                  <input type="email" className="input" id="contactEmail" value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)} placeholder="email@example.com" />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="remark">{t("checkout.remark")}</label>
                <textarea className="input" id="remark" value={remark}
                  onChange={(e) => setRemark(e.target.value)} rows={3}
                  placeholder={t("checkout.remarkPlaceholder")} style={{ resize: "vertical" }} />
              </div>
            </div>

            <button type="submit" className="btn btn-accent btn-lg"
              disabled={isSubmitting} id="submit-order"
              style={{ width: "100%", marginTop: "2rem" }}>
              {isSubmitting ? t("checkout.submitting") : t("checkout.submitOrder")}
            </button>
          </form>

          {/* Right: Order Summary */}
          <div className="checkout-summary" id="order-summary">
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "1.5rem" }}>
              {t("checkout.orderSummary")}
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              {orderLines.map((line) => (
                <div key={line.key} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  fontSize: "0.875rem", paddingBottom: "0.75rem",
                  borderBottom: "1px solid var(--color-gray-100)",
                  ...(line.isGift ? { paddingLeft: "1rem" } : {}),
                }}>
                  <div>
                    <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: "0.375rem" }}>
                      {line.isGift && <span aria-hidden>🎁</span>}
                      {line.itemName}
                      {line.isGift && (
                        <span style={{
                          fontSize: "0.6875rem", fontWeight: 700, color: "#065F46",
                          background: "var(--color-success-light)", borderRadius: "var(--radius-sm)",
                          padding: "1px 6px",
                        }}>
                          {t("checkout.giftLine")}
                        </span>
                      )}
                    </div>
                    <div style={{ color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
                      {line.quantity} × {formatPrice(line.unitPrice)}
                    </div>
                  </div>
                  <div style={{ fontWeight: 600, color: line.isGift ? "var(--color-success)" : undefined }}>
                    {formatPrice(line.unitPrice * line.quantity)}
                  </div>
                </div>
              ))}
            </div>

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
          </div>
        </div>
      </div>
    </div>
  );
}
