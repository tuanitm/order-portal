"use client";

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import { styles, Badge, SyncButton, LoadingOrEmpty } from "../adminUi";
import { useAdminSession } from "../layout";
import { vnToday } from "@/lib/vnTime";

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
  priority: number | null;
}

/** view=program: one row per promotion program. */
interface Program {
  promotion_code: string;
  promotion_name: string | null;
  begin_date: string | null;
  end_date: string | null;
  priority: number | null;
  row_count: number;
  item_count: number;
  bp_count: number;
  disc_rows: number;
  free_rows: number;
}

type View = "detail" | "program";

/**
 * Priority cell: a whole number 1, 2, 3... (smaller = first when one selling
 * item has more than one program); empty = none. Saved per promotion program
 * on Enter / leaving the box. Read-only for roles that can't change it.
 */
function PriorityCell({ code, value, editable, onSaved }: {
  code: string | null; value: number | null; editable: boolean; onSaved: (code: string, priority: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const [error, setError] = useState("");
  useEffect(() => { setText(value === null ? "" : String(value)); }, [value]);
  if (!editable || !code) {
    return <span style={{ fontWeight: 700, fontFamily: "monospace" }}>{value ?? "—"}</span>;
  }
  const save = async () => {
    const t = text.trim();
    const next = t === "" ? null : Number(t);
    if (next === value) return;
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 9999)) {
      setState("error"); setError("Whole number 1–9999"); return;
    }
    setState("saving"); setError("");
    try {
      const res = await fetch("/api/admin/promotions", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promotionCode: code, priority: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Failed to save");
      setState("saved");
      onSaved(code, next);
      setTimeout(() => setState((st) => (st === "saved" ? "" : st)), 1500);
    } catch (e) {
      setState("error"); setError(e instanceof Error ? e.message : "Failed to save");
    }
  };
  const box: CSSProperties = {
    ...styles.input, width: 68, padding: "0.25rem 0.4rem", textAlign: "right", fontWeight: 700,
    borderColor: state === "error" ? "#DC2626" : state === "saved" ? "#059669" : undefined,
  };
  return (
    <div title={error || `Priority of ${code} (all its rows) — 1 = first; empty = none`}>
      <input
        style={box}
        inputMode="numeric"
        value={text}
        placeholder="—"
        disabled={state === "saving"}
        onChange={(e) => { setText(e.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setState(""); setError(""); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(value === null ? "" : String(value));
        }}
        onBlur={save}
      />
      {state === "error" && <div style={{ fontSize: "0.65rem", color: "#DC2626", maxWidth: 140 }}>{error}</div>}
    </div>
  );
}

function isActive(p: Promotion): boolean {
  const today = vnToday();
  if (p.begin_date && p.begin_date.slice(0, 10) > today) return false;
  if (p.end_date && p.end_date.slice(0, 10) < today) return false;
  return true;
}

export default function PromotionsPage() {
  const session = useAdminSession();
  const isSuperAdmin = !!session?.isSuperAdmin;
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [total, setTotal] = useState(0);
  const [searchFilter, setSearchFilter] = useState("");
  const [bpCodeFilter, setBpCodeFilter] = useState("");
  const [itemCodeFilter, setItemCodeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "discount_pct" | "free_item">("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [validDate, setValidDate] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View>("detail");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [canEditPriority, setCanEditPriority] = useState(false);

  const load = useCallback(async (
    search: string, bpCode: string, itemCode: string, type: string, onlyActive: boolean, date: string, v: View = "detail"
  ) => {
    setIsLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (v === "program") params.set("view", "program");
    if (search) params.set("search", search);
    if (bpCode) params.set("bpCode", bpCode);
    if (itemCode) params.set("itemCode", itemCode);
    if (type !== "all") params.set("type", type);
    if (onlyActive) params.set("activeOnly", "true");
    if (date) params.set("validDate", date);
    const res = await fetch(`/api/admin/promotions?${params}`);
    const data = await res.json();
    setPromotions(data.promotions || []);
    setPrograms(data.programs || []);
    setCanEditPriority(!!data.canEditPriority);
    setTotal(data.total || 0);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(
      () => load(searchFilter, bpCodeFilter, itemCodeFilter, typeFilter, activeOnly, validDate, view),
      250
    );
    return () => clearTimeout(timer);
  }, [searchFilter, bpCodeFilter, itemCodeFilter, typeFilter, activeOnly, validDate, view, load]);

  // A priority belongs to the whole program: update every shown row of it.
  const onPrioritySaved = (code: string, priority: number | null) => {
    setPromotions((ps) => ps.map((p) => (p.promotion_code === code ? { ...p, priority } : p)));
    setPrograms((ps) => ps.map((p) => (p.promotion_code === code ? { ...p, priority } : p)));
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Promotion Discounts</h1>
            <p style={styles.subtitle}>
              SAP Promotion Programs (@PM_HEADER) — flat rows mapping a promotion to a Business Partner
              (or BP group) and a selling item (or item group), with either a discount % or a free/bonus item.
              Synced directly from SAP HANA (promotion_program.sql) — the SAP Service Layer has no accessible
              route to these promotion tables at all.
            </p>
          </div>
          {isSuperAdmin && (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <SyncButton
                url="/api/admin/promotions/sync"
                label="Sync promotion discounts from SAP (HANA)"
                loadingLabel="Syncing..."
                onDone={() => load(searchFilter, bpCodeFilter, itemCodeFilter, typeFilter, activeOnly, validDate, view)}
              />
            </div>
          )}
        </div>

        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <div role="tablist" aria-label="View" style={{ display: "inline-flex", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: "var(--radius-lg, 8px)", overflow: "hidden" }}>
            {([["detail", "Detail"], ["program", "By program"]] as const).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                style={{ padding: "0.45rem 0.85rem", fontSize: "0.8125rem", fontWeight: 600, border: "none", cursor: "pointer",
                  background: view === v ? "var(--color-primary, #2BBCB3)" : "var(--bg-primary, #fff)", color: view === v ? "#fff" : "var(--text-secondary, #64748B)" }}>
                {label}
              </button>
            ))}
          </div>
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
          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{total} {view === "program" ? "program(s)" : "row(s)"}</span>
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", margin: "-0.5rem 0 0.75rem" }}>
          <b>Priority</b>: when one selling item has more than one promotion program, the smallest number (1, 2, 3…) is chosen by default — in the cart,
          on Excel import and when pushing to SAP. Empty = no priority (after every numbered program; then the best match decides).
          A priority applies to the whole program (all its rows) and is kept across SAP syncs.
          {canEditPriority ? " Type a number and press Enter." : " Only Admin, Accountant and System Admin can change it."}
        </p>

        {view === "program" && (
          <div style={styles.card}>
            <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && programs.length === 0} emptyLabel="No promotions synced yet" />
            {!isLoading && programs.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Priority</th>
                      <th style={styles.th}>Promotion</th>
                      <th style={styles.th}>Disc Type</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Selling items</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>BPs</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Rows</th>
                      <th style={styles.th}>Valid</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programs.map((p) => {
                      const active = isActive({ begin_date: p.begin_date, end_date: p.end_date } as Promotion);
                      return (
                        <tr key={p.promotion_code}>
                          <td style={styles.td}><PriorityCell code={p.promotion_code} value={p.priority} editable={canEditPriority} onSaved={onPrioritySaved} /></td>
                          <td style={styles.td}>
                            <span style={{ fontFamily: "monospace" }}>{p.promotion_code}</span>
                            <br />
                            <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{p.promotion_name}</span>
                          </td>
                          <td style={styles.td}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {Number(p.disc_rows) > 0 && <Badge label="Discount" tone="success" />}
                              {Number(p.free_rows) > 0 && <Badge label="Free Item" tone="warning" />}
                            </div>
                          </td>
                          <td style={{ ...styles.td, textAlign: "right" }}>{p.item_count}</td>
                          <td style={{ ...styles.td, textAlign: "right" }}>{p.bp_count}</td>
                          <td style={{ ...styles.td, textAlign: "right" }}>{p.row_count}</td>
                          <td style={{ ...styles.td, fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                            {p.begin_date?.slice(0, 10) || "…"} → {p.end_date?.slice(0, 10) || "…"}
                          </td>
                          <td style={styles.td}><Badge label={active ? "Active" : "Inactive"} tone={active ? "success" : "neutral"} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === "detail" && <div style={styles.card}>
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
                    <th style={styles.th}>Priority</th>
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
                      <td style={styles.td}><PriorityCell code={p.promotion_code} value={p.priority} editable={canEditPriority} onSaved={onPrioritySaved} /></td>
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
        </div>}
      </div>
    </div>
  );
}
