"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useCart } from "@/hooks/useCart";
import type { ProductWithPricing } from "@/types/product";

interface OrderLineRow {
  sap_item_code: string;
  quantity: number;
  unit_price: string;
}

/**
 * "Đặt lại" — copies a past order's items into the cart. Quantities come
 * from the order, but prices/promotions are looked up fresh from the
 * storefront pricing API (today's price, not the old order's), and the
 * order's free-gift lines (₫0) are skipped since the cart recalculates
 * buy-give gifts itself from the quantity. Items no longer sellable are
 * skipped and reported.
 */
export default function ReorderButton({ orderId }: { orderId: number }) {
  const t = useTranslations();
  const locale = useLocale();
  const { addItem } = useCart();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");

  const reorder = async () => {
    setIsBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) throw new Error("load failed");
      const data: { lines: OrderLineRow[] } = await res.json();

      // Paid lines only, merged by item code.
      const qtyByCode = new Map<string, number>();
      for (const l of data.lines) {
        if (Number(l.unit_price) <= 0) continue;
        qtyByCode.set(l.sap_item_code, (qtyByCode.get(l.sap_item_code) || 0) + l.quantity);
      }

      const unavailable: string[] = [];
      for (const [code, quantity] of qtyByCode) {
        const pRes = await fetch(`/api/products?search=${encodeURIComponent(code)}&limit=20`);
        const pData: { items: ProductWithPricing[] } = pRes.ok ? await pRes.json() : { items: [] };
        const product = pData.items.find((p) => p.sapItemCode === code);
        if (!product) {
          unavailable.push(code);
          continue;
        }
        const name =
          (locale === "vi" ? product.itemNameVi : product.itemNameEn) ||
          product.itemNameVi || product.itemNameEn || product.sapItemCode;
        addItem({
          sapItemCode: product.sapItemCode,
          itemName: name,
          unitPrice: product.displayPrice,
          originalPrice: product.basePrice,
          quantity,
          uom: product.uom || "PCS",
          imageUrl: product.imageUrl,
          discountPercent: product.discountPercent ?? 0,
          promoBuyQty: product.promoBuyQty,
          promoGiveQty: product.promoGiveQty,
          promoGiveItemCode: product.promoGiveItemCode,
          promoGiveItemName: product.promoGiveItemName,
        });
      }

      if (unavailable.length > 0) {
        setMessage(t("order.reorderUnavailable", { count: unavailable.length, items: unavailable.join(", ") }));
      }
    } catch {
      setMessage(t("order.reorderFailed"));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={reorder}
        disabled={isBusy}
        style={{ flexShrink: 0 }}
      >
        🔁 {isBusy ? t("order.reordering") : t("order.reorder")}
      </button>
      {message && (
        <div style={{ flexBasis: "100%", fontSize: "0.75rem", color: "#B45309", textAlign: "right" }}>
          {message}
        </div>
      )}
    </>
  );
}
