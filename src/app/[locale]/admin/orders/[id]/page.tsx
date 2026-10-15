"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { styles, btn, Badge, BackLink, SyncButton, ORDER_STATUS_LABELS } from "../../adminUi";

// 'cancelled' is excluded from the dropdown — it's set exclusively via the
// dedicated "Cancel Order" button below, which also removes the SAP Draft
// if one was already pushed (see POST .../cancel). It stays in
// ORDER_STATUS_LABELS/STATUS_TONE so an already-cancelled order still
// displays correctly.
const STATUSES = ["draft", "submitted", "processing", "sap_draft_created", "approved", "rejected", "completed"];
const TERMINAL_STATUSES = ["cancelled", "completed", "rejected"];
const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  draft: "neutral", submitted: "warning", processing: "warning",
  sap_draft_created: "warning", approved: "success", completed: "success", rejected: "error", cancelled: "neutral",
};

interface OrderDetail {
  id: number; order_number: string; customer_name: string | null; customer_email: string | null;
  delivery_address: string | null; contact_phone: string | null; subtotal: string; discount_total: string;
  grand_total: string; remark: string | null; status: string; sap_doc_entry: number | null;
  sap_doc_num: number | null; created_at: string; sap_card_code: string | null;
}
interface OrderLine {
  id: number; sap_item_code: string; item_name: string; quantity: number; uom: string;
  base_unit_price: string; unit_price: string; discount_percent: string; line_total: string;
  confirm_qty: number; customer_confirm_status: "pending" | "accepted" | "rejected";
  brand_code: string | null; brand_name: string | null;
}
interface Warehouse {
  code: string;
  name: string | null;
}
interface OrderMessage {
  id: number;
  sender_type: "admin" | "customer";
  sender_name: string | null;
  message: string;
  created_at: string;
}

function formatPrice(v: string) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(v)) + "₫";
}

function formatQty(v: number) {
  return new Intl.NumberFormat("vi-VN").format(v);
}

/**
 * The order-review message thread with the customer (not enough stock, qty
 * over available, shelf-life gate, ...) — see order_messages in schema.sql.
 * Posting here also emails the customer (see the POST route).
 */
function MessagesThread({ orderId }: { orderId: number }) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/orders/${orderId}/messages`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages || []);
    setIsLoading(false);
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setIsSending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send message");
      setDraft("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={styles.cardPadded}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "1rem" }}>Messages</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "320px", overflowY: "auto", marginBottom: "1rem" }}>
        {isLoading && <div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>Loading...</div>}
        {!isLoading && messages.length === 0 && (
          <div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>No messages yet.</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.sender_type === "admin" ? "flex-end" : "flex-start",
              maxWidth: "75%",
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius-lg, 8px)",
              background: m.sender_type === "admin" ? "var(--color-primary, #2BBCB3)" : "var(--bg-secondary, #F8FAFC)",
              color: m.sender_type === "admin" ? "#fff" : "var(--text-primary, #0F172A)",
            }}
          >
            <div style={{ fontSize: "0.7rem", fontWeight: 600, opacity: 0.8, marginBottom: "0.1875rem" }}>
              {m.sender_type === "admin" ? `Admin${m.sender_name ? ` (${m.sender_name})` : ""}` : m.sender_name || "Customer"}
              {" — "}
              {new Date(m.created_at).toLocaleString()}
            </div>
            <div style={{ fontSize: "0.8125rem", whiteSpace: "pre-wrap" }}>{m.message}</div>
          </div>
        ))}
      </div>
      {error && <div style={{ color: "#991B1B", fontSize: "0.8125rem", marginBottom: "0.5rem" }}>{error}</div>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the customer — e.g. insufficient stock, qty adjusted, shelf-life gate..."
          rows={2}
          style={{ ...styles.input, flex: 1, resize: "vertical" }}
        />
        <button onClick={send} disabled={isSending || !draft.trim()} style={btn("primary", isSending || !draft.trim())}>
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

/**
 * Typeable Confirm Qty box — defaults to the line's ordered Qty, editable
 * by the admin down to 0 (never above Qty — see the PATCH route) when live
 * stock or the shelf-life gate shows less than what was ordered. Commits
 * on blur/Enter, same pattern as the storefront cart's quantity box.
 */
function ConfirmQtyInput({ line, onSave }: { line: OrderLine; onSave: (lineId: number, qty: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(line.confirm_qty));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(String(line.confirm_qty));
  }, [line.confirm_qty]);

  const commit = async () => {
    setError("");
    const parsed = parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(line.confirm_qty));
      return;
    }
    if (parsed === line.confirm_qty) {
      setDraft(String(parsed));
      return;
    }
    setSaving(true);
    try {
      await onSave(line.id, parsed);
      setDraft(String(parsed));
    } catch (err) {
      setDraft(String(line.confirm_qty)); // revert — the save didn't actually go through
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <input
        type="number"
        min={0}
        disabled={saving}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          }
        }}
        style={{ ...styles.input, width: "80px", padding: "0.25rem 0.5rem" }}
      />
      {error && <div style={{ fontSize: "0.7rem", color: "#DC2626", marginTop: "0.25rem" }}>{error}</div>}
    </div>
  );
}

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Warehouse stock check — "Warehouse Visibility" dropdown (the warehouses
  // THIS order's customer can see) plus a live (uncached) per-item Avail
  // Qty fetched from SAP for the selected warehouse, gated by this
  // customer's customer_require_shelflife rules. Separate from order/lines
  // loading since it depends on the customer resolved from the order and
  // can be re-run on its own (warehouse change / "Get Stock").
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [availByItem, setAvailByItem] = useState<Record<string, number>>({});
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [stockError, setStockError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/orders/${params.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setOrder(data.order);
    setLines(data.lines || []);
  }, [params.id]);

  const loadStock = useCallback(async (warehouseCode: string) => {
    if (!warehouseCode) return;
    setIsLoadingStock(true);
    setStockError("");
    try {
      const res = await fetch(`/api/admin/orders/${params.id}/stock?warehouseCode=${encodeURIComponent(warehouseCode)}`);
      // The server can fail before it ever writes a JSON body (e.g. a SAP
      // timeout) — read as text first so a non-OK response never crashes
      // this with "Unexpected end of JSON input" instead of a real message.
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || `Failed to fetch stock (${res.status})`);
      const map: Record<string, number> = {};
      for (const it of data.items || []) map[it.sapItemCode] = it.availableQty;
      setAvailByItem(map);
    } catch (err) {
      setStockError(err instanceof Error ? err.message : "Failed to fetch stock");
    } finally {
      setIsLoadingStock(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the customer's visible warehouses once, then auto-select the
  // first one — which triggers the stock fetch below.
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/admin/orders/${params.id}/warehouses`);
      if (!res.ok) return;
      const data = await res.json();
      const list: Warehouse[] = data.warehouses || [];
      setWarehouses(list);
      if (list.length > 0) setSelectedWarehouse(list[0].code);
    })();
  }, [params.id]);

  // Re-fetch stock whenever the selected warehouse changes (covers both the
  // initial auto-selection and the admin picking a different one).
  useEffect(() => {
    if (selectedWarehouse) loadStock(selectedWarehouse);
  }, [selectedWarehouse, loadStock]);

  const saveConfirmQty = async (lineId: number, confirmQty: number) => {
    const res = await fetch(`/api/admin/orders/${params.id}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmQty }),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || `Failed to save Confirm Qty (${res.status})`);
    // Reload rather than patch local state in place: if this line is the
    // "buy" side of a buy-X-get-Y promo, the server also just recalculated
    // its linked gift line's own Confirm Qty — a different row, which a
    // local patch of just this one line wouldn't reflect. The reload picks
    // up that new quantity in the table directly, so no separate message
    // is shown for it.
    await load();
  };

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

  const cancelOrder = async () => {
    if (!order) return;
    const warning = order.sap_doc_entry
      ? `This order was already pushed to SAP as Doc #${order.sap_doc_num}. Cancelling will also DELETE that Draft Sales Order in SAP. Continue?`
      : "Are you sure you want to cancel this order?";
    if (!confirm(warning)) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/orders/${params.id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel order");
    } finally {
      setIsSaving(false);
    }
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
            <p style={styles.subtitle}>
              {order.sap_card_code ? `${order.sap_card_code} - ` : ""}
              {order.customer_name || order.customer_email}
            </p>
          </div>
          <BackLink href="../orders" label="← Back to Orders" />
        </div>

        <div style={{ ...styles.cardPadded }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <Badge label={ORDER_STATUS_LABELS[order.status] || order.status} tone={STATUS_TONE[order.status] || "neutral"} />
            {!TERMINAL_STATUSES.includes(order.status) && (
              <>
                <select
                  value={order.status}
                  disabled={isSaving}
                  onChange={(e) => updateStatus(e.target.value)}
                  style={styles.input}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>)}
                </select>
                {order.sap_doc_num ? (
                  <span style={{ fontSize: "0.8125rem", color: "var(--color-primary, #2BBCB3)", fontWeight: 600 }}>
                    ✓ Pushed to SAP — Doc #{order.sap_doc_num}
                  </span>
                ) : (
                  <SyncButton
                    url={`/api/admin/orders/${params.id}/confirm?warehouseCode=${encodeURIComponent(selectedWarehouse)}`}
                    label="Confirm & Push to SAP"
                    loadingLabel="Pushing to SAP..."
                    onDone={(data) => {
                      // The server re-checks live stock right before pushing
                      // and caps any line that no longer has enough — flag it
                      // clearly rather than letting it pass silently in the
                      // button's own generic JSON response blob.
                      const adjustments = (data.adjustments as { sapItemCode: string; from: number; to: number }[]) || [];
                      if (adjustments.length > 0) {
                        alert(
                          "Confirm Qty was reduced due to insufficient live stock:\n" +
                          adjustments.map((a) => `${a.sapItemCode}: ${a.from} → ${a.to}`).join("\n")
                        );
                      }
                      // Lines the customer Rejected are never sent to SAP —
                      // the rest of the order still goes through, but flag
                      // what got left out so it isn't a silent surprise.
                      const rejectedItems = (data.rejectedItems as string[]) || [];
                      if (rejectedItems.length > 0) {
                        alert(
                          "These items were rejected by the customer and were NOT included in the SAP push:\n" +
                          rejectedItems.join(", ")
                        );
                      }
                      load();
                    }}
                    disabled={!selectedWarehouse}
                  />
                )}
                <button
                  type="button"
                  onClick={cancelOrder}
                  disabled={isSaving}
                  style={{ ...btn("secondary", isSaving), color: "#DC2626", borderColor: "#DC2626" }}
                >
                  Cancel Order
                </button>
              </>
            )}
          </div>
          {!TERMINAL_STATUSES.includes(order.status) && !order.sap_doc_num && !order.sap_card_code && (
            <p style={{ fontSize: "0.75rem", color: "#DC2626", marginBottom: "1rem" }}>
              This customer has no linked SAP BP code — confirming will fail until one is set.
            </p>
          )}
          {!TERMINAL_STATUSES.includes(order.status) && !order.sap_doc_num && !selectedWarehouse && (
            <p style={{ fontSize: "0.75rem", color: "#DC2626", marginBottom: "1rem" }}>
              Select a warehouse above before confirming — it's stamped onto the SAP draft order's lines.
            </p>
          )}

          {/* Warehouse stock check — "Avail Qty" below is fetched live from
              SAP for whichever warehouse is selected here, not from the
              daily-synced cache; changing the warehouse re-fetches
              automatically, and "Get Stock" re-runs it manually. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #64748B)" }}>
              Warehouse:
            </label>
            <select
              value={selectedWarehouse}
              onChange={(e) => setSelectedWarehouse(e.target.value)}
              disabled={warehouses.length === 0}
              style={styles.input}
            >
              {warehouses.length === 0 && <option value="">No warehouse visible to this customer</option>}
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.name ? `${w.name} (${w.code})` : w.code}
                </option>
              ))}
            </select>
            <button
              onClick={() => loadStock(selectedWarehouse)}
              disabled={!selectedWarehouse || isLoadingStock}
              style={btn("secondary", !selectedWarehouse || isLoadingStock)}
            >
              {isLoadingStock ? "Fetching stock..." : "Get Stock"}
            </button>
            {stockError && <span style={{ fontSize: "0.75rem", color: "#DC2626" }}>{stockError}</span>}
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
                  <th style={styles.th}>Brand</th>
                  <th style={styles.th}>Item Code</th>
                  <th style={styles.th}>Item Name</th>
                  <th style={styles.th}>Avail Qty</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Cfm Qty</th>
                  <th style={styles.th}>Uom</th>
                  <th style={styles.th}>Base Unit Price</th>
                  <th style={styles.th}>Unit Price</th>
                  <th style={styles.th}>Discount %</th>
                  <th style={styles.th}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td style={styles.td}>{l.brand_name || <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</em>}</td>
                    <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{l.sap_item_code}</td>
                    <td style={styles.td}>{l.item_name}</td>
                    <td style={{ ...styles.td, fontWeight: 600, color: (availByItem[l.sap_item_code] ?? 0) >= l.quantity ? "#059669" : "#DC2626" }}>
                      {isLoadingStock ? "…" : (l.sap_item_code in availByItem ? formatQty(availByItem[l.sap_item_code]) : "—")}
                    </td>
                    <td style={styles.td}>{formatQty(l.quantity)}</td>
                    <td style={styles.td}>
                      <ConfirmQtyInput line={l} onSave={saveConfirmQty} />
                      {l.confirm_qty !== l.quantity && (
                        <div style={{
                          fontSize: "0.7rem", marginTop: "0.25rem", fontWeight: 600,
                          color: l.customer_confirm_status === "accepted" ? "#059669"
                               : l.customer_confirm_status === "rejected" ? "#DC2626" : "#D97706",
                        }}>
                          {l.customer_confirm_status === "accepted" && "Accepted"}
                          {l.customer_confirm_status === "rejected" && "Rejected"}
                          {l.customer_confirm_status === "pending" && "Pending"}
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>{l.uom}</td>
                    <td style={styles.td}>{formatPrice(l.base_unit_price)}</td>
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

        <MessagesThread orderId={order.id} />
      </div>
    </div>
  );
}
