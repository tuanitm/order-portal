"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, Badge, SyncButton, LoadingOrEmpty } from "../adminUi";

interface Promotion {
  id: number;
  doc_entry: number;
  promotion_code: string | null;
  promotion_name: string | null;
  begin_date: string | null;
  end_date: string | null;
  bp_grp_code: string | null;
  bp_grp_name: string | null;
  bp_code: string | null;
  bp_name: string | null;
  selling_grp_code: string | null;
  selling_grp_name: string | null;
  selling_item_code: string | null;
  selling_item_name: string | null;
  disc_pct: string | null;
  selling_qty: string | null;
  giving_item_code: string | null;
  giving_item_name: string | null;
  giving_qty: string | null;
}

function isActive(p: Promotion): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (p.begin_date && p.begin_date.slice(0, 10) > today) return false;
  if (p.end_date && p.end_date.slice(0, 10) < today) return false;
  return true;
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [total, setTotal] = useState(0);
  const [searchFilter, setSearchFilter] = useState("");
  const [bpCodeFilter, setBpCodeFilter] = useState("");
  const [itemCodeFilter, setItemCodeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "discount_pct" | "free_item">("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [validDate, setValidDate] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (
    search: string, bpCode: string, itemCode: string, type: string, onlyActive: boolean, date: string
  ) => {
    setIsLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (search) params.set("search", search);
    if (bpCode) params.set("bpCode", bpCode);
    if (itemCode) params.set("itemCode", itemCode);
    if (type !== "all") params.set("type", type);
    if (onlyActive) params.set("activeOnly", "true");
    if (date) params.set("validDate", date);
    const res = await fetch(`/api/admin/promotions?${params}`);
    const data = await res.json();
    setPromotions(data.promotions || []);
    setTotal(data.total || 0);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(
      () => load(searchFilter, bpCodeFilter, itemCodeFilter, typeFilter, activeOnly, validDate),
      250
    );
    return () => clearTimeout(timer);
  }, [searchFilter, bpCodeFilter, itemCodeFilter, typeFilter, activeOnly, validDate, load]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Promotion Discounts</h1>
            <p style={styles.subtitle}>
              SAP Promotion Programs (@PM_HEADER) — flat rows mapping a promotion to a Business Partner
              (or BP group) and a selling item (or item group), with either a discount % or a free/bonus item.
              Direct SAP sync currently fails (the API user lacks Query Generator authorization on the
              promotion tables) — Import from promotion from SAP.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <SyncButton
              url="/api/admin/promotions/import"
              label="Sync promotion discounts from SAP"
              loadingLabel="Importing..."
              onDone={() => load(searchFilter, bpCodeFilter, itemCodeFilter, typeFilter, activeOnly, validDate)}
            />
            <SyncButton
              url="/api/admin/promotions/sync"
              label="Sync promotions from Json file"
              disabled
              onDone={() => load(searchFilter, bpCodeFilter, itemCodeFilter, typeFilter, activeOnly, validDate)}
            />
          </div>
        </div>

        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ ...styles.input, width: "260px" }}
            placeholder="Search by Promotion Code or Name..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          <input
            style={{ ...styles.input, width: "220px" }}
            placeholder="Filter by BP code or name..."
            value={bpCodeFilter}
            onChange={(e) => setBpCodeFilter(e.target.value)}
          />
          <input
            style={{ ...styles.input, width: "220px" }}
            placeholder="Filter by item code or name..."
            value={itemCodeFilter}
            onChange={(e) => setItemCodeFilter(e.target.value)}
          />
          <select
            style={{ ...styles.input, width: "180px" }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | "discount_pct" | "free_item")}
          >
            <option value="all">All</option>
            <option value="discount_pct">Discount Pct</option>
            <option value="free_item">Free Item</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
            Valid date
            <input type="date" style={styles.input} value={validDate} onChange={(e) => setValidDate(e.target.value)} />
          </label>
          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{total} row(s)</span>
        </div>

        <div style={styles.card}>
          <LoadingOrEmpty
            isLoading={isLoading}
            isEmpty={!isLoading && promotions.length === 0}
            emptyLabel="No promotions synced yet"
          />
          {!isLoading && promotions.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Promotion</th>
                    <th style={styles.th}>BP Target</th>
                    <th style={styles.th}>Disc Type</th>
                    <th style={styles.th}>Selling Item</th>
                    <th style={styles.th}>Discount</th>
                    <th style={styles.th}>BuyQty</th>
                    <th style={styles.th}>Free/Bonus Item</th>
                    <th style={styles.th}>GiveQty</th>
                    <th style={styles.th}>Valid</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((p) => (
                    <tr key={p.id}>
                      <td style={styles.td}>
                        <span style={{ fontFamily: "monospace" }}>{p.promotion_code}</span>
                        <br />
                        <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{p.promotion_name}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ fontFamily: "monospace" }}>{p.bp_code || "—"}</span> {p.bp_name ? `— ${p.bp_name}` : ""}
                      </td>
                      <td style={styles.td}>
                        {p.disc_pct ? (
                          <Badge label="Discount" tone="success" />
                        ) : p.giving_item_code ? (
                          <Badge label="Free Item" tone="warning" />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={styles.td}>
                        <span style={{ fontFamily: "monospace" }}>{p.selling_item_code || "—"}</span> {p.selling_item_name ? `— ${p.selling_item_name}` : ""}
                      </td>
                      <td style={styles.td}>{p.disc_pct ? `${p.disc_pct}%` : "—"}</td>
                      <td style={styles.td}>{p.selling_qty || "—"}</td>
                      <td style={styles.td}>
                        {p.giving_item_code ? (
                          <>
                            <span style={{ fontFamily: "monospace" }}>{p.giving_item_code}</span> {p.giving_item_name ? `— ${p.giving_item_name}` : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={styles.td}>{p.giving_qty || "—"}</td>
                      <td style={{ ...styles.td, fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                        {p.begin_date?.slice(0, 10) || "…"} → {p.end_date?.slice(0, 10) || "…"}
                      </td>
                      <td style={styles.td}>
                        <Badge label={isActive(p) ? "Active" : "Inactive"} tone={isActive(p) ? "success" : "neutral"} />
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
