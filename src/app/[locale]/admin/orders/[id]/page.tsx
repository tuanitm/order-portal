"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { styles, Badge, BackLink } from "../../adminUi";

const STATUSES = ["draft", "submitted", "processing", "sap_draft_created", "approved", "rejected", "completed"];
const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  draft: "neutral", submitted: "warning", processing: "warning",
  sap_draft_created: "warning", approved: "success", completed: "success", rejected: "error",
};

interface OrderDetail {
  id: number; order_number: string; customer_name: string | null; customer_email: string | null;
  delivery_address: string | null; contact_phone: string | null; subtotal: string; discount_total: string;
  grand_total: string; remark: string | null; status: string; sap_doc_entry: number | null;
  sap_doc_num: number | null; created_at: string;
}
interface OrderLine {
  id: number; sap_item_code: string; item_name: string; quantity: number; uom: string;
  unit_price: string; discount_percent: string; line_total: string;
}

function formatPrice(v: string) {
  return new Intl.NumberFormat("vi-VN").format(Number(v)) + "₫";
}

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/orders/${params.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setOrder(data.order);
    setLines(data.lines || []);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (status: string) => {
    setIsSaving(true);
    await fetch(`/api/admin/orders/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
    setIsSaving(false);
  };

  if (!order) {
    return <div style={styles.page}><div style={styles.container}>Loading...</div></div>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>{order.order_number}</h1>
            <p style={styles.subtitle}>{order.customer_name || order.customer_email}</p>
          </div>
          <BackLink href="../orders" label="← Back to Orders" />
        </div>

        <div style={{ ...styles.cardPadded }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
            <Badge label={order.status} tone={STATUS_TONE[order.status] || "neutral"} />
            <select
              value={order.status}
              disabled={isSaving}
              onChange={(e) => updateStatus(e.target.value)}
              style={styles.input}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {order.sap_doc_num && <span style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>SAP Doc #{order.sap_doc_num}</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", fontSize: "0.8125rem" }}>
            <div><strong>Address:</strong> {order.delivery_address || "—"}</div>
            <div><strong>Phone:</strong> {order.contact_phone || "—"}</div>
            <div><strong>Remark:</strong> {order.remark || "—"}</div>
          </div>
        </div>

        <div style={styles.card}>
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Item</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Unit Price</th>
                  <th style={styles.th}>Discount %</th>
                  <th style={styles.th}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td style={styles.td}>{l.item_name} <span style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>({l.sap_item_code})</span></td>
                    <td style={styles.td}>{l.quantity} {l.uom}</td>
                    <td style={styles.td}>{formatPrice(l.unit_price)}</td>
                    <td style={styles.td}>{l.discount_percent}%</td>
                    <td style={styles.td}>{formatPrice(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "1rem", textAlign: "right", fontSize: "0.875rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)" }}>
            <div>Subtotal: {formatPrice(order.subtotal)}</div>
            <div>Discount: -{formatPrice(order.discount_total)}</div>
            <div style={{ fontWeight: 700, fontSize: "1rem", marginTop: "0.25rem" }}>Total: {formatPrice(order.grand_total)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
