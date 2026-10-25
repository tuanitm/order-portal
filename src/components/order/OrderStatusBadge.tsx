"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";

interface HistoryEntry {
  status: string;
  created_at: string;
}

/** The order's normal, in-order lifecycle. "draft"/"rejected"/"cancelled"
 * are deliberately excluded — draft orders are never shown to the
 * customer, and rejected/cancelled are alternate endings appended after
 * whichever of these stages the order actually reached (see RoadmapStep
 * below), not steps on this main line. */
const LIFECYCLE_STAGES = ["submitted", "processing", "sap_draft_created", "approved", "completed"];

interface RoadmapStep {
  status: string;
  /** Real timestamp if this exact status has a history row, otherwise null
   * for a stage that's either upcoming, or already passed through without
   * ever being recorded on its own (e.g. an order pushed straight from
   * "submitted" to "sap_draft_created" skips recording "processing"). */
  time: string | null;
  done: boolean;
  /** The branch an order left the main lifecycle on, if any. */
  isException?: "rejected" | "cancelled";
}

/** Turns the raw history rows into the full fixed-stage roadmap: every
 * lifecycle stage up to and including the furthest one reached is marked
 * done (using its own recorded time where one exists), everything after
 * it is upcoming. If the order was rejected/cancelled, that's appended as
 * a final, distinctly-styled step and nothing further down the normal
 * lifecycle is shown, since it will now never happen. */
function buildRoadmap(history: HistoryEntry[]): RoadmapStep[] {
  const timeByStatus = new Map<string, string>();
  for (const h of history) {
    if (!timeByStatus.has(h.status)) timeByStatus.set(h.status, h.created_at);
  }

  const exception = history.find((h) => h.status === "rejected" || h.status === "cancelled");

  const maxReachedIndex = history.reduce((max, h) => {
    const idx = LIFECYCLE_STAGES.indexOf(h.status);
    return idx > max ? idx : max;
  }, -1);

  const steps: RoadmapStep[] = LIFECYCLE_STAGES.map((status, i) => ({
    status,
    time: timeByStatus.get(status) ?? null,
    done: i <= maxReachedIndex,
  })).filter((step) => !exception || step.done); // stages after the exception never happened

  if (exception) {
    steps.push({
      status: exception.status,
      time: exception.created_at,
      done: true,
      isException: exception.status as "rejected" | "cancelled",
    });
  }

  return steps;
}

function formatDateTime(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/**
 * The order's status label, clickable: opens a popup showing the FULL
 * order lifecycle roadmap (submitted → processing → pushed to SAP →
 * confirmed → completed) top to bottom, each stage already reached shown
 * with its real date/time and each stage not yet reached shown greyed
 * out with no time. If the order was rejected or cancelled, that's shown
 * as a final step after whatever stages it actually reached, and nothing
 * further down the normal lifecycle is rendered.
 */
export default function OrderStatusBadge({
  orderId,
  status,
  large = false,
  clickable = true,
}: {
  orderId: number;
  status: string;
  large?: boolean;
  /** false on the orders list page — the status history popup is only
   * reachable after opening an order's own detail page, so the list's
   * badge is a plain label there, not a button. */
  clickable?: boolean;
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

  if (!clickable) {
    return (
      <span
        className={`status-badge status-badge--${status}`}
        style={{
          fontWeight: 600,
          ...(large ? { fontSize: "0.875rem", padding: "0.5rem 1rem" } : {}),
        }}
      >
        {label(status)}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`status-badge status-badge--${status}`}
        onClick={open}
        title={t("order.statusHistory")}
        style={{
          border: "none", cursor: "pointer", font: "inherit", fontWeight: 600,
          // Always red regardless of status — overrides whatever color the
          // status-badge--${status} class would otherwise apply, per the
          // customer storefront order detail page's own request (a future
          // delivery-tracking link/QR code is meant to go right next to
          // this). Scoped to the clickable (order detail) variant only —
          // the plain non-clickable span on the orders list is unchanged.
          color: "#DC2626", background: "transparent",
          ...(large ? { fontSize: "0.875rem", padding: "0.5rem 1rem" } : {}),
        }}
      >
        {t("order.statusPrefix")}{label(status)}
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
            ) : (() => {
              const roadmap = buildRoadmap(history ?? []);
              const currentIndex = roadmap.reduce((last, s, i) => (s.done ? i : last), -1);
              return (
                <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {roadmap.map((step, i, arr) => {
                    const isCurrent = i === currentIndex;
                    const dotBg = step.isException
                      ? "#DC2626"
                      : step.done
                        ? "var(--color-primary, #2BBCB3)"
                        : "var(--bg-primary, #fff)";
                    const dotBorder = step.done || step.isException
                      ? "none"
                      : "2px solid var(--color-gray-300, #CBD5E1)";
                    return (
                      <li key={step.status} style={{ display: "flex", gap: "0.875rem" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                            background: dotBg, border: dotBorder,
                            boxShadow: isCurrent ? "0 0 0 4px var(--color-primary-50, #E8F8F7)" : "none",
                          }} />
                          {i < arr.length - 1 && (
                            <div style={{
                              width: 2, flex: 1, minHeight: 28,
                              background: step.done ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-200, #E2E8F0)",
                            }} />
                          )}
                        </div>
                        <div style={{ paddingBottom: i < arr.length - 1 ? "1.25rem" : 0, opacity: step.done ? 1 : 0.55 }}>
                          <div style={{
                            fontWeight: isCurrent ? 700 : 600, fontSize: "0.9375rem",
                            color: step.isException ? "#DC2626" : undefined,
                          }}>
                            {label(step.status)}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                            {step.time ? formatDateTime(step.time, locale) : t("order.statusUpcoming")}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
