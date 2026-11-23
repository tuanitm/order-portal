"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { styles, btn } from "../adminUi";

/** What the dialog needs of the order and its lines (see the order page). */
export interface EditableOrder {
  id: number;
  order_number: string;
  sap_card_code: string | null;
  sap_doc_entry: number | null;
  warehouse_code: string | null;
  bill_to_code: string | null;
  ship_to_code: string | null;
  supervisor_code: string | null;
  contact_phone: string | null;
  remark: string | null;
}
export interface EditableLine {
  id: number;
  sap_item_code: string;
  item_name: string;
  quantity: number;
  confirm_qty: number;
  uom: string;
  is_gift_line: number;
  source_line_id: number | null;
}

interface CustomerDetail {
  billTo: { name: string; address: string | null }[];
  shipTo: { name: string; address: string | null }[];
  warehouses: { code: string; name: string | null }[];
  supervisors: { code: string; name: string | null }[];
}

const label: CSSProperties = { display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #64748B)", marginBottom: 4 };
const field: CSSProperties = { ...styles.input, width: "100%", boxSizing: "border-box" };

/**
 * "Edit order" (Admin, Accountant, System Admin): header — warehouse,
 * bill-to / ship-to, Sales Supervisor, phone, remark — and the quantity of
 * each item. The customer stays the same; items are not added or removed (a
 * quantity of 0 drops the item, its free item with it). A staff edit is
 * final: no customer Accept/Reject. Free items follow their buy line's
 * promotion ratio. For an order already in SAP, "Save & Update SAP" also
 * PATCHes the SAP Sales Order / Draft (see POST .../confirm?mode=update).
 */
export default function EditOrderDialog({
  order, lines, onClose, onSaved,
}: {
  order: EditableOrder;
  lines: EditableLine[];
  onClose: () => void;
  /** After a save; `sapResult` is the Update SAP response when it ran. */
  onSaved: (sapResult: Record<string, unknown> | null) => void;
}) {
  const inSap = !!order.sap_doc_entry;
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [warehouse, setWarehouse] = useState(order.warehouse_code ?? "");
  const [billTo, setBillTo] = useState(order.bill_to_code ?? "");
  const [shipTo, setShipTo] = useState(order.ship_to_code ?? "");
  const [supervisor, setSupervisor] = useState(order.supervisor_code ?? "");
  const [phone, setPhone] = useState(order.contact_phone ?? "");
  const [remark, setRemark] = useState(order.remark ?? "");
  const [qty, setQty] = useState<Record<number, string>>(() =>
    Object.fromEntries(lines.filter((l) => !l.is_gift_line).map((l) => [l.id, String(l.confirm_qty)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!order.sap_card_code) { setLoadError("This order has no SAP customer code."); return; }
    fetch(`/api/admin/orders/create/customers/${encodeURIComponent(order.sap_card_code)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Failed to load the customer (${r.status})`);
        setDetail(data);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [order.sap_card_code]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const save = async (updateSap: boolean) => {
    setError("");
    const body: Record<string, unknown> = {};
    if (warehouse !== (order.warehouse_code ?? "")) body.warehouse = warehouse;
    if (billTo !== (order.bill_to_code ?? "")) body.billTo = billTo || null;
    if (shipTo !== (order.ship_to_code ?? "")) body.shipTo = shipTo || null;
    if (supervisor !== (order.supervisor_code ?? "")) body.supervisor = supervisor || null;
    if (phone.trim() !== (order.contact_phone ?? "")) body.contactPhone = phone.trim();
    if (remark.trim() !== (order.remark ?? "")) body.remark = remark.trim() || null;
    const lineEdits: { lineId: number; qty: number }[] = [];
    for (const l of lines.filter((x) => !x.is_gift_line)) {
      const raw = (qty[l.id] ?? "").trim();
      if (!/^\d+$/.test(raw)) { setError(`Quantity of ${l.sap_item_code} must be a whole number (0 or more)`); return; }
      if (Number(raw) !== l.confirm_qty) lineEdits.push({ lineId: l.id, qty: Number(raw) });
    }
    if (lineEdits.length) body.lines = lineEdits;
    if (!warehouse) { setError("Select a warehouse"); return; }

    setSaving(true);
    try {
      if (Object.keys(body).length) {
        const res = await fetch(`/api/admin/orders/${order.id}/edit`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      } else if (!updateSap) {
        onClose();
        return;
      }
      let sapResult: Record<string, unknown> | null = null;
      if (updateSap && inSap) {
        const res = await fetch(`/api/admin/orders/${order.id}/confirm?mode=update&warehouseCode=${encodeURIComponent(warehouse)}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The edit is saved; only the SAP update failed — the page shows "not yet in SAP".
          onSaved(null);
          alert(`Saved in the portal, but updating SAP failed:\n${[data.error, data.message].filter(Boolean).join(" — ")}\n\nFix it and use "Update SAP" on the order page.`);
          return;
        }
        sapResult = data;
      }
      onSaved(sapResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const giftsOf = (id: number) => lines.filter((g) => g.is_gift_line && g.source_line_id === id);
  const opt = (code: string, name: string | null) => (name ? `${name} (${code})` : code);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "2vh 1rem" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={`Edit order ${order.order_number}`} style={{
        background: "var(--bg-primary, #fff)", borderRadius: "var(--radius-xl, 12px)", width: "min(900px, 100%)",
        maxHeight: "96vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
      }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>✎ Edit order {order.order_number}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
              Customer {order.sap_card_code} stays the same. Quantities you set are final (no customer confirmation).
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} style={btn("secondary", saving)}>✕</button>
        </div>

        <div style={{ padding: "1rem 1.25rem", overflowY: "auto" }}>
          {loadError && <div style={{ color: "#DC2626", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{loadError}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <label style={label}>Warehouse</label>
              <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} style={field} disabled={!detail}>
                {!detail?.warehouses.some((w) => w.code === warehouse) && <option value={warehouse}>{warehouse || "— select —"}</option>}
                {detail?.warehouses.map((w) => <option key={w.code} value={w.code}>{opt(w.code, w.name)}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Sales supervisor</label>
              <select value={supervisor} onChange={(e) => setSupervisor(e.target.value)} style={field} disabled={!detail}>
                <option value="">— none —</option>
                {supervisor && !detail?.supervisors.some((s) => s.code === supervisor) && <option value={supervisor}>{supervisor}</option>}
                {detail?.supervisors.map((s) => <option key={s.code} value={s.code}>{opt(s.code, s.name)}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Bill to</label>
              <select value={billTo} onChange={(e) => setBillTo(e.target.value)} style={field} disabled={!detail}>
                <option value="">— customer default —</option>
                {billTo && !detail?.billTo.some((a) => a.name === billTo) && <option value={billTo}>{billTo}</option>}
                {detail?.billTo.map((a) => <option key={a.name} value={a.name}>{a.name}{a.address ? ` — ${a.address}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Ship to</label>
              <select value={shipTo} onChange={(e) => setShipTo(e.target.value)} style={field} disabled={!detail}>
                <option value="">— customer default —</option>
                {shipTo && !detail?.shipTo.some((a) => a.name === shipTo) && <option value={shipTo}>{shipTo}</option>}
                {detail?.shipTo.map((a) => <option key={a.name} value={a.name}>{a.name}{a.address ? ` — ${a.address}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} style={field} />
            </div>
            <div>
              <label style={label}>Remark</label>
              <input value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} style={field} />
            </div>
          </div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Item</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Ordered</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Quantity</th>
                <th style={styles.th}>Uom</th>
              </tr>
            </thead>
            <tbody>
              {lines.filter((l) => !l.is_gift_line).map((l) => (
                <tr key={l.id}>
                  <td style={styles.td}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.75rem", fontWeight: 600 }}>{l.sap_item_code}</div>
                    <div>{l.item_name}</div>
                    {giftsOf(l.id).map((g) => (
                      <div key={g.id} style={{ fontSize: "0.7rem", color: "#065F46" }}>🎁 {g.sap_item_code} — free qty follows this quantity</div>
                    ))}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>{l.quantity}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    <input
                      inputMode="numeric"
                      value={qty[l.id] ?? ""}
                      onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value.replace(/\D/g, "") }))}
                      style={{ ...styles.input, width: 90, textAlign: "right", padding: "0.25rem 0.5rem" }}
                    />
                  </td>
                  <td style={styles.td}>{l.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", marginTop: "0.5rem" }}>
            Quantity 0 drops the item (and its free item). Discounts and free quantities are recalculated.
            {inSap && " The SAP order's lines are rebuilt from the order on Update SAP; a Sales Order is checked against the SAP Approval Templates again and may need approval again."}
          </p>
          {error && <div style={{ color: "#DC2626", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{error}</div>}
        </div>

        <div style={{ padding: "0.875rem 1.25rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)", display: "flex", justifyContent: "flex-end", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} disabled={saving} style={btn("secondary", saving)}>Close</button>
          {/* An order already in SAP is always saved AND patched to SAP in one step. */}
          <button type="button" onClick={() => save(inSap)} disabled={saving || !detail} style={btn("primary", saving || !detail)}>
            {saving ? (inSap ? "Updating SAP…" : "Saving…") : inSap ? "Save & Update SAP" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
