"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, SyncButton, Toggle, LoadingOrEmpty } from "../adminUi";

interface Warehouse {
  sap_warehouse_code: string;
  warehouse_name: string;
  is_inactive_in_sap: number;
  is_included: number;
  last_synced: string | null;
}

interface StockRow {
  warehouse_code: string;
  warehouse_name: string | null;
  is_included: number | null;
  in_stock: string;
  committed: string;
  ordered: string;
  available: string;
  shelf_life_pct: string | null;
  last_synced: string | null;
}

function formatQty(v: string) {
  return new Intl.NumberFormat("vi-VN").format(Number(v));
}

function formatShelfLife(v: string | null) {
  return v === null ? "—" : `${Number(v).toFixed(1)}%`;
}

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/warehouses");
    const data = await res.json();
    setWarehouses(data.warehouses || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleIncluded = async (code: string, isIncluded: boolean) => {
    setSavingCode(code);
    await fetch(`/api/admin/warehouses/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isIncluded }),
    });
    await load();
    setSavingCode(null);
  };

  const includedCount = warehouses.filter((w) => w.is_included).length;

  // ── "Check item stock" — per-warehouse breakdown for one item code,
  // mainly to answer "why is/isn't this item showing on the storefront?" ──
  const [itemCode, setItemCode] = useState("");
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [searchedCode, setSearchedCode] = useState("");

  const checkStock = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setIsLoadingStock(true);
    setSearchedCode(trimmed);
    const res = await fetch(`/api/admin/inventory?itemCode=${encodeURIComponent(trimmed)}`);
    const data = await res.json();
    setStockRows(data.rows || []);
    setIsLoadingStock(false);
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Warehouses</h1>
            <p style={styles.subtitle}>
              Toggle <strong>Included</strong> to control which warehouses&apos; stock counts toward an item&apos;s
              storefront availability — an item with zero available quantity (on-hand minus committed, summed across
              only <strong>Included</strong> warehouses) is hidden from customers.{" "}
              {includedCount === 0 ? (
                <strong>No warehouse is Included yet, so this feature is currently OFF — every active item shows regardless of stock.</strong>
              ) : (
                <>Currently <strong>{includedCount}</strong> warehouse{includedCount === 1 ? "" : "s"} Included.</>
              )}{" "}
              Re-syncing from SAP pulls only the warehouse codes listed in config.json&apos;s masterdata.wareHouse —
              any other warehouse is removed from this list entirely (not just un-Included). Edit that list and
              re-sync to change which warehouses appear here, rather than toggling below (a manual toggle here only
              holds until the next sync).
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <SyncButton url="/api/admin/warehouses/sync" label="Sync warehouses from SAP" onDone={load} />
            <SyncButton
              url="/api/admin/inventory/sync"
              label="Sync stock from SAP"
              loadingLabel="Syncing (can take a minute)..."
            />
          </div>
        </div>

        <div style={{ ...styles.card, marginBottom: "2rem" }}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && warehouses.length === 0} emptyLabel="No warehouses synced yet" />
          {!isLoading && warehouses.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Code</th>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Inactive in SAP</th>
                    <th style={styles.th}>Included</th>
                    <th style={styles.th}>Last Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.sap_warehouse_code}>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{w.sap_warehouse_code}</td>
                      <td style={styles.td}>{w.warehouse_name}</td>
                      <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)" }}>{w.is_inactive_in_sap ? "Yes" : "—"}</td>
                      <td style={styles.td}>
                        <Toggle
                          checked={!!w.is_included}
                          disabled={savingCode === w.sap_warehouse_code}
                          onChange={(v) => toggleIncluded(w.sap_warehouse_code, v)}
                        />
                      </td>
                      <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                        {w.last_synced ? new Date(w.last_synced).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>Check Item Stock</h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
          Look up one item&apos;s stock per warehouse — useful to see why it is or isn&apos;t showing on the storefront.
        </p>
        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <input
            style={{ ...styles.input, width: "220px" }}
            placeholder="Item code..."
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && checkStock(itemCode)}
          />
          <button onClick={() => checkStock(itemCode)} style={btn("primary")} disabled={!itemCode.trim()}>
            Check
          </button>
        </div>

        {searchedCode && (
          <div style={styles.card}>
            <LoadingOrEmpty
              isLoading={isLoadingStock}
              isEmpty={!isLoadingStock && stockRows.length === 0}
              emptyLabel={`No stock rows found for "${searchedCode}" — not synced, or zero on every warehouse`}
            />
            {!isLoadingStock && stockRows.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Warehouse</th>
                      <th style={styles.th}>Included</th>
                      <th style={styles.th}>In Stock</th>
                      <th style={styles.th}>Committed</th>
                      <th style={styles.th}>Ordered</th>
                      <th style={styles.th}>Available</th>
                      <th style={styles.th}>Shelf-life %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockRows.map((r) => (
                      <tr key={r.warehouse_code}>
                        <td style={styles.td}>
                          {r.warehouse_name || "—"}
                          <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)" }}>{r.warehouse_code}</div>
                        </td>
                        <td style={styles.td}>{r.is_included ? "✓" : "—"}</td>
                        <td style={styles.td}>{formatQty(r.in_stock)}</td>
                        <td style={styles.td}>{formatQty(r.committed)}</td>
                        <td style={styles.td}>{formatQty(r.ordered)}</td>
                        <td style={{ ...styles.td, fontWeight: 600 }}>{formatQty(r.available)}</td>
                        <td style={styles.td}>{formatShelfLife(r.shelf_life_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
