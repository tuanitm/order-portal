"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { styles, btn, LoadingOrEmpty } from "../adminUi";
import { useFloatingScroll, useColumnWidths, resizableTh } from "../tableTools";

/**
 * Sales Detail — SAP Query Manager "Q202. Sales Details" (procedure
 * BTS_QRM_FIN_GROSSPROFIT_DETAIL) run live on HANA within the caller's data
 * permissions: one line per A/R invoice / credit memo / journal line with its
 * brand, customer, item, qty, price, discounts and amount. Totals by brand on
 * top; the line table shows the key columns (all columns on demand) and the
 * Excel export has every column of the SAP query.
 */
interface Column { key: string; label: string; numeric: boolean }
type Row = Record<string, string | number | null>;
interface Opt { code: string; name: string | null }
interface Data {
  from: string; to: string; cachedAt: string; ms: number;
  totals: { lines: number; docs: number; customers: number; salesAmt: number; qtySale: number; qtyPromo: number; focAmt: number };
  brands: { brand: string; name: string | null; lines: number; qtySale: number; qtyPromo: number; salesAmt: number; focAmt: number }[];
  columns: Column[]; rows: Row[]; truncated: boolean; maxRows: number;
  options: { grp1: Opt[]; grp2: Opt[]; grp3: Opt[]; brands: Opt[] };
  scope: { limited: boolean; brands: string[]; channels: string[] };
}

/** The columns shown by default; "All columns" shows every column of the query. */
const KEY_COLUMNS = ["BillDate", "GpType", "Invoice No", "SONo", "BrandCode", "CustCode", "CustName", "InvCode", "InvName", "Unit",
  "QtySale", "QtyPromo", "BasePrice", "StdDisc", "CtDisc", "PromoCode", "PromoDisc", "SalesPrice", "SalesAmt", "FOCAmt", "WH.Code", "SMName"];

/** Starting column widths (px); others: names / notes 220, numbers 100, the rest 110. */
const DEFAULT_WIDTH: Record<string, number> = {
  BillDate: 92, GpType: 130, "Invoice No": 115, SONo: 120, BrandCode: 70, CustCode: 105, CustName: 240, InvCode: 105, InvName: 280,
  Unit: 60, QtySale: 80, QtyPromo: 80, StdDisc: 85, CtDisc: 85, PromoDisc: 85, TaxRate: 70, PromoCode: 115, SalesAmt: 120, "WH.Code": 70, SMName: 180,
};
const NUMERIC_KEYS = new Set(["QtySale", "QtyPromo", "BasePrice", "StdDisc", "CtDisc", "PromoDisc", "TaxRate", "SalesPrice", "SalesAmt", "FOCPrice", "FOCAmt"]);

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US"));
const num = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const label: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" };
/** "2026-11-20…" → "20/11/2026"; other text as is. */
const cellDate = (v: string | number | null) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : v);

function Tile({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div style={{ ...styles.cardPadded, marginBottom: 0, padding: "1rem 1.25rem" }}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function SalesDetailPage() {
  const now = new Date();
  const blank = { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now), grp1: "", grp2: "", grp3: "", brand: "", card: "" };
  const [f, setF] = useState(blank);             // typed
  const [applied, setApplied] = useState(blank); // searched
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [allColumns, setAllColumns] = useState(false);
  const [exporting, setExporting] = useState(false);

  const qs = useCallback((q: typeof blank, extra: Record<string, string> = {}) =>
    new URLSearchParams(Object.entries({ ...q, ...extra }).filter(([, v]) => v) as [string, string][]).toString(), []);

  const load = useCallback(async (q: typeof blank) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/sales-detail?${qs(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { load(applied); }, [load, applied]);
  const run = (q = f) => { setF(q); setApplied({ ...q }); };

  const exportExcel = async () => {
    setExporting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/sales-detail?${qs(applied, { format: "xlsx" })}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "Sales_Detail.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo(() => {
    const all = data?.columns ?? [];
    return allColumns ? all : KEY_COLUMNS.map((k) => all.find((c) => c.key === k)).filter((c): c is Column => !!c);
  }, [data, allColumns]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.rows ?? [];
    if (!q) return list;
    return list.filter((r) => ["CustCode", "CustName", "InvCode", "InvName", "Invoice No", "SONo", "PromoCode", "SMName"].some((k) => String(r[k] ?? "").toLowerCase().includes(q)));
  }, [data, search]);

  // Wide table: a scrollbar floating at the bottom of the window, and columns resizable by their header edge
  // (widths remembered in this browser).
  const scroll = useFloatingScroll();
  const cols = useColumnWidths((k) => (DEFAULT_WIDTH[k] ?? (/Name|Customer|Remarks|Notes|Addr|Reason/.test(k) ? 220 : NUMERIC_KEYS.has(k) ? 100 : 110)), "salesDetail.colWidths");

  const input = { ...styles.input, width: "100%" };
  const field = (title: string, el: React.ReactNode, width: number) => (
    <label style={{ display: "grid", gap: 4, width }}><span style={label}>{title}</span>{el}</label>
  );
  const select = (key: "grp1" | "grp2" | "grp3" | "brand", list: Opt[] | undefined) => (
    <select style={input} value={f[key]} onChange={(e) => run({ ...f, [key]: e.target.value })}>
      <option value="">All</option>
      {list?.map((o) => <option key={o.code} value={o.code}>{o.code}{o.name ? ` — ${o.name}` : ""}</option>)}
    </select>
  );
  const th = (c?: Column): CSSProperties => ({ ...styles.th, ...resizableTh, padding: "0.45rem 0.6rem", textAlign: c?.numeric ? "right" : "left" });
  const td = (c?: Column): CSSProperties => ({
    ...styles.td, padding: "0.35rem 0.6rem", textAlign: c?.numeric ? "right" : "left", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: c && /Name|Remarks|Notes|Addr|Reason/.test(c.key) ? "normal" : "nowrap", wordBreak: "break-word",
  });
  const cell = (c: Column, v: string | number | null) => {
    if (v === null || v === "") return <span style={{ color: "var(--text-tertiary, #CBD5E1)" }}>·</span>;
    if (typeof v === "number") return /Disc|TaxRate/.test(c.key) ? `${num(v)}%` : /Qty/.test(c.key) ? num(v) : money(v);
    return cellDate(v);
  };
  const t = data?.totals;

  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, maxWidth: 1600 }}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Sales Detail</h1>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); run(); }}
          style={{ ...styles.cardPadded, display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", padding: "0.875rem 1.25rem", marginBottom: "1rem" }}>
          {field("Bill date from", <input type="date" style={input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />, 145)}
          {field("Bill date to", <input type="date" style={input} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />, 145)}
          {field("Channel", select("grp1", data?.options.grp1), 130)}
          {field("Customer group 2", select("grp2", data?.options.grp2), 150)}
          {field("Customer group 3", select("grp3", data?.options.grp3), 150)}
          {field("Brand", select("brand", data?.options.brands), 130)}
          {field("Customer code", <input style={input} placeholder="All" value={f.card} onChange={(e) => setF({ ...f, card: e.target.value.trim() })} />, 140)}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="submit" style={btn("primary", loading)} disabled={loading}>Search</button>
            <button type="button" style={btn("secondary")} onClick={() => run(blank)}>Clear</button>
            <button type="button" style={btn("secondary", loading)} disabled={loading} onClick={() => load(applied)}>↻ Refresh</button>
            <button type="button" style={btn("secondary", loading || exporting || !data?.totals.lines)} disabled={loading || exporting || !data?.totals.lines}
              onClick={exportExcel} title="Every line and every column of the SAP query">{exporting ? "Exporting…" : "⬇ Export Excel"}</button>
          </div>
        </form>

        {error && <div style={{ ...styles.cardPadded, color: "#B91C1C" }}>{error}</div>}

        {t && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
            <Tile title="Sales amount" value={money(t.salesAmt)} hint="₫ (excl. VAT)" />
            <Tile title="Qty sale" value={num(t.qtySale)} hint={t.qtyPromo ? `+ ${num(t.qtyPromo)} promo` : undefined} />
            <Tile title="FOC amount" value={money(t.focAmt)} hint="₫" />
            <Tile title="Documents" value={t.docs.toLocaleString("en-US")} hint={`${t.lines.toLocaleString("en-US")} lines`} />
            <Tile title="Customers" value={t.customers.toLocaleString("en-US")} />
          </div>
        )}

        {data && data.brands.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "1rem" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...styles.table, fontSize: "0.8rem" }}>
                <thead><tr>{["Brand", "Lines", "Qty sale", "Qty promo", "Sales amount", "FOC amount", "Share"].map((h, i) => <th key={h} style={{ ...styles.th, padding: "0.5rem 0.75rem", textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.brands.map((b) => (
                    <tr key={b.brand} style={{ cursor: "pointer" }} title="Show only this brand" onClick={() => run({ ...f, brand: b.brand === "—" ? "" : b.brand })}>
                      <td style={{ ...styles.td, padding: "0.4rem 0.75rem", fontWeight: 700 }}>{b.brand}{b.name ? <span style={{ fontWeight: 400, color: "var(--text-secondary, #64748B)" }}> — {b.name}</span> : null}</td>
                      <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{b.lines.toLocaleString("en-US")}</td>
                      <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{num(b.qtySale)}</td>
                      <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{num(b.qtyPromo)}</td>
                      <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right", fontWeight: 700 }}>{money(b.salesAmt)}</td>
                      <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{money(b.focAmt)}</td>
                      <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{data.totals.salesAmt ? `${((b.salesAmt / data.totals.salesAmt) * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={styles.card}>
          {data && data.totals.lines > 0 && (
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-gray-200, #E2E8F0)" }}>
              <input style={{ ...styles.input, flex: "1 1 280px" }} placeholder="🔍 Customer, item, invoice, SO, PM code or salesman" value={search} onChange={(e) => setSearch(e.target.value)} />
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8125rem" }}>
                <input type="checkbox" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} /> All columns
              </label>
              <button type="button" onClick={cols.resetAll} title="Columns back to their starting widths"
                style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: "0.75rem", color: "var(--color-primary, #0F766E)", textDecoration: "underline" }}>
                Reset column widths
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)" }}>
                {rows.length.toLocaleString("en-US")} line(s) shown{data.truncated ? ` — first ${data.maxRows.toLocaleString("en-US")} of ${data.totals.lines.toLocaleString("en-US")}; Export Excel has all` : ""}
              </span>
            </div>
          )}
          <LoadingOrEmpty isLoading={loading} isEmpty={!loading && rows.length === 0} emptyLabel="No sales for these filters" />
          {!loading && rows.length > 0 && (
            <div>
            <div ref={scroll.wrapRef} onScroll={scroll.onWrapScroll} style={{ overflowX: "auto", scrollbarWidth: "none" }}>
              <table ref={scroll.tableRef} style={{ ...styles.table, fontSize: "0.75rem", tableLayout: "fixed", width: columns.reduce((t, c) => t + cols.widthOf(c.key), 0) }}>
                <colgroup>{columns.map((c) => <col key={c.key} style={{ width: cols.widthOf(c.key) }} />)}</colgroup>
                <thead><tr>{columns.map((c) => <th key={c.key} style={th(c)} title={c.label}>{c.label}{cols.handle(c.key)}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={Number(r.SalesAmt) < 0 ? { background: "#FEF2F2" } : undefined}>
                      {columns.map((c) => <td key={c.key} style={td(c)}>{cell(c, r[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              {scroll.bar}
            </div>
          )}
        </div>
        {data && (
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: "0.5rem" }}>
            {data.scope.limited
              ? <>Your data permission: channels {data.scope.channels.join(", ") || "none"} · brands {data.scope.brands.join(", ") || "none"} · </>
              : <>Channels {data.scope.channels.join(", ")} · brands {data.scope.brands.join(", ")} (config) · </>}
            SAP Q202 Sales Details · bill date {cellDate(data.from)} → {cellDate(data.to)} · read {new Date(data.cachedAt).toLocaleTimeString()} ({data.ms} ms) · red rows = credit memos / negative amounts
          </div>
        )}
      </div>
    </div>
  );
}
