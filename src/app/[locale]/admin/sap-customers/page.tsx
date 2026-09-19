"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, SyncButton, LoadingOrEmpty, Toggle } from "../adminUi";

interface SapCustomer {
  id: number;
  sap_card_code: string;
  card_name: string | null;
  mst_code: string | null;
  price_list_num: number | null;
  cus_grp01: string | null;
  cus_grp02: string | null;
  cus_grp03: string | null;
  phone: string | null;
  account: string | null;
  is_enabled: number;
  last_synced: string | null;
}

type SortKey = "sap_card_code" | "card_name" | "mst_code" | "cus_grp01" | "price_list_num" | "phone" | "account";
type SortDir = "ASC" | "DESC";

export default function SapCustomersPage() {
  const [customers, setCustomers] = useState<SapCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("sap_card_code");
  const [sortDir, setSortDir] = useState<SortDir>("ASC");
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = useCallback(async (q: string, sort: SortKey, order: SortDir) => {
    setIsLoading(true);
    const params = new URLSearchParams({ limit: "50", sort, order });
    if (q) params.set("search", q);
    const res = await fetch(`/api/admin/sap-customers?${params}`);
    const data = await res.json();
    setCustomers(data.customers || []);
    setTotal(data.total || 0);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(search, sortKey, sortDir), 250);
    return () => clearTimeout(timer);
  }, [search, sortKey, sortDir, load]);

  const toggleEnabled = async (cardCode: string, isEnabled: boolean) => {
    setSavingCode(cardCode);
    await fetch(`/api/admin/sap-customers/${cardCode}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled }),
    });
    setCustomers((prev) => prev.map((c) => (c.sap_card_code === cardCode ? { ...c, is_enabled: isEnabled ? 1 : 0 } : c)));
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
            <h1 style={styles.title}>SAP Customers</h1>
            <p style={styles.subtitle}>
              {total} customers cached. Scoped to customer groups in the database.
              Double-click a column header to sort. Untick <strong>Enable</strong> to block a customer from signing
              in or placing orders — they&apos;ll be shown a message to contact Admin at 0908404678.
            </p>
          </div>
          <SyncButton url="/api/admin/sap-customers/sync" label="Sync from SAP" onDone={() => load(search, sortKey, sortDir)} />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <input
            style={{ ...styles.input, width: "100%", maxWidth: "360px" }}
            placeholder="Search by name, card code, or MST..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && customers.length === 0} emptyLabel="No SAP customers synced yet" />
          {!isLoading && customers.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <SortTh colKey="sap_card_code" label="Card Code" />
                    <SortTh colKey="card_name" label="Name" />
                    <SortTh colKey="mst_code" label="MST" />
                    <SortTh colKey="cus_grp01" label="Group" />
                    <SortTh colKey="price_list_num" label="Price List" />
                    <SortTh colKey="phone" label="Phone" />
                    <SortTh colKey="account" label="Account" />
                    <th style={styles.th}>Enable</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.sap_card_code} style={!c.is_enabled ? { opacity: 0.55 } : undefined}>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{c.sap_card_code}</td>
                      <td style={styles.td}>{c.card_name || "—"}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{c.mst_code || "—"}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {[c.cus_grp01, c.cus_grp02, c.cus_grp03].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td style={styles.td}>{c.price_list_num ?? "—"}</td>
                      <td style={styles.td}>{c.phone || "—"}</td>
                      <td style={styles.td}>
                        {c.account
                          ? <span style={{ color: "#059669", fontWeight: 600, fontSize: "0.8125rem" }}>{c.account}</span>
                          : <span style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>—</span>
                        }
                      </td>
                      <td style={styles.td}>
                        <Toggle
                          checked={!!c.is_enabled}
                          disabled={savingCode === c.sap_card_code}
                          onChange={(v) => toggleEnabled(c.sap_card_code, v)}
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
