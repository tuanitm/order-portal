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
  /** Worst (lowest) remaining shelf life among the row's batches; null = no dated batches. */
  shelf_life_pct: number | null;
  batches: { pct: number; qty: number }[];
}

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
              Shelf life % is the batch with the least remaining shelf life (hover for every batch).
            </p>
          </div>
        </div>

        {/* ── Controls ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", gap: "1rem", marginBottom: "1.5rem",
          flexWrap: "wrap", alignItems: "center",
        }}>
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
                    <th style={{ ...styles.th, textAlign: "right" }}>Shelf life %</th>
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
                            ? `${item.batches.length} batch${item.batches.length > 1 ? "es" : ""}:\n` + item.batches.map((b) => `${b.pct}% — qty ${fmt(b.qty)}`).join("\n")
                            : "No dated batches"}
                        >
                          {sl === null ? (
                            <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</span>
                          ) : (
                            <>
                              <span style={{ color: shelfLifeColor(sl), fontWeight: 700 }}>{sl}%</span>
                              {item.batches.length > 1 && (
                                <span style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.7rem", marginLeft: 4 }}>
                                  ({item.batches.length})
                                </span>
                              )}
                            </>
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
