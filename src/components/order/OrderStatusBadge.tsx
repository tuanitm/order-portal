"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";

interface HistoryEntry {
  status: string;
  created_at: string;
}

function formatDateTime(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/**
 * The order's status label, clickable: opens a popup timeline of every
 * status the order has been through, newest at the top and the original
 * "submitted" step at the bottom, each with its time.
 */
export default function OrderStatusBadge({
  orderId,
  status,
  large = false,
}: {
  orderId: number;
  status: string;
  large?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const label = (s: string) => t(`order.statusLabels.${s}` as Parameters<typeof t>[0]);

  const open = async () => {
    setIsOpen(true);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const data = res.ok ? await res.json() : null;
      setHistory(data?.history ?? []);
    } catch {
      setHistory([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`status-badge status-badge--${status}`}
        onClick={open}
        title={t("order.statusHistory")}
        style={{
          border: "none", cursor: "pointer", font: "inherit", fontWeight: 600,
          ...(large ? { fontSize: "0.875rem", padding: "0.5rem 1rem" } : {}),
        }}
      >
        {label(status)}
      </button>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
        >
          <div
            role="dialog"
            aria-label={t("order.statusHistory")}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)",
              width: "100%", maxWidth: "420px", maxHeight: "80vh", overflowY: "auto",
              padding: "1.5rem", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 700 }}>{t("order.statusHistory")}</h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label={t("common.close")}
                style={{ border: "none", background: "transparent", fontSize: "1.25rem", cursor: "pointer", color: "var(--text-tertiary)" }}
              >
                ✕
              </button>
            </div>

            {isLoading ? (
              <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-tertiary)" }}>
                {t("common.loading")}
              </div>
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {(history ?? []).map((h, i, arr) => (
                  <li key={`${h.status}-${h.created_at}-${i}`} style={{ display: "flex", gap: "0.875rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{
                        width: 14, height: 14, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                        background: i === 0 ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-300, #CBD5E1)",
                        boxShadow: i === 0 ? "0 0 0 4px var(--color-primary-50, #E8F8F7)" : "none",
                      }} />
                      {i < arr.length - 1 && (
                        <div style={{ width: 2, flex: 1, minHeight: 28, background: "var(--color-gray-200, #E2E8F0)" }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: i < arr.length - 1 ? "1.25rem" : 0 }}>
                      <div style={{ fontWeight: i === 0 ? 700 : 600, fontSize: "0.9375rem" }}>{label(h.status)}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                        {formatDateTime(h.created_at, locale)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}
