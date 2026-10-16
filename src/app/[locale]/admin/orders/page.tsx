"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "next-intl";
import { styles, Badge, LoadingOrEmpty, ORDER_STATUS_LABELS } from "../adminUi";

interface Order {
  id: number;
  order_number: string;
  customer_name: string | null;
  customer_email: string | null;
  sap_card_code: string | null;
  sap_card_name: string | null;
  brand: string | null;
  grand_total: string;
  status: string;
  sap_doc_num: number | null;
  sap_so_number: string | null;
  created_at: string;
}

const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  draft: "neutral", submitted: "warning", processing: "warning",
  sap_draft_created: "warning", approved: "success", delivered: "success",
  completed: "success", rejected: "error", cancelled: "neutral",
};

function formatPrice(v: string) {
  return new Intl.NumberFormat("vi-VN").format(Number(v)) + "₫";
}

const inputStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  borderRadius: "var(--radius-md, 6px)",
  border: "1px solid var(--color-gray-200, #E2E8F0)",
  background: "var(--bg-primary, #fff)",
  color: "var(--text-primary, #0F172A)",
  fontSize: "0.8125rem",
  outline: "none",
  minWidth: "160px",
};

export default function AdminOrdersPage() {
  const locale = useLocale();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [brand, setBrand] = useState("");
  const [customer, setCustomer] = useState("");
  const [docNo, setDocNo] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Debounce text filters so we don't hammer the API on every keystroke
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (s: string, b: string, c: string, d: string) => {
    setIsLoading(true);
    const p = new URLSearchParams({ limit: "50" });
    if (s) p.set("status", s);
    if (b) p.set("brand", b);
    if (c) p.set("customer", c);
    if (d) p.set("docNo", d);
    const res = await fetch(`/api/admin/orders?${p}`);
    const data = await res.json();
    setOrders(data.orders || []);
    setTotal(data.total || 0);
    setIsLoading(false);
  }, []);

  // Status pill changes fire immediately; text filters are debounced
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(status, brand, customer, docNo);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [status, brand, customer, docNo, load]);

  const hasFilters = brand || customer || docNo;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Orders</h1>
            <p style={styles.subtitle}>{total} order{total !== 1 ? "s" : ""}{hasFilters ? " matching filters" : ""}.</p>
          </div>
        </div>

        {/* ── Text filters ─────────────────────────────────────── */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={inputStyle}
            placeholder="🔍 Brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="🔍 Customer (code or name)"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="🔍 Doc No (portal or SAP)"
            value={docNo}
            onChange={(e) => setDocNo(e.target.value)}
          />
          {hasFilters && (
            <button
              onClick={() => { setBrand(""); setCustomer(""); setDocNo(""); }}
              style={{
                padding: "0.375rem 0.75rem", borderRadius: "var(--radius-full)",
                fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
                background: "transparent", color: "var(--text-secondary, #64748B)",
                border: "1px solid var(--color-gray-200, #E2E8F0)",
              }}
            >
              ✕ Clear
            </button>
          )}
        </div>

        {/* ── Status pills ──────────────────────────────────────── */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          {["", "submitted", "processing", "sap_draft_created", "approved", "delivered", "completed", "rejected", "cancelled"].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatus(s)}
              style={{
                padding: "0.375rem 0.875rem", borderRadius: "var(--radius-full)",
                fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
                background: status === s ? "var(--color-primary, #2BBCB3)" : "var(--bg-primary, #fff)",
                color: status === s ? "#fff" : "var(--text-secondary, #64748B)",
                border: status === s ? "none" : "1px solid var(--color-gray-200, #E2E8F0)",
              }}
            >
              {s ? ORDER_STATUS_LABELS[s] || s : "All"}
            </button>
          ))}
        </div>

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && orders.length === 0} emptyLabel="No orders match" />
          {!isLoading && orders.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Brand</th>
                    <th style={styles.th}>Order #</th>
                    <th style={styles.th}>Cust Code</th>
                    <th style={styles.th}>Cust Name</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>SAP Doc #</th>
                    <th style={styles.th}>SAP SO #</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => (window.location.href = `/${locale}/admin/orders/${o.id}`)}>
                      <td style={{ ...styles.td, fontSize: "0.75rem", fontWeight: 600 }}>{o.brand || <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</em>}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontWeight: 600 }}>{o.order_number}</td>
                      <td style={styles.td}>{o.sap_card_code || "—"}</td>
                      <td style={styles.td}>{o.sap_card_name || o.customer_name || o.customer_email || "—"}</td>
                      <td style={styles.td}>{formatPrice(o.grand_total)}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace" }}>{o.sap_doc_num || "—"}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem", color: o.sap_so_number ? "var(--color-primary, #2BBCB3)" : "var(--text-tertiary, #94A3B8)" }}>
                        {o.sap_so_number || "—"}
                      </td>
                      <td style={styles.td}><Badge label={ORDER_STATUS_LABELS[o.status] || o.status} tone={STATUS_TONE[o.status] || "neutral"} /></td>
                      <td style={{ ...styles.td, fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                        {new Date(o.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

