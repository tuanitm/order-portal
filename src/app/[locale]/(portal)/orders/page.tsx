"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import OrderStatusBadge from "@/components/order/OrderStatusBadge";
import ReorderButton from "@/components/order/ReorderButton";

interface OrderSummary {
  id: number;
  order_number: string;
  customer_name: string | null;
  grand_total: string;
  status: string;
  created_at: string;
  line_count: number;
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount) + "₫";
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
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/orders?limit=50", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { orders: [] }))
      .then((data) => setOrders(data.orders || []))
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Failed to load orders:", err);
        }
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, []);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: "900px" }}>
        <div className="page__header">
          <h1 className="page__title">{t("order.title")}</h1>
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "4rem 2rem", color: "var(--text-tertiary)" }}>
            {t("common.loading")}
          </div>
        ) : orders.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "4rem 2rem",
            color: "var(--text-tertiary)",
          }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📋</div>
            <p style={{ fontWeight: 600 }}>{t("order.noOrders")}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {orders.map((order, index) => (
              <div
                key={order.id}
                className="card animate-fade-in-up"
                style={{ animationDelay: `${index * 0.05}s` }}
                id={`order-${order.order_number}`}
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
                      {order.order_number}
                    </div>
                    <div style={{
                      fontSize: "var(--text-sm)", color: "var(--text-secondary)",
                    }}>
                      {formatDate(order.created_at, locale)} · {order.line_count}{" "}
                      {locale === "vi" ? "sản phẩm" : "items"}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", minWidth: "120px" }}>
                    <div style={{
                      fontWeight: 700, fontSize: "var(--text-lg)",
                      color: "var(--color-primary-dark)",
                      marginBottom: "0.25rem",
                    }}>
                      {formatPrice(Number(order.grand_total))}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <OrderStatusBadge orderId={order.id} status={order.status} />
                      <ReorderButton orderId={order.id} />
                    </div>
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
