"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

// ── Shared style tokens (mirrors the inline-style pattern already used in customers/page.tsx) ──

export const styles = {
  page: { minHeight: "100vh", background: "var(--bg-secondary, #F8FAFC)", padding: "2rem 1rem" } as CSSProperties,
  container: { maxWidth: "1200px", margin: "0 auto" } as CSSProperties,
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem",
  } as CSSProperties,
  title: { fontSize: "1.5rem", fontWeight: 800, color: "var(--text-primary, #0F172A)" } as CSSProperties,
  subtitle: { color: "var(--text-tertiary, #94A3B8)", fontSize: "0.875rem", marginTop: "0.25rem" } as CSSProperties,
  card: {
    background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)",
    border: "1px solid var(--color-gray-200, #E2E8F0)", overflow: "hidden",
  } as CSSProperties,
  cardPadded: {
    background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)",
    border: "1px solid var(--color-gray-200, #E2E8F0)", padding: "1.5rem", marginBottom: "1.5rem",
  } as CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" } as CSSProperties,
  th: {
    padding: "0.75rem 1rem", textAlign: "left", fontWeight: 700,
    color: "var(--text-secondary, #64748B)", fontSize: "0.75rem",
    textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
    borderBottom: "2px solid var(--color-gray-200, #E2E8F0)",
  } as CSSProperties,
  td: { padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" } as CSSProperties,
  empty: { padding: "3rem", textAlign: "center", color: "var(--text-tertiary, #94A3B8)" } as CSSProperties,
  input: {
    padding: "0.5rem 0.75rem", borderRadius: "var(--radius-lg, 8px)",
    border: "1px solid var(--color-gray-200, #E2E8F0)", fontSize: "0.8125rem",
    background: "var(--bg-primary, #fff)", color: "var(--text-primary, #0F172A)",
  } as CSSProperties,
};

export function btn(variant: "primary" | "secondary" | "danger" | "success" = "secondary", disabled = false): CSSProperties {
  const base: CSSProperties = {
    padding: "0.5rem 1rem", borderRadius: "var(--radius-lg, 8px)", border: "none",
    fontSize: "0.8125rem", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, transition: "opacity 0.2s",
  };
  const variants: Record<string, CSSProperties> = {
    primary: { background: "var(--color-primary, #2BBCB3)", color: "#fff" },
    secondary: { background: "var(--bg-primary, #fff)", color: "var(--text-secondary, #64748B)", border: "1px solid var(--color-gray-200, #E2E8F0)" },
    danger: { background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5" },
    success: { background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff" },
  };
  return { ...base, ...variants[variant] };
}

/** Display titles for the `orders.status` ENUM values (the raw values stay lowercase in the DB/API). */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  processing: "Processing",
  sap_draft_created: "SAP Draft Created",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

export function Badge({ label, tone }: { label: string; tone: "success" | "warning" | "error" | "neutral" }) {
  const tones: Record<string, { bg: string; color: string }> = {
    success: { bg: "#D1FAE5", color: "#065F46" },
    warning: { bg: "#FEF3C7", color: "#92400E" },
    error: { bg: "#FEE2E2", color: "#991B1B" },
    neutral: { bg: "#F1F5F9", color: "#475569" },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: "inline-block", padding: "0.25rem 0.75rem", borderRadius: "var(--radius-full)",
      fontSize: "0.75rem", fontWeight: 600, background: t.bg, color: t.color,
    }}>
      {label}
    </span>
  );
}

/** A checkbox styled as a small on/off pill, used for is_sellable/is_active/is_visible toggles. */
export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", cursor: disabled ? "not-allowed" : "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, cursor: disabled ? "not-allowed" : "pointer" }}
      />
    </label>
  );
}

/**
 * A button that POSTs to a sync endpoint, shows a loading state, and
 * reports the result. Used across item-groups/price-lists/items/contract-discounts.
 */
export function SyncButton({
  url, label, loadingLabel, onDone, disabled = false,
}: {
  url: string;
  label: string;
  loadingLabel?: string;
  onDone?: (result: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleClick = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      // Some endpoints (e.g. the SAP push) return the underlying reason in `message`.
      if (!res.ok) throw new Error([data.error || "Sync failed", data.message].filter(Boolean).join(" — "));
      setMessage(JSON.stringify(data));
      onDone?.(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <button onClick={handleClick} disabled={loading || disabled} style={btn("primary", loading || disabled)}>
        {loading ? (loadingLabel || "Syncing...") : label}
      </button>
      {message && <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{message}</span>}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} style={{
      padding: "0.5rem 1rem", borderRadius: "var(--radius-lg, 8px)",
      fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)",
      border: "1px solid var(--color-gray-200, #E2E8F0)",
      textDecoration: "none", fontWeight: 500,
      background: "var(--bg-primary, #fff)",
    }}>
      {label}
    </a>
  );
}

export function LoadingOrEmpty({ isLoading, isEmpty, emptyLabel }: { isLoading: boolean; isEmpty: boolean; emptyLabel: string }) {
  if (isLoading) return <div style={styles.empty}>Loading...</div>;
  if (isEmpty) return <div style={styles.empty}><div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📋</div><p style={{ fontWeight: 600 }}>{emptyLabel}</p></div>;
  return null;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={styles.cardPadded}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "1rem", color: "var(--text-primary, #0F172A)" }}>{title}</h2>
      {children}
    </div>
  );
}
