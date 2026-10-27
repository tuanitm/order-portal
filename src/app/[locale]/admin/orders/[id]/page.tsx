"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { styles, btn, Badge, BackLink, SyncButton, ORDER_STATUS_LABELS } from "../../adminUi";
import SelfCreateOrderDialog, { type DuplicateSource } from "../SelfCreateOrderDialog";

// 'cancelled' is excluded from the dropdown — it's set exclusively via the
// dedicated "Cancel Order" button below, which also removes the SAP Draft
// if one was already pushed (see POST .../cancel). It stays in
// ORDER_STATUS_LABELS/STATUS_TONE so an already-cancelled order still
// displays correctly.
const STATUSES = ["draft", "submitted", "processing", "sap_draft_created", "approved", "delivered", "rejected", "completed"];
const TERMINAL_STATUSES = ["cancelled", "completed", "rejected"];
const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  draft: "neutral", submitted: "warning", processing: "warning",
  sap_draft_created: "warning", approved: "success", delivered: "success",
  completed: "success", rejected: "error", cancelled: "neutral",
};

interface OrderDetail {
  id: number; order_number: string; customer_name: string | null; customer_email: string | null;
  delivery_address: string | null; contact_phone: string | null; subtotal: string; discount_total: string;
  grand_total: string; remark: string | null; status: string; sap_doc_entry: number | null;
  sap_doc_num: number | null; sap_so_number: string | null; created_at: string;
  sap_card_code: string | null; sap_card_name: string | null;
  warehouse_code: string | null;
  /** Set on orders an admin created with "Self create" (see schema.sql). */
  created_by_admin_id: number | null; created_by_admin_email: string | null;
  bill_to_code: string | null; billing_address: string | null; ship_to_code: string | null;
  supervisor_code: string | null; supervisor_name: string | null;
}
interface OrderLine {
  id: number; sap_item_code: string; item_name: string; quantity: number; uom: string;
  base_unit_price: string; unit_price: string; discount_percent: string; line_total: string;
  confirm_qty: number; customer_confirm_status: "pending" | "accepted" | "rejected";
  brand_code: string | null; brand_name: string | null;
  avail_qty: number | null;
  // Already returned by GET /api/admin/orders/[id] (SELECT ol.*) — just not
  // typed/rendered here until now. is_gift_line/source_line_id/promo_buy_qty/
  // promo_give_qty existed before; remark/period_disc_pct/contract_disc_pct/
  // promo_disc_pct are new columns (Excel Import + discount-breakdown work).
  is_gift_line: number;
  source_line_id: number | null;
  promo_buy_qty: number | null;
  promo_give_qty: number | null;
  remark: string | null;
  period_disc_pct: string | null;
  contract_disc_pct: string | null;
  promo_disc_pct: string | null;
  // Which specific promotion PROGRAM the customer chose on the product
  // card (Business Brand/Promotion Program control) — see order_lines.
  // promotion_code/giveaway_promotion_code in schema.sql.
  promotion_code: string | null;
  promotion_name: string | null;
  giveaway_promotion_code: string | null;
  giveaway_promotion_name: string | null;
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

/** Format a discount % value to exactly 4 decimal places.
 *  e.g. 20.0003 → "20.0003%",  50.2345 → "50.2345%",  10 → "10.0000%" */
function formatDisc(v: string | null | undefined): string | null {
  const n = Number(v);
  if (!v || isNaN(n) || n <= 0) return null;
  return n.toFixed(4) + "%";
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
 * stock or the shelf-life gate shows less than what was ordered. Commits on
 * blur/Enter same as before, AND auto-commits (debounced) on every change —
 * including a mouse click on the native number input's up/down spinner
 * arrows, which fires onChange without blurring the field — so a linked
 * free-item line's quantity (see saveConfirmQty's giftAdjustment patch)
 * updates right away instead of waiting for the admin to click elsewhere.
 */
function ConfirmQtyInput({ line, onSave }: { line: OrderLine; onSave: (lineId: number, qty: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(line.confirm_qty));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Shown with thousand separators (same as the Qty column) except while being edited.
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingCommit = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  useEffect(() => {
    setDraft(String(line.confirm_qty));
    clearPendingCommit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.confirm_qty]);

  useEffect(() => () => clearPendingCommit(), []);

  const commit = async (value: string) => {
    setError("");
    const parsed = parseInt(value, 10);
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

  const commitNow = () => {
    clearPendingCommit();
    commit(draft);
  };

  const handleChange = (raw: string) => {
    const value = raw.replace(/\D/g, ""); // digits only — the box is text, not type=number
    setDraft(value);
    // Debounced so typing several digits from scratch doesn't fire one
    // PATCH per keystroke; a spinner click or arrow key almost always
    // pauses right after, so it still commits within a fraction of a
    // second — blur/Enter below commit immediately on top of this.
    clearPendingCommit();
    debounceRef.current = setTimeout(() => commit(value), 350);
  };

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        disabled={saving}
        value={focused || draft === "" || !/^\d+$/.test(draft) ? draft : formatQty(Number(draft))}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={(e) => { setFocused(true); requestAnimationFrame(() => e.target.select()); }}
        onBlur={() => { setFocused(false); commitNow(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitNow();
            e.currentTarget.blur();
          }
          // Arrow keys step by 1, like the number spinner this replaced.
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const next = Math.max(0, (parseInt(draft, 10) || 0) + (e.key === "ArrowUp" ? 1 : -1));
            handleChange(String(next));
          }
        }}
        style={{ ...styles.input, width: "80px", padding: "0.25rem 0.5rem", textAlign: "right" }}
      />
      {error && <div style={{ fontSize: "0.7rem", color: "#DC2626", marginTop: "0.25rem" }}>{error}</div>}
    </div>
  );
}

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string; locale: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [duplicateFrom, setDuplicateFrom] = useState<DuplicateSource | null>(null);

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

  const [loadError, setLoadError] = useState("");
  const isPushedToSap = !!(order?.sap_doc_entry || order?.sap_doc_num);

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

  const load = useCallback(async () => {
    setLoadError("");
    const res = await fetch(`/api/admin/orders/${params.id}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      setLoadError(errData.error || `Order not found or access denied (${res.status})`);
      return;
    }
    const data = await res.json();
    const loadedOrder: OrderDetail = data.order;
    const loadedLines: OrderLine[] = data.lines || [];
    setOrder(loadedOrder);
    setLines(loadedLines);

    // Load visible warehouses for customer
    let whList: Warehouse[] = [];
    try {
      const whRes = await fetch(`/api/admin/orders/${params.id}/warehouses`);
      if (whRes.ok) {
        const whData = await whRes.json();
        whList = whData.warehouses || [];
        setWarehouses(whList);
      }
    } catch {
      // ignore warehouse fetch errors
    }

    const isPushed = !!(loadedOrder?.sap_doc_entry || loadedOrder?.sap_doc_num);
    const chosenWh = loadedOrder?.warehouse_code || (whList.length > 0 ? whList[0].code : "");
    if (chosenWh) {
      setSelectedWarehouse(chosenWh);
    }

    if (isPushed) {
      // Order already pushed to SAP: restore saved avail_qty from lines, do NOT fetch live SAP stock
      const map: Record<string, number> = {};
      for (const l of loadedLines) {
        if (l.avail_qty !== null && l.avail_qty !== undefined) {
          map[l.sap_item_code] = l.avail_qty;
        }
      }
      setAvailByItem(map);
    } else if (chosenWh) {
      // Order not pushed to SAP: fetch live inventory available from SAP
      loadStock(chosenWh);
    }
  }, [params.id, loadStock]);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfirmQty = async (lineId: number, confirmQty: number) => {
    const res = await fetch(`/api/admin/orders/${params.id}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmQty }),
    });
    const text = await res.text();
    const data: {
      error?: string;
      giftAdjustment?: { sapItemCode: string; from: number; to: number } | null;
      totals?: { subtotal: number; discountTotal: number; grandTotal: number; lines: { id: number; lineTotal: number }[] };
    } = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || `Failed to save Confirm Qty (${res.status})`);
    // Patch local state directly from THIS response instead of reloading
    // the whole order — the server already computed both this line's own
    // new confirm_qty AND, if this is the "buy" side of a buy-X-get-Y
    // promo, its linked gift line's recalculated confirm_qty
    // (giftAdjustment.to, from recalculateLinkedGiftQty) — so the free
    // item row updates in the same render, with no extra round trip.
    setLines((prev) =>
      prev.map((l): OrderLine => {
        if (l.id === lineId) {
          return { ...l, confirm_qty: confirmQty, customer_confirm_status: confirmQty === l.quantity ? "accepted" : "pending" };
        }
        if (data.giftAdjustment && l.source_line_id === lineId) {
          const to = data.giftAdjustment.to;
          return { ...l, confirm_qty: to, customer_confirm_status: to === l.quantity ? "accepted" : "pending" };
        }
        return l;
      }).map((l) => {
        // Line Total follows Cfm Qty (server recalculated — see recalculateOrderTotals).
        const t = data.totals?.lines.find((x) => x.id === l.id);
        return t ? { ...l, line_total: String(t.lineTotal) } : l;
      })
    );
    if (data.totals) {
      const { subtotal, discountTotal, grandTotal } = data.totals;
      setOrder((o) => (o ? { ...o, subtotal: String(subtotal), discount_total: String(discountTotal), grand_total: String(grandTotal) } : o));
    }
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

  if (loadError) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={{ ...styles.card, padding: "2rem" }}>
            <div style={{ color: "#DC2626", fontWeight: 600, marginBottom: "1rem" }}>{loadError}</div>
            <BackLink href="/admin/orders" label="Back to Orders" />
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return <div style={styles.page}><div style={styles.container}>Loading...</div></div>;
  }


  // "Duplicate": open the Self create dialog pre-filled with this order —
  // header and items (ordered quantity, chosen promotion / gift programs);
  // gift lines are rebuilt there, prices are today's.
  const openDuplicate = () => {
    if (!order) return;
    if (!order.sap_card_code) {
      alert("This order has no SAP customer code, so it can't be duplicated.");
      return;
    }
    setDuplicateFrom({
      orderNumber: order.order_number,
      customerCode: order.sap_card_code,
      billTo: order.bill_to_code,
      shipTo: order.ship_to_code,
      warehouse: order.warehouse_code,
      supervisor: order.supervisor_code,
      remark: order.remark,
      lines: lines.filter((l) => !l.is_gift_line).map((l) => {
        const gift = lines.find((g) => g.is_gift_line && g.source_line_id === l.id);
        return {
          sapItemCode: l.sap_item_code,
          quantity: Number(l.quantity),
          promotionCode: l.promotion_code,
          giveawayKey: gift ? `${l.giveaway_promotion_code ?? ""}::${gift.sap_item_code}` : null,
        };
      }),
    });
  };
  const duplicateButton = (
    <button
      type="button"
      onClick={openDuplicate}
      disabled={isSaving}
      title="Create a new order pre-filled with this order's customer, header and items"
      style={btn("secondary", isSaving)}
    >
      ⧉ Duplicate
    </button>
  );

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={{ ...styles.header, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div style={{ paddingTop: "0.35rem" }}>
              <BackLink href="../orders" label="← Back" />
            </div>
            <div>
              <h1 style={styles.title}>
                {order.order_number}
                {(order.sap_card_name || order.customer_name) && (
                  <span style={{
                    fontSize: "0.9rem", fontWeight: 400,
                    color: "var(--text-secondary, #64748B)",
                    marginLeft: "0.75rem",
                  }}>
                    [ {order.sap_card_name || order.customer_name || order.customer_email} ]
                  </span>
                )}
              </h1>
            </div>
          </div>
        </div>

        <div style={{ ...styles.cardPadded }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <Badge label={ORDER_STATUS_LABELS[order.status] || order.status} tone={STATUS_TONE[order.status] || "neutral"} />
            {TERMINAL_STATUSES.includes(order.status) && duplicateButton}
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
                {/* Cancel is disabled once the order is a confirmed SAP Sales Order
                    (status 'approved' from direct push) or already has a SAP SO # synced back. */}
                {duplicateButton}
                {(() => {
                  const isSapSalesOrder = order.status === "approved" || !!order.sap_so_number;
                  return (
                    <button
                      type="button"
                      onClick={cancelOrder}
                      disabled={isSaving || isSapSalesOrder}
                      title={isSapSalesOrder ? "Cannot cancel — order is already a confirmed SAP Sales Order" : undefined}
                      style={{
                        ...btn("secondary", isSaving || isSapSalesOrder),
                        color: isSapSalesOrder ? "var(--text-tertiary, #94A3B8)" : "#DC2626",
                        borderColor: isSapSalesOrder ? "var(--color-gray-200, #E2E8F0)" : "#DC2626",
                        cursor: isSapSalesOrder ? "not-allowed" : undefined,
                      }}
                    >
                      Cancel Order
                    </button>
                  );
                })()}
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

          {/* SAP SO# + Update Status — visible once the order has been pushed to SAP.
              U_DocNo (e.g. SOO261015001) is filled by SAP's own trigger after the draft
              is approved; the "Update Status" button fetches it (and DocStatus) immediately
              without waiting for the next scheduled sync run. */}
          {order.sap_doc_entry && (
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
              <div style={{ fontSize: "0.8125rem" }}>
                <span style={{ fontWeight: 600, color: "var(--text-secondary, #64748B)" }}>SAP SO #: </span>
                {order.sap_so_number
                  ? <span style={{ fontFamily: "monospace", color: "var(--color-primary, #2BBCB3)", fontWeight: 700 }}>{order.sap_so_number}</span>
                  : <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>Not yet assigned</em>
                }
              </div>
              <SyncButton
                url={`/api/admin/orders/${params.id}/sync-status`}
                label="Update Status"
                loadingLabel="Syncing from SAP..."
                onDone={(data) => {
                  if (data.changed) load();
                }}
              />
            </div>
          )}

          {/* Warehouse stock check — "Avail Qty" below is fetched live from
              SAP for whichever warehouse is selected here, not from the
              daily-synced cache (when not yet pushed to SAP); changing the warehouse
              re-fetches automatically, and "Get Stock" re-runs it manually.
              When already pushed to SAP, previously saved stock is shown and Get Stock is disabled. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #64748B)" }}>
              Warehouse:
            </label>
            <select
              value={selectedWarehouse}
              onChange={(e) => {
                const wh = e.target.value;
                setSelectedWarehouse(wh);
                if (!isPushedToSap && wh) loadStock(wh);
              }}
              disabled={isPushedToSap || warehouses.length === 0}
              style={styles.input}
            >
              {warehouses.length === 0 && <option value="">No warehouse visible to this customer</option>}
              {selectedWarehouse && !warehouses.some((w) => w.code === selectedWarehouse) && (
                <option value={selectedWarehouse}>{selectedWarehouse}</option>
              )}
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.name ? `${w.name} (${w.code})` : w.code}
                </option>
              ))}
            </select>
            <button
              onClick={() => loadStock(selectedWarehouse)}
              disabled={isPushedToSap || !selectedWarehouse || isLoadingStock}
              style={btn("secondary", isPushedToSap || !selectedWarehouse || isLoadingStock)}
              title={isPushedToSap ? "Order already pushed to SAP — live stock cannot be fetched" : undefined}
            >
              {isLoadingStock ? "Fetching stock..." : "Get Stock"}
            </button>
            {isPushedToSap && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                (Saved stock from when order was pushed to SAP)
              </span>
            )}
            {stockError && <span style={{ fontSize: "0.75rem", color: "#DC2626" }}>{stockError}</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", fontSize: "0.8125rem" }}>
            <div><strong>{order.ship_to_code ? `Ship to (${order.ship_to_code}):` : "Address:"}</strong> {order.delivery_address || "—"}</div>
            {order.bill_to_code && <div><strong>Bill to ({order.bill_to_code}):</strong> {order.billing_address || "—"}</div>}
            <div><strong>Phone:</strong> {order.contact_phone || "—"}</div>
            {order.supervisor_code && <div><strong>Sales supervisor:</strong> {order.supervisor_name || order.supervisor_code}</div>}
            <div><strong>Remark:</strong> {order.remark || "—"}</div>
            {order.created_by_admin_id && <div><strong>Created by:</strong> {order.created_by_admin_email || `admin #${order.created_by_admin_id}`} (Self create)</div>}
          </div>
        </div>

        <div style={styles.card}>
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Item Code</th>
                  <th style={styles.th}>Item Name</th>
                  <th style={styles.th}>Avail Qty</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Cfm Qty</th>
                  <th style={styles.th}>Uom</th>
                  <th style={styles.th}>Base Price</th>
                  <th style={styles.th}>STD Disc %</th>
                  <th style={styles.th}>CT Disc %</th>
                  <th style={styles.th}>PM Disc %</th>
                  <th style={styles.th}>Unit Price</th>
                  <th style={styles.th}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} style={!!l.is_gift_line ? { background: "var(--color-success-light, #ECFDF5)" } : undefined}>
                    <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{l.sap_item_code}</td>
                    <td style={styles.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        {!!l.is_gift_line && <span aria-hidden>🎁</span>}
                        {l.item_name}
                        {!!l.is_gift_line && (
                          <span style={{
                            fontSize: "0.6875rem", fontWeight: 700, color: "#065F46",
                            background: "var(--color-success-light, #ECFDF5)", borderRadius: "var(--radius-sm)",
                            padding: "1px 6px",
                          }}>
                            FREE
                          </span>
                        )}
                      </div>
                      {!!l.is_gift_line && l.giveaway_promotion_name && (
                        <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)", marginTop: "2px" }}>
                          🎁 {l.giveaway_promotion_name} {l.giveaway_promotion_code ? `(${l.giveaway_promotion_code})` : ""}
                        </div>
                      )}
                      {l.remark && (
                        <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)", marginTop: "2px" }}>
                          📝 {l.remark}
                        </div>
                      )}
                    </td>
                    <td style={{
                      ...styles.td,
                      fontWeight: 600,
                      color: ((l.sap_item_code in availByItem ? availByItem[l.sap_item_code] : l.avail_qty) ?? 0) >= l.quantity ? "#059669" : "#DC2626"
                    }}>
                      {isLoadingStock ? "…" : (
                        l.sap_item_code in availByItem
                          ? formatQty(availByItem[l.sap_item_code])
                          : (l.avail_qty !== null && l.avail_qty !== undefined ? formatQty(l.avail_qty) : "—")
                      )}
                    </td>
                    <td style={styles.td}>{formatQty(l.quantity)}</td>
                    <td style={styles.td}>
                      {l.is_gift_line ? (
                        // Free item quantity is derived from its buy line's
                        // confirm_qty x the promo's buy/give ratio (see
                        // recalculateLinkedGiftQty) — never admin-editable
                        // directly, or it could drift from that ratio. The
                        // PATCH route also rejects a direct edit server-side.
                        <div style={{ fontWeight: 600 }} title="Follows its buy line's quantity automatically">
                          {formatQty(l.confirm_qty)}
                        </div>
                      ) : (
                        <ConfirmQtyInput line={l} onSave={saveConfirmQty} />
                      )}
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
                    <td style={styles.td}>
                      {formatDisc(l.period_disc_pct) ?? <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</em>}
                    </td>
                    <td style={styles.td}>
                      {formatDisc(l.contract_disc_pct) ?? <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</em>}
                    </td>
                    <td style={styles.td}>
                      {formatDisc(l.promo_disc_pct) ?? <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</em>}
                    </td>
                    <td style={styles.td}>{formatPrice(l.unit_price)}</td>
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

      {duplicateFrom && (
        <SelfCreateOrderDialog
          locale={params.locale}
          initial={duplicateFrom}
          onClose={() => setDuplicateFrom(null)}
          onCreated={() => undefined}
        />
      )}
    </div>
  );
}
