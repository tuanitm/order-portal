"use client";

import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { use } from "react";

// Demo order details (will be replaced by API data)
const DEMO_ORDERS: Record<string, {
  id: number; orderNumber: string; customerName: string;
  deliveryAddress: string; contactPhone: string; contactEmail: string;
  subtotal: number; discountTotal: number; grandTotal: number;
  remark: string; status: string; createdAt: string;
  lines: { id: number; itemCode: string; itemName: string; quantity: number; uom: string; unitPrice: number; lineTotal: number }[];
}> = {
  "1": {
    id: 1, orderNumber: "ORD-20260913-00001", customerName: "Công ty ABC",
    deliveryAddress: "123 Nguyễn Huệ, Q1, TP.HCM", contactPhone: "0901234567",
    contactEmail: "abc@company.com", subtotal: 1496000, discountTotal: 0,
    grandTotal: 1496000, remark: "", status: "sap_draft_created",
    createdAt: "2026-09-13T10:30:00Z",
    lines: [
      { id: 1, itemCode: "SP001", itemName: "Sản phẩm A", quantity: 2, uom: "Thùng", unitPrice: 350000, lineTotal: 700000 },
      { id: 2, itemCode: "SP002", itemName: "Sản phẩm B", quantity: 3, uom: "Thùng", unitPrice: 198000, lineTotal: 594000 },
      { id: 3, itemCode: "SP003", itemName: "Sản phẩm C", quantity: 1, uom: "Hộp", unitPrice: 202000, lineTotal: 202000 },
    ],
  },
  "2": {
    id: 2, orderNumber: "ORD-20260912-00003", customerName: "Công ty ABC",
    deliveryAddress: "456 Lê Lợi, Q1, TP.HCM", contactPhone: "0901234567",
    contactEmail: "abc@company.com", subtotal: 758000, discountTotal: 0,
    grandTotal: 758000, remark: "Giao trước 10h sáng", status: "approved",
    createdAt: "2026-09-12T14:15:00Z",
    lines: [
      { id: 1, itemCode: "SP001", itemName: "Sản phẩm A", quantity: 1, uom: "Thùng", unitPrice: 350000, lineTotal: 350000 },
      { id: 2, itemCode: "SP004", itemName: "Sản phẩm D", quantity: 2, uom: "Chai", unitPrice: 204000, lineTotal: 408000 },
    ],
  },
  "3": {
    id: 3, orderNumber: "ORD-20260911-00001", customerName: "Công ty ABC",
    deliveryAddress: "789 Trần Hưng Đạo, Q5, TP.HCM", contactPhone: "0901234567",
    contactEmail: "abc@company.com", subtotal: 359000, discountTotal: 0,
    grandTotal: 359000, remark: "", status: "completed",
    createdAt: "2026-09-11T09:00:00Z",
    lines: [
      { id: 1, itemCode: "SP002", itemName: "Sản phẩm B", quantity: 1, uom: "Thùng", unitPrice: 198000, lineTotal: 198000 },
      { id: 2, itemCode: "SP005", itemName: "Sản phẩm E", quantity: 1, uom: "Hộp", unitPrice: 161000, lineTotal: 161000 },
    ],
  },
};

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + "₫";
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
  const order = DEMO_ORDERS[id];

  if (!order) {
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
                {order.orderNumber}
              </h1>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                {formatDate(order.createdAt, locale)}
              </p>
            </div>
            <span className={`status-badge status-badge--${order.status}`} style={{ fontSize: "0.875rem", padding: "0.5rem 1rem" }}>
              {t(`order.statusLabels.${order.status}` as Parameters<typeof t>[0])}
            </span>
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
                <div style={{ fontWeight: 600 }}>{order.customerName}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.contactPhone")}</div>
                <div style={{ fontWeight: 600 }}>{order.contactPhone}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.contactEmail")}</div>
                <div style={{ fontWeight: 600 }}>{order.contactEmail}</div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "0.125rem" }}>{t("checkout.deliveryAddress")}</div>
                <div style={{ fontWeight: 600 }}>{order.deliveryAddress}</div>
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
                  {order.lines.map((line) => (
                    <tr key={line.id} style={{ borderBottom: "1px solid var(--color-gray-200)" }}>
                      <td style={{ padding: "0.625rem 1.25rem", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-secondary)" }}>{line.itemCode}</td>
                      <td style={{ padding: "0.625rem 1.25rem", fontWeight: 600 }}>{line.itemName}</td>
                      <td style={{ padding: "0.625rem 1.25rem", textAlign: "center" }}>{line.quantity} {line.uom}</td>
                      <td style={{ padding: "0.625rem 1.25rem", textAlign: "right" }}>{formatPrice(line.unitPrice)}</td>
                      <td style={{ padding: "0.625rem 1.25rem", textAlign: "right", fontWeight: 700 }}>{formatPrice(line.lineTotal)}</td>
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
              <span style={{ fontWeight: 600 }}>{formatPrice(order.subtotal)}</span>
            </div>
            {order.discountTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", width: "250px" }}>
                <span style={{ color: "var(--text-secondary)" }}>{t("cart.discount")}</span>
                <span style={{ fontWeight: 600, color: "#DC2626" }}>-{formatPrice(order.discountTotal)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", width: "250px", paddingTop: "0.5rem", borderTop: "2px solid var(--color-gray-200)" }}>
              <span style={{ fontWeight: 700, fontSize: "1rem" }}>{t("cart.total")}</span>
              <span style={{ fontWeight: 800, fontSize: "1.125rem", color: "var(--color-primary-dark)" }}>{formatPrice(order.grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
