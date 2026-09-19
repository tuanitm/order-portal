"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import OrderStatusBadge from "@/components/order/OrderStatusBadge";
import ReorderButton from "@/components/order/ReorderButton";
import { use } from "react";

interface OrderDetail {
  id: number;
  order_number: string;
  customer_name: string | null;
  delivery_address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  subtotal: string;
  discount_total: string;
  grand_total: string;
  remark: string | null;
  status: string;
  created_at: string;
}

interface OrderLine {
  id: number;
  sap_item_code: string;
  item_name: string;
  quantity: number;
  uom: string;
  unit_price: string;
  line_total: string;
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
}

function formatDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { id } = use(params);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/orders/${id}`, { signal: controller.signal })
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (data) {
          setOrder(data.order);
          setLines(data.lines || []);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Failed to load order:", err);
        }
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [id]);

  if (isLoading) {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: "800px", textAlign: "center", padding: "4rem 2rem", color: "var(--text-tertiary)" }}>
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: "800px", textAlign: "center", padding: "4rem 2rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
          <h2>{locale === "vi" ? "Không tìm thấy đơn hàng" : "Order not found"}</h2>
          <Link href="/orders" className="btn btn-primary" style={{ marginTop: "1.5rem" }}>
            ← {t("order.title")}
          </Link>
        </div>
      </div>
    );
  }

  const discountTotal = Number(order.discount_total);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: "800px" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <Link href="/orders" style={{
            fontSize: "0.8125rem", color: "var(--text-tertiary)",
            textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.25rem",
            marginBottom: "1rem",
          }}>
            ← {t("order.title")}
          </Link>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.25rem" }}>
                {order.order_number}
              </h1>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                {formatDate(order.created_at, locale)}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <OrderStatusBadge orderId={order.id} status={order.status} large />
              <ReorderButton orderId={order.id} />
            </div>
          </div>
        </div>

        {/* Customer Info */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-body">
            <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "1rem" }}>
              {t("checkout.deliveryInfo")}
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.customerName")}</div>
                <div style={{ fontWeight: 600 }}>{order.customer_name || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.contactPhone")}</div>
                <div style={{ fontWeight: 600 }}>{order.contact_phone || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.contactEmail")}</div>
                <div style={{ fontWeight: 600 }}>{order.contact_email || "—"}</div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.deliveryAddress")}</div>
                <div style={{ fontWeight: 600 }}>{order.delivery_address || "—"}</div>
              </div>
              {order.remark && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.remark")}</div>
                  <div style={{ fontWeight: 500, fontStyle: "italic" }}>{order.remark}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Order Lines */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-body" style={{ padding: 0 }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "1rem 1.25rem 0.75rem" }}>
              {t("checkout.orderSummary")}
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--color-gray-200)" }}>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "left", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("product.itemCode")}</th>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "left", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{locale === "vi" ? "Tên sản phẩm" : "Product Name"}</th>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "center", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("cart.quantity")}</th>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("cart.unitPrice")}</th>
                    <th style={{ padding: "0.625rem 1.25rem", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>{t("cart.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} style={{ borderBottom: "1px solid var(--color-gray-200)" }}>
                      <td style={{ padding: "0.625rem 1.25rem", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-secondary)" }}>{line.sap_item_code}</td>
                      <td style={{ padding: "0.625rem 1.25rem", fontWeight: 600 }}>{line.item_name}</td>
                      <td style={{ padding: "0.625rem 1.25rem", textAlign: "center" }}>{line.quantity} {line.uom}</td>
                      <td style={{ padding: "0.625rem 1.25rem", textAlign: "right" }}>{formatPrice(Number(line.unit_price))}</td>
                      <td style={{ padding: "0.625rem 1.25rem", textAlign: "right", fontWeight: 700 }}>{formatPrice(Number(line.line_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Totals */}
        <div className="card">
          <div className="card-body" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "250px" }}>
              <span style={{ color: "var(--text-secondary)" }}>{t("cart.subtotal")}</span>
              <span style={{ fontWeight: 600 }}>{formatPrice(Number(order.subtotal))}</span>
            </div>
            {discountTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", width: "250px" }}>
                <span style={{ color: "var(--text-secondary)" }}>{t("cart.discount")}</span>
                <span style={{ fontWeight: 600, color: "#DC2626" }}>-{formatPrice(discountTotal)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", width: "250px", paddingTop: "0.5rem", borderTop: "2px solid var(--color-gray-200)" }}>
              <span style={{ fontWeight: 700, fontSize: "1rem" }}>{t("cart.total")}</span>
              <span style={{ fontWeight: 800, fontSize: "1.125rem", color: "var(--color-primary-dark)" }}>{formatPrice(Number(order.grand_total))}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
