"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { styles, btn } from "../adminUi";

interface Warehouse {
  code: string;
  name: string | null;
}

interface StockRow {
  whs_code: string;
  whs_name: string | null;
  item_code: string;
  item_name: string | null;
  uom: string | null;
  on_hand: number;
  committed: number;
  available: number;
  item_group: string | null;
  item_cat1: string | null;
  /** Worst (lowest) remaining shelf life among the row's batches; null = no dated batches. */
  shelf_life_pct: number | null;
  batches: Batch[];
}

type Bucket = "expired" | "0-3" | "3-6" | "6-9" | "9-12" | "12+";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "expired", label: "Expired" }, { key: "0-3", label: "0 - 3" }, { key: "3-6", label: "3 - 6" },
  { key: "6-9", label: "6 - 9" }, { key: "9-12", label: "9 - 12" }, { key: "12+", label: "12+" },
];
interface Batch {
  batch: string | null;
  lot: string | null;
  bin: string | null;
  binName: string | null;
  mnfDate: string | null;
  expDate: string | null;
  pct: number | null;
  qty: number;
  status: string;
  bucket: Bucket | null;
}

type View = "item" | "batch";
const VIEW_KEY = "imv.inventory.view";
const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const statusColor = (st: string) => (st === "NORMAL" ? "#059669" : st === "CẬN DATE" ? "#B45309" : "#DC2626");

function fmt(val: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(val);
}

const shelfLifeColor = (pct: number) => (pct < 33 ? "#DC2626" : pct < 66 ? "#B45309" : "#059669");

/**
 * Multi-select warehouse filter: a button summarising the choice ("All
 * warehouses (4)" / "1001, 1003") that opens a checkbox list. Every
 * warehouse is ticked by default; unticking the last one isn't allowed.
 */
function WarehousePicker({ warehouses, selected, onChange }: {
  warehouses: Warehouse[];
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const all = warehouses.length > 0 && selected.length === warehouses.length;
  const label = warehouses.length === 0
    ? "No warehouses available"
    : all ? `All warehouses (${warehouses.length})` : selected.join(", ");
  const toggle = (code: string) => {
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
    if (next.length === 0) return;
    onChange(warehouses.map((w) => w.code).filter((c) => next.includes(c)));
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={warehouses.length === 0}
        onClick={() => setOpen(!open)}
        style={{ ...styles.input, minWidth: "240px", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: "0.75rem" }}
      >
        <span>🏭 {label}</span><span aria-hidden>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 30, minWidth: "100%", padding: "0.375rem 0",
          background: "var(--bg-primary, #fff)", border: "1px solid var(--color-gray-200, #E2E8F0)",
          borderRadius: "var(--radius-lg, 8px)", boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
        }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.375rem 0.75rem", fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer", borderBottom: "1px solid var(--color-gray-100, #F1F5F9)" }}>
            <input type="checkbox" checked={all} onChange={() => onChange(all ? [warehouses[0].code] : warehouses.map((w) => w.code))} />
            All warehouses
          </label>
          {warehouses.map((w) => (
            <label key={w.code} style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.375rem 0.75rem", fontSize: "0.8125rem", cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={selected.includes(w.code)} onChange={() => toggle(w.code)} />
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{w.code}</span>
              {w.name && <span style={{ color: "var(--text-secondary, #64748B)" }}>— {w.name}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);
  const [items, setItems] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;
  // "By batch" = report R403's layout (one row per batch); remembered per browser.
  const [view, setView] = useState<View>("batch");
  useEffect(() => {
    try { const v = localStorage.getItem(VIEW_KEY); if (v === "item" || v === "batch") setView(v); } catch { /* storage blocked */ }
  }, []);
  const changeView = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
  };
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (whs: string[], pg: number, q: string) => {
    setIsLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({ warehouses: whs.join(","), page: String(pg), limit: String(limit), search: q });
      const res = await fetch(`/api/admin/inventory?${sp}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to load inventory");
      if (data.warehouses) setWarehouses(data.warehouses);
      if (data.selectedWarehouses) setSelectedWarehouses(data.selectedWarehouses);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load([], 1, ""); }, [load]);

  const onWarehousesChange = (codes: string[]) => {
    setSelectedWarehouses(codes);
    setPage(1);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(codes, 1, search), 300);
  };

  const onSearchChange = (val: string) => {
    setSearch(val);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setPage(1);
      load(selectedWarehouses, 1, val);
    }, 400);
  };

  // Excel of what the table shows (all pages): same warehouses + search.
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    setError("");
    try {
      const sp = new URLSearchParams({ warehouses: selectedWarehouses.join(","), search, format: "xlsx", view });
      const res = await fetch(`/api/admin/inventory?${sp}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Export failed");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "Inventory.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;
  const warehouseName = (code: string) => warehouses.find((w) => w.code === code)?.name ?? null;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Inventory</h1>
            <p style={styles.subtitle}>
              Live stock from SAP — OnHand, Committed (Open SO + Transfer Requests + Production Orders), Available.
              {view === "batch"
                ? "By batch: one row per batch, same columns as report R403 (Inventory by Remaining Shelf Life). Lot Status: NORMAL > 50% shelf life left, CẬN DATE ≤ 50%."
                : "Shelf life % × Qty lists every batch in the warehouse, lowest shelf life first (hover for batch numbers)."}
            </p>
          </div>
        </div>

        {/* ── Controls ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", gap: "1rem", marginBottom: "1.5rem",
          flexWrap: "wrap", alignItems: "center",
        }}>
          <div role="tablist" aria-label="View" style={{ display: "inline-flex", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: "var(--radius-lg, 8px)", overflow: "hidden" }}>
            {([["item", "By item"], ["batch", "By batch (R403)"]] as const).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => changeView(v)}
                style={{ padding: "0.45rem 0.85rem", fontSize: "0.8125rem", fontWeight: 600, border: "none", cursor: "pointer",
                  background: view === v ? "var(--color-primary, #2BBCB3)" : "var(--bg-primary, #fff)", color: view === v ? "#fff" : "var(--text-secondary, #64748B)" }}>
                {label}
              </button>
            ))}
          </div>

          <WarehousePicker warehouses={warehouses} selected={selectedWarehouses} onChange={onWarehousesChange} />

          <input
            type="text"
            placeholder="Search item code or name…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ ...styles.input, flex: 1, minWidth: "200px" }}
          />

          <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)", whiteSpace: "nowrap" }}>
            {total.toLocaleString()} row{total !== 1 ? "s" : ""}
          </span>

          <button
            type="button"
            disabled={isLoading || total === 0 || exporting}
            onClick={exportExcel}
            title="Every row matching the warehouses and search (all pages), same columns + batches"
            style={btn("secondary", isLoading || total === 0 || exporting)}
          >
            {exporting ? "Exporting…" : "⬇ Export Excel"}
          </button>
        </div>

        {/* ── Error ──────────────────────────────────────────── */}
        {error && (
          <div style={{
            padding: "0.75rem 1rem", marginBottom: "1rem",
            background: "#FEF2F2", borderRadius: "var(--radius-lg, 8px)",
            border: "1px solid #FCA5A5", color: "#991B1B", fontSize: "0.8125rem",
          }}>
            {error}
          </div>
        )}

        {/* ── Table ──────────────────────────────────────────── */}
        <div style={styles.card}>
          {isLoading ? (
            <div style={styles.empty}>Loading from SAP…</div>
          ) : items.length === 0 && !error ? (
            <div style={styles.empty}>
              {warehouses.length === 0
                ? "No warehouses are assigned to you — ask the super admin (Admin Users → Warehouse)."
                : "No items with stock in the selected warehouses."}
            </div>
          ) : view === "batch" ? (
            <BatchTable items={items} warehouseName={warehouseName} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Item Code</th>
                    <th style={styles.th}>Item Name</th>
                    <th style={styles.th}>Warehouse</th>
                    <th style={styles.th}>UoM</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Shelf life % × Qty</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>OnHand</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Committed</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const available = Number(item.available);
                    const sl = item.shelf_life_pct;
                    return (
                      <tr key={`${item.item_code}|${item.whs_code}`} style={{ background: idx % 2 === 0 ? "var(--bg-primary, #fff)" : "var(--bg-secondary, #F8FAFC)" }}>
                        <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                          {(page - 1) * limit + idx + 1}
                        </td>
                        <td style={{ ...styles.td, fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                          {item.item_code}
                        </td>
                        <td style={styles.td}>{item.item_name || "—"}</td>
                        <td style={{ ...styles.td, fontFamily: "monospace", whiteSpace: "nowrap" }} title={item.whs_name || warehouseName(item.whs_code) || undefined}>
                          {item.whs_code}
                        </td>
                        <td style={{ ...styles.td, color: "var(--text-secondary, #64748B)", fontSize: "0.75rem" }}>
                          {item.uom || "—"}
                        </td>
                        <td
                          style={{ ...styles.td, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" }}
                          title={item.batches.length
                            ? item.batches.map((b) => `${b.batch ?? "(no batch no.)"}: ${b.pct}% — qty ${fmt(b.qty)}`).join("\n")
                            : "No dated batches"}
                        >
                          {sl === null ? (
                            <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</span>
                          ) : (
                            // One line per batch (lowest shelf life first): "29.3% × 33".
                            item.batches.map((b, i) => (
                              <div key={i} style={{ lineHeight: 1.45 }}>
                                <span style={{ color: b.pct != null ? shelfLifeColor(b.pct) : undefined, fontWeight: 700 }}>{b.pct != null ? `${b.pct}%` : "—"}</span>
                                <span style={{ color: "var(--text-tertiary, #94A3B8)" }}> × </span>
                                <span>{fmt(b.qty)}</span>
                              </div>
                            ))
                          )}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {fmt(Number(item.on_hand))}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {fmt(Number(item.committed))}
                        </td>
                        <td style={{
                          ...styles.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700,
                          color: available > 0 ? "#059669" : available < 0 ? "#DC2626" : "var(--text-tertiary, #94A3B8)",
                        }}>
                          {fmt(available)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Pagination ────────────────────────────────────── */}
        {totalPages > 1 && (
          <div style={{
            display: "flex", justifyContent: "center", alignItems: "center",
            gap: "0.75rem", marginTop: "1.5rem",
          }}>
            <button
              disabled={page <= 1}
              onClick={() => { const p = page - 1; setPage(p); load(selectedWarehouses, p, search); }}
              style={btn("secondary", page <= 1)}
            >
              ← Prev
            </button>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => { const p = page + 1; setPage(p); load(selectedWarehouses, p, search); }}
              style={btn("secondary", page >= totalPages)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Report R403 layout: one row per batch (no Bin columns — bins are not enabled in SAP). */
function BatchTable({ items, warehouseName }: { items: StockRow[]; warehouseName: (code: string) => string | null }) {
  const th = (right?: boolean): React.CSSProperties => ({ ...styles.th, whiteSpace: "nowrap", ...(right ? { textAlign: "right" } : {}) });
  const td: React.CSSProperties = { ...styles.td, whiteSpace: "nowrap" };
  const numTd: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace" };
  let n = 0;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th colSpan={15} style={{ ...styles.th, borderBottom: "none" }}></th>
            <th colSpan={6} style={{ ...styles.th, textAlign: "center", borderBottom: "none" }}>Remaining Shelf Life (Months)</th>
          </tr>
          <tr>
            <th style={th()}>#</th>
            <th style={th()}>Warehouse</th>
            <th style={th()}>Warehouse Name</th>
            <th style={th()}>Item Group</th>
            <th style={th()}>Item Category 1</th>
            <th style={th()}>Item No.</th>
            <th style={th()}>Item Description</th>
            <th style={th()}>UoM</th>
            <th style={th()}>Sys. Batch</th>
            <th style={th()}>Lot No.</th>
            <th style={th()}>Mfg. Date</th>
            <th style={th()}>Exp. Date</th>
            <th style={th(true)}>Rem. Shelf Life (%)</th>
            <th style={th()}>Lot Status</th>
            <th style={th(true)}>In-Stock</th>
            {BUCKETS.map((b) => <th key={b.key} style={th(true)}>{b.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.flatMap((item) => {
            // An item without batches (not batch-managed) still gets one row, so no stock is hidden.
            const rows: (Batch | null)[] = item.batches.length ? item.batches : [null];
            return rows.map((b, i) => {
              n += 1;
              const qty = b ? b.qty : Number(item.on_hand);
              return (
                <tr key={`${item.item_code}|${item.whs_code}|${i}`} style={{ background: n % 2 === 1 ? "var(--bg-primary, #fff)" : "var(--bg-secondary, #F8FAFC)",
                  borderTop: i === 0 ? "2px solid var(--color-gray-200, #E2E8F0)" : undefined }}>
                  <td style={{ ...td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>{n}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{item.whs_code}</td>
                  <td style={td}>{item.whs_name || warehouseName(item.whs_code) || ""}</td>
                  <td style={td}>{item.item_group ?? ""}</td>
                  <td style={td}>{item.item_cat1 ?? ""}</td>
                  <td style={{ ...td, fontWeight: 600, fontFamily: "monospace" }}>{item.item_code}</td>
                  <td style={{ ...styles.td, minWidth: 260 }}>{item.item_name || "—"}</td>
                  <td style={{ ...td, color: "var(--text-secondary, #64748B)", fontSize: "0.75rem" }}>{item.uom || ""}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{b ? b.batch ?? "" : "—"}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{b?.lot ?? ""}</td>
                  <td style={td}>{dmy(b?.mnfDate ?? null)}</td>
                  <td style={td}>{dmy(b?.expDate ?? null)}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: b?.pct != null ? shelfLifeColor(b.pct) : undefined }}>{b?.pct != null ? `${b.pct.toFixed(2)}%` : ""}</td>
                  <td style={{ ...td, fontWeight: 700, fontSize: "0.75rem", color: b ? statusColor(b.status) : undefined }}>{b?.status ?? ""}</td>
                  <td style={{ ...numTd, fontWeight: 700 }}>{fmt(qty)}</td>
                  {BUCKETS.map((k) => {
                    const v = b?.bucket === k.key ? qty : 0;
                    return <td key={k.key} style={{ ...numTd, color: v ? (k.key === "expired" ? "#DC2626" : undefined) : "var(--text-tertiary, #CBD5E1)", fontWeight: v ? 700 : undefined }}>{fmt(v)}</td>;
                  })}
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
