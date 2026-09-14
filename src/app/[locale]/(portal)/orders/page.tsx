"use client";

import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";

// Demo orders (will be replaced by API data)
const DEMO_ORDERS = [
  {
    id: 1, orderNumber: "ORD-20260913-00001", customerName: "Công ty ABC",
    grandTotal: 1496000, status: "sap_draft_created", createdAt: "2026-09-13T10:30:00Z",
    lineCount: 3,
  },
  {
    id: 2, orderNumber: "ORD-20260912-00003", customerName: "Công ty ABC",
    grandTotal: 758000, status: "approved", createdAt: "2026-09-12T14:15:00Z",
    lineCount: 2,
  },
  {
    id: 3, orderNumber: "ORD-20260911-00001", customerName: "Công ty ABC",
    grandTotal: 359000, status: "completed", createdAt: "2026-09-11T09:00:00Z",
    lineCount: 1,
  },
];

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + "₫";
}

function formatDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function OrdersPage() {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: "900px" }}>
        <div className="page__header">
          <h1 className="page__title">{t("order.title")}</h1>
        </div>

        {DEMO_ORDERS.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "4rem 2rem",
            color: "var(--text-tertiary)",
          }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📋</div>
            <p style={{ fontWeight: 600 }}>{t("order.noOrders")}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {DEMO_ORDERS.map((order, index) => (
              <div
                key={order.id}
                className="card animate-fade-in-up"
                style={{ animationDelay: `${index * 0.05}s` }}
                id={`order-${order.orderNumber}`}
              >
                <div className="card-body" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "1rem", flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <div style={{
                      fontWeight: 700, fontSize: "var(--text-base)",
                      marginBottom: "0.25rem",
                    }}>
                      {order.orderNumber}
                    </div>
                    <div style={{
                      fontSize: "var(--text-sm)", color: "var(--text-secondary)",
                    }}>
                      {formatDate(order.createdAt, locale)} · {order.lineCount}{" "}
                      {locale === "vi" ? "sản phẩm" : "items"}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", minWidth: "120px" }}>
                    <div style={{
                      fontWeight: 700, fontSize: "var(--text-lg)",
                      color: "var(--color-primary-dark)",
                      marginBottom: "0.25rem",
                    }}>
                      {formatPrice(order.grandTotal)}
                    </div>
                    <span className={`status-badge status-badge--${order.status}`}>
                      {t(`order.statusLabels.${order.status}` as Parameters<typeof t>[0])}
                    </span>
                  </div>

                  <Link href={`/orders/${order.id}`} className="btn btn-ghost btn-sm"
                    style={{ flexShrink: 0 }}>
                    {t("order.detail")} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
