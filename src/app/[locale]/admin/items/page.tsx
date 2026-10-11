"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, SyncButton, Toggle, LoadingOrEmpty } from "../adminUi";

interface Item {
  id: number;
  sap_item_code: string;
  item_name_vi: string;
  uom: string | null;
  sales_uom: string | null;
  brand: string | null;
  item_group_l2: string | null;
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
  const [salesUomInputs, setSalesUomInputs] = useState<Record<string, string>>({});
  const [savingSalesUomCode, setSavingSalesUomCode] = useState<string | null>(null);

  const load = useCallback(async (q: string, sort: SortKey, order: SortDir) => {
    setIsLoading(true);
    const params = new URLSearchParams({ limit: "50", sort, order });
    if (q) params.set("search", q);
    const res = await fetch(`/api/admin/items?${params}`);
    const data = await res.json();
    const loaded: Item[] = data.items || [];
    setItems(loaded);
    setTotal(data.total || 0);
    setSalesUomInputs((prev) => {
      const next = { ...prev };
      for (const i of loaded) if (!(i.sap_item_code in next)) next[i.sap_item_code] = i.sales_uom || "";
      return next;
    });
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

  const saveSalesUom = async (code: string) => {
    setSavingSalesUomCode(code);
    const salesUom = (salesUomInputs[code] || "").trim();
    await fetch(`/api/admin/items/${code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salesUom: salesUom || null }),
    });
    setItems((prev) => prev.map((i) => (i.sap_item_code === code ? { ...i, sales_uom: salesUom || null } : i)));
    setSavingSalesUomCode(null);
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
              that choice survives future syncs. <strong>Sales UOM</strong> overrides the unit of
              measure shown to customers (storefront, cart, orders) when set — leave it blank to use
              the synced <strong>UOM</strong>; this also survives future syncs.
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
                    <SortTh colKey="category" label="Brand" />
                    <th style={styles.th}>Item Group</th>
                    <SortTh colKey="sap_item_code" label="Item Code" />
                    <SortTh colKey="item_name_vi" label="Name" />
                    <th style={styles.th}>UOM</th>
                    <th style={styles.th}>Sales UOM</th>
                    <th style={styles.th}>Item Group Path</th>
                    <SortTh colKey="base_price" label="Base Price" />
                    <SortTh colKey="is_active" label="Visible" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.sap_item_code} style={{ opacity: i.is_active ? 1 : 0.5 }}>
                      <td style={styles.td}>{i.brand || "—"}</td>
                      <td style={styles.td}>{i.item_group_l2 || "—"}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{i.sap_item_code}</td>
                      <td style={styles.td}>{i.item_name_vi}</td>
                      <td style={{ ...styles.td, color: "var(--text-tertiary, #94A3B8)" }}>{i.uom || "—"}</td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", gap: "0.375rem" }}>
                          <input
                            type="text"
                            value={salesUomInputs[i.sap_item_code] ?? ""}
                            onChange={(e) => setSalesUomInputs((m) => ({ ...m, [i.sap_item_code]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && saveSalesUom(i.sap_item_code)}
                            placeholder={i.uom || "—"}
                            style={{ ...styles.input, width: "90px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          />
                          <button
                            onClick={() => saveSalesUom(i.sap_item_code)}
                            disabled={savingSalesUomCode === i.sap_item_code}
                            style={{
                              fontSize: "0.7rem", padding: "0 0.5rem", border: "1px solid var(--color-gray-200, #E2E8F0)",
                              borderRadius: "var(--radius-md, 6px)", background: "var(--bg-primary, #fff)", cursor: "pointer",
                            }}
                          >
                            {savingSalesUomCode === i.sap_item_code ? "..." : "Save"}
                          </button>
                        </div>
                      </td>
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
