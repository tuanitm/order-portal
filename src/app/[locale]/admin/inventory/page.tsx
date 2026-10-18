"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { styles, btn } from "../adminUi";

interface Warehouse {
  code: string;
  name: string | null;
}

interface StockRow {
  item_code: string;
  item_name: string | null;
  uom: string | null;
  on_hand: number;
  committed: number;
  available: number;
}

function fmt(val: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(val);
}

export default function InventoryPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [items, setItems] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (wh: string, pg: number, q: string) => {
    setIsLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({ warehouse: wh, page: String(pg), limit: String(limit), search: q });
      const res = await fetch(`/api/admin/inventory?${sp}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to load inventory");
      if (data.warehouses) setWarehouses(data.warehouses);
      if (data.selectedWarehouse) setSelectedWarehouse(data.selectedWarehouse);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load("", 1, ""); }, [load]);

  const onWarehouseChange = (code: string) => {
    setSelectedWarehouse(code);
    setPage(1);
    load(code, 1, search);
  };

  const onSearchChange = (val: string) => {
    setSearch(val);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setPage(1);
      load(selectedWarehouse, 1, val);
    }, 400);
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Inventory</h1>
            <p style={styles.subtitle}>
              Live stock from SAP — OnHand, Committed (Open SO + Transfer Requests + Production Orders), Available.
            </p>
          </div>
        </div>

        {/* ── Controls ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", gap: "1rem", marginBottom: "1.5rem",
          flexWrap: "wrap", alignItems: "center",
        }}>
          <select
            value={selectedWarehouse}
            onChange={(e) => onWarehouseChange(e.target.value)}
            style={{ ...styles.input, minWidth: "220px" }}
          >
            {warehouses.length === 0 && <option value="">No warehouses available</option>}
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code}{w.name ? ` — ${w.name}` : ""}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search item code or name…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ ...styles.input, flex: 1, minWidth: "200px" }}
          />

          <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)", whiteSpace: "nowrap" }}>
            {total.toLocaleString()} item{total !== 1 ? "s" : ""}
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
              {selectedWarehouse ? "No items with stock in this warehouse." : "Select a warehouse to view inventory."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Item Code</th>
                    <th style={styles.th}>Item Name</th>
                    <th style={styles.th}>UoM</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>OnHand</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Committed</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const available = Number(item.available);
                    return (
                      <tr key={item.item_code} style={{ background: idx % 2 === 0 ? "var(--bg-primary, #fff)" : "var(--bg-secondary, #F8FAFC)" }}>
                        <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                          {(page - 1) * limit + idx + 1}
                        </td>
                        <td style={{ ...styles.td, fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                          {item.item_code}
                        </td>
                        <td style={styles.td}>{item.item_name || "—"}</td>
                        <td style={{ ...styles.td, color: "var(--text-secondary, #64748B)", fontSize: "0.75rem" }}>
                          {item.uom || "—"}
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
              onClick={() => { const p = page - 1; setPage(p); load(selectedWarehouse, p, search); }}
              style={btn("secondary", page <= 1)}
            >
              ← Prev
            </button>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => { const p = page + 1; setPage(p); load(selectedWarehouse, p, search); }}
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
