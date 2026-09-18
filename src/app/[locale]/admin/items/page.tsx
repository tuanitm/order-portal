"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, SyncButton, Toggle, LoadingOrEmpty } from "../adminUi";

interface Item {
  id: number;
  sap_item_code: string;
  item_name_vi: string;
  category: string;
  item_cat01: string | null;
  item_cat02: string | null;
  item_cat03: string | null;
  item_cat04: string | null;
  item_cat05: string | null;
  item_cat06: string | null;
  base_price: string;
  is_active: number;
  is_manually_hidden: number;
  last_synced: string | null;
}

/** Item group hierarchy chain, e.g. "D1 / D12 / D121" — same "/"-joined-codes
 * format as the BP Group column on the SAP Customers (Business Partners) page. */
function itemGroupChain(i: Item): string {
  return [i.item_cat01, i.item_cat02, i.item_cat03, i.item_cat04, i.item_cat05, i.item_cat06]
    .filter(Boolean)
    .join(" / ") || "—";
}

type SortKey = "sap_item_code" | "item_name_vi" | "category" | "base_price" | "is_active";
type SortDir = "ASC" | "DESC";

function formatPrice(v: string) {
  return new Intl.NumberFormat("vi-VN").format(Number(v)) + "₫";
}

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sap_item_code");
  const [sortDir, setSortDir] = useState<SortDir>("ASC");

  const load = useCallback(async (q: string, sort: SortKey, order: SortDir) => {
    setIsLoading(true);
    const params = new URLSearchParams({ limit: "50", sort, order });
    if (q) params.set("search", q);
    const res = await fetch(`/api/admin/items?${params}`);
    const data = await res.json();
    setItems(data.items || []);
    setTotal(data.total || 0);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(search, sortKey, sortDir), 250);
    return () => clearTimeout(timer);
  }, [search, sortKey, sortDir, load]);

  const toggleVisible = async (code: string, value: boolean) => {
    setSavingCode(code);
    await fetch(`/api/admin/items/${code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: value }),
    });
    setItems((prev) => prev.map((i) => (i.sap_item_code === code ? { ...i, is_manually_hidden: value ? 0 : 1 } : i)));
    setSavingCode(null);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortKey(key);
      setSortDir("ASC");
    }
  };

  const SortTh = ({ colKey, label }: { colKey: SortKey; label: string }) => {
    const active = sortKey === colKey;
    const arrow = active ? (sortDir === "ASC" ? " ▲" : " ▼") : "";
    return (
      <th
        style={{
          ...styles.th,
          cursor: "pointer",
          userSelect: "none",
          whiteSpace: "nowrap",
          background: active ? "var(--bg-secondary, #F1F5F9)" : undefined,
        }}
        onDoubleClick={() => handleSort(colKey)}
        title={`Double-click to sort by ${label}`}
      >
        {label}
        {arrow && <span style={{ fontSize: "0.625rem", marginLeft: "0.25rem", color: "var(--color-primary, #3B82F6)" }}>{arrow}</span>}
      </th>
    );
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Items</h1>
            <p style={styles.subtitle}>
              {total} items cached. Double-click a column header to sort.
              The toggle hides/shows an individual item without changing its item group —
              that choice survives future syncs.
            </p>
          </div>
          <SyncButton url="/api/admin/items/sync" label="Sync from SAP" loadingLabel="Syncing (can take a minute)..." onDone={() => load(search, sortKey, sortDir)} />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <input
            style={{ ...styles.input, width: "100%", maxWidth: "360px" }}
            placeholder="Search by name or item code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && items.length === 0} emptyLabel="No items synced yet" />
          {!isLoading && items.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <SortTh colKey="sap_item_code" label="Item Code" />
                    <SortTh colKey="item_name_vi" label="Name" />
                    <SortTh colKey="category" label="Item Group" />
                    <SortTh colKey="base_price" label="Base Price" />
                    <SortTh colKey="is_active" label="Visible" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.sap_item_code} style={{ opacity: i.is_active ? 1 : 0.5 }}>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{i.sap_item_code}</td>
                      <td style={styles.td}>{i.item_name_vi}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{itemGroupChain(i)}</td>
                      <td style={styles.td}>{formatPrice(i.base_price)}</td>
                      <td style={styles.td}>
                        <Toggle
                          checked={!!i.is_active && !i.is_manually_hidden}
                          disabled={savingCode === i.sap_item_code || !i.is_active}
                          onChange={(v) => toggleVisible(i.sap_item_code, v)}
                        />
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
