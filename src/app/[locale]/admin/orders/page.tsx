"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "next-intl";
import { styles, Badge, LoadingOrEmpty, ORDER_STATUS_LABELS } from "../adminUi";

interface Order {
  id: number;
  order_number: string;
  customer_name: string | null;
  customer_email: string | null;
  grand_total: string;
  status: string;
  sap_doc_num: number | null;
  created_at: string;
}

const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  draft: "neutral", submitted: "warning", processing: "warning",
  sap_draft_created: "warning", approved: "success", completed: "success", rejected: "error",
};

function formatPrice(v: string) {
  return new Intl.NumberFormat("vi-VN").format(Number(v)) + "₫";
}

export default function AdminOrdersPage() {
  const locale = useLocale();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (s: string) => {
    setIsLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (s) params.set("status", s);
    const res = await fetch(`/api/admin/orders?${params}`);
    const data = await res.json();
    setOrders(data.orders || []);
    setTotal(data.total || 0);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load(status);
  }, [status, load]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Orders</h1>
            <p style={styles.subtitle}>{total} orders.</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          {["", "submitted", "processing", "sap_draft_created", "approved", "completed", "rejected"].map((s) => (
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
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && orders.length === 0} emptyLabel="No orders yet" />
          {!isLoading && orders.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Order #</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>SAP Doc #</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => (window.location.href = `/${locale}/admin/orders/${o.id}`)}>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontWeight: 600 }}>{o.order_number}</td>
                      <td style={styles.td}>{o.customer_name || o.customer_email || "—"}</td>
                      <td style={styles.td}>{formatPrice(o.grand_total)}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace" }}>{o.sap_doc_num || "—"}</td>
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
