"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { styles, btn, Badge, LoadingOrEmpty } from "../../admin/adminUi";

/**
 * AR Aging — SAP Query Manager "QRM_Q504_AR_Aging2", run live on HANA for the
 * customers in the caller's Channels / Customer Groups. One row per customer
 * (bucket totals); open a row to see its lines not yet reconciled (invoices,
 * credit memos, journal entries, payments) with their age in days past due.
 * ?card=CODE opens that customer straight away (link from SO Approval).
 */
type Bucket = "notDue" | "d15" | "d30" | "d45" | "d60" | "d90" | "d180" | "d181";
const BUCKETS: [Bucket, string, string][] = [
  ["notDue", "Not due", "#10B981"], ["d15", "0–15", "#FBBF24"], ["d30", "16–30", "#F59E0B"], ["d45", "31–45", "#F97316"],
  ["d60", "46–60", "#EA580C"], ["d90", "61–90", "#EF4444"], ["d180", "91–180", "#B91C1C"], ["d181", "> 180", "#7F1D1D"],
];
interface CustomerTotal {
  custCode: string; custName: string | null; creditLimit: number; ssName: string | null; lines: number; balance: number;
  overdue: number; overdueLines: number; maxAge: number; buckets: Record<Bucket, number>;
}
interface Line {
  docType: string; docNum: string | null; docNo: string | null; invNo: string | null; soNo: string | null; referenceNo: string | null;
  invDate: string | null; dueDate: string | null; ages: number | null; invAmt: number; invBal: number; brCode: string | null;
  notes: string | null; addlNotes: string | null; transTypeName: string | null; controlAccount: string | null;
}
interface Data {
  asOf: string; cachedAt: string; ms: number;
  totals: { customers: number; lines: number; balance: number; overdue: number; overdueCustomers: number; buckets: Record<Bucket, number> };
  customers: CustomerTotal[];
  options: { channels: { code: string; name: string | null }[]; brands: { code: string; name: string | null }[] };
  /** The role's Brands the data is limited to; null = all. */
  scope: { brands: string[] | null };
}

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US"));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const label: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" };

function Tile({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "#B91C1C" : tone === "warn" ? "#B45309" : "var(--text-primary, #0F172A)";
  return (
    <div style={{ ...styles.cardPadded, marginBottom: 0, padding: "1rem 1.25rem" }}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 800, color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** Stacked bar of the bucket totals (positive amounts only). */
function BucketBar({ buckets }: { buckets: Record<Bucket, number> }) {
  const total = BUCKETS.reduce((s, [k]) => s + Math.max(0, buckets[k]), 0);
  return (
    <div style={{ ...styles.cardPadded, padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
      <div style={{ ...label, marginBottom: 8 }}>Aging (days past due)</div>
      <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "var(--color-gray-100, #F1F5F9)" }}>
        {total > 0 && BUCKETS.map(([k, l, c]) => buckets[k] > 0 && (
          <div key={k} title={`${l}: ${money(buckets[k])}`} style={{ width: `${(buckets[k] / total) * 100}%`, background: c }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem 1rem", marginTop: 10 }}>
        {BUCKETS.map(([k, l, c]) => (
          <div key={k} style={{ fontSize: "0.75rem" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: c, marginRight: 6 }} />
            <span style={{ color: "var(--text-secondary, #64748B)" }}>{l}{k !== "notDue" ? " d" : ""}</span>
            <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: buckets[k] < 0 ? "#047857" : undefined }}>{money(buckets[k])}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lines({ lines }: { lines: Line[] | "loading" | { error: string } }) {
  if (lines === "loading") return <div style={{ padding: "0.75rem", fontSize: "0.8rem", color: "var(--text-tertiary)" }}>Loading lines…</div>;
  if (!Array.isArray(lines)) return <div style={{ padding: "0.75rem", fontSize: "0.8rem", color: "#B91C1C" }}>{lines.error}</div>;
  const pad = "0.3rem 0.6rem";
  const th = (align?: "right"): CSSProperties => ({ ...styles.th, padding: pad, textAlign: align ?? "left" });
  const td = (align?: "right"): CSSProperties => ({ ...styles.td, padding: pad, textAlign: align ?? "left", fontVariantNumeric: "tabular-nums", verticalAlign: "top" });
  const sorted = [...lines].sort((a, b) => (b.ages ?? -99999) - (a.ages ?? -99999));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ ...styles.table, fontSize: "0.75rem" }}>
        <thead>
          <tr>
            <th style={th()}>Type</th><th style={th()}>Doc no</th><th style={th()}>Invoice no</th><th style={th()}>SO no</th>
            <th style={th()}>Inv. date</th><th style={th()}>Due date</th><th style={th("right")}>Age (days)</th>
            <th style={th("right")}>Amount</th><th style={th("right")}>Not reconciled</th><th style={th()}>Brand</th><th style={th()}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, i) => {
            const overdue = l.invBal > 0 && l.ages !== null && l.ages >= 0;
            const credit = l.invBal < 0;
            return (
              <tr key={i} style={{ background: overdue ? "#FEF2F2" : credit ? "#F0FDF4" : undefined }}>
                <td style={td()}>{l.docType}</td>
                <td style={td()}>{l.docNo ?? l.docNum ?? "—"}</td>
                <td style={td()}>{l.invNo ?? "—"}</td>
                <td style={td()}>{l.soNo ?? "—"}</td>
                <td style={td()}>{l.invDate ?? "—"}</td>
                <td style={td()}>{l.dueDate ?? "—"}</td>
                <td style={{ ...td("right"), fontWeight: overdue ? 800 : 400, color: overdue ? "#B91C1C" : "var(--text-secondary, #64748B)" }}>
                  {l.ages === null ? "—" : l.ages < 0 ? `not due (${-l.ages})` : l.ages}
                </td>
                <td style={td("right")}>{money(l.invAmt)}</td>
                <td style={{ ...td("right"), fontWeight: 700, color: credit ? "#047857" : undefined }}>{money(l.invBal)}</td>
                <td style={td()}>{l.brCode ?? "—"}</td>
                <td style={{ ...td(), maxWidth: 280, color: "var(--text-secondary, #64748B)" }}>{[l.notes, l.addlNotes].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ArAgingPage() {
  const [date, setDate] = useState(today());
  const [channel, setChannel] = useState("");
  const [brand, setBrand] = useState("");
  const [account, setAccount] = useState("");          // applied
  const [accountInput, setAccountInput] = useState(""); // typed
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, Line[] | "loading" | { error: string }>>({});
  const [focusCard, setFocusCard] = useState<string | null>(null);

  const params = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ date, ...(channel && { channel }), ...(brand && { brand }), ...(account && { account }), ...extra });
    return p.toString();
  }, [date, channel, brand, account]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setOpen({});
    try {
      const res = await fetch(`/api/admin/ar-aging?${params()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (card: string) => {
    if (open[card]) {
      setOpen((o) => { const n = { ...o }; delete n[card]; return n; });
      return;
    }
    setOpen((o) => ({ ...o, [card]: "loading" }));
    try {
      const res = await fetch(`/api/admin/ar-aging?${params({ card })}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setOpen((o) => ({ ...o, [card]: json.lines as Line[] }));
    } catch (e) {
      setOpen((o) => ({ ...o, [card]: { error: e instanceof Error ? e.message : "Failed to load" } }));
    }
  }, [open, params]);

  // ?card=CODE (from SO Approval): filter to that customer and open its lines once loaded.
  useEffect(() => {
    const card = new URLSearchParams(window.location.search).get("card");
    if (card) { setSearch(card); setFocusCard(card); }
  }, []);
  useEffect(() => {
    if (focusCard && data && !loading) {
      if (data.customers.some((c) => c.custCode === focusCard)) toggle(focusCard);
      setFocusCard(null);
    }
  }, [focusCard, data, loading, toggle]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.customers ?? []).filter((c) =>
      (!overdueOnly || c.overdueLines > 0) &&
      (!q || c.custCode.toLowerCase().includes(q) || (c.custName ?? "").toLowerCase().includes(q) || (c.ssName ?? "").toLowerCase().includes(q))
    );
  }, [data, search, overdueOnly]);

  // Excel of exactly what's on screen: same filters, search and "Overdue only" (or one customer).
  const [exporting, setExporting] = useState(false);
  const exportExcel = async (card?: string) => {
    setExporting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ar-aging?${params({
        format: "xlsx", ...(card ? { card } : { ...(search.trim() && { search: search.trim() }), ...(overdueOnly && { overdueOnly: "1" }) }),
      })}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "AR_Aging.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const th = (align?: "right"): CSSProperties => ({ ...styles.th, textAlign: align ?? "left", whiteSpace: "nowrap" });
  const td = (align?: "right"): CSSProperties => ({ ...styles.td, textAlign: align ?? "left", fontVariantNumeric: "tabular-nums", verticalAlign: "top" });
  const t = data?.totals;

  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, maxWidth: 1500 }}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>AR Aging</h1>
            <p style={styles.subtitle}>
              Live from SAP (Query Manager QRM_Q504_AR_Aging2): invoices, credit memos, journal entries and payments not yet reconciled, by days past due.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn("secondary", loading || exporting || !rows.length)} disabled={loading || exporting || !rows.length} onClick={() => exportExcel()}
              title="Customers and their lines, as shown (filters, search, Overdue only)">{exporting ? "Exporting…" : "⬇ Export Excel"}</button>
            <button style={btn("secondary", loading)} disabled={loading} onClick={load}>↻ Refresh</button>
          </div>
        </div>

        <div style={{ ...styles.cardPadded, display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", padding: "0.875rem 1.25rem", marginBottom: "1rem" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={label}>As of</span>
            <input type="date" style={styles.input} value={date} max="2099-12-31" onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={label}>Channel</span>
            <select style={styles.input} value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">All</option>
              {data?.options.channels.map((c) => <option key={c.code} value={c.code}>{c.code}{c.name ? ` — ${c.name}` : ""}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={label}>Brand</span>
            <select style={styles.input} value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">All</option>
              {data?.options.brands.map((b) => <option key={b.code} value={b.code}>{b.code}{b.name ? ` — ${b.name}` : ""}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={label}>Control account</span>
            <input style={{ ...styles.input, width: 140 }} placeholder="All" value={accountInput}
              onChange={(e) => setAccountInput(e.target.value)} onBlur={() => setAccount(accountInput.trim())}
              onKeyDown={(e) => e.key === "Enter" && setAccount(accountInput.trim())} />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "1 1 240px" }}>
            <span style={label}>Customer</span>
            <input style={styles.input} placeholder="🔍 Code, name or salesman" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8125rem", paddingBottom: 8 }}>
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
          </label>
        </div>

        {error && <div style={{ ...styles.cardPadded, color: "#B91C1C" }}>{error}</div>}

        {t && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <Tile title="Net AR not reconciled" value={money(t.balance)} hint={`${t.lines.toLocaleString("en-US")} lines · ₫`} />
              <Tile title="Overdue (0 days +)" value={money(t.overdue)} hint="₫" tone={t.overdue > 0 ? "bad" : undefined} />
              <Tile title="Customers" value={String(t.customers)} hint={rows.length !== t.customers ? `${rows.length} shown` : "with open AR"} />
              <Tile title="Customers overdue" value={String(t.overdueCustomers)} tone={t.overdueCustomers ? "bad" : undefined} />
            </div>
            <BucketBar buckets={t.buckets} />
          </>
        )}

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={loading} isEmpty={!loading && rows.length === 0} emptyLabel="No open AR for these filters" />
          {!loading && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...styles.table, fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th style={th()}>Customer</th>
                    <th style={th()}>Salesman</th>
                    <th style={th("right")}>Credit limit</th>
                    <th style={th("right")}>Balance</th>
                    {BUCKETS.map(([k, l]) => <th key={k} style={th("right")}>{l}</th>)}
                    <th style={th("right")}>Oldest</th>
                    <th style={th()}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const lines = open[c.custCode];
                    return (
                      <Fragment key={c.custCode}>
                        <tr style={{ cursor: "pointer", background: c.overdueLines ? "#FEF2F2" : undefined }} onClick={() => toggle(c.custCode)}>
                          <td style={td()}>
                            <div style={{ fontWeight: 700 }}>{lines ? "▾" : "▸"} {c.custName}</div>
                            <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary, #94A3B8)" }}>{c.custCode} · {c.lines} line{c.lines === 1 ? "" : "s"}</div>
                          </td>
                          <td style={{ ...td(), fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", maxWidth: 180 }}>{c.ssName ?? "—"}</td>
                          <td style={td("right")}>{c.creditLimit ? money(c.creditLimit) : "—"}</td>
                          <td style={{ ...td("right"), fontWeight: 800 }}>{money(c.balance)}</td>
                          {BUCKETS.map(([k]) => (
                            <td key={k} style={{ ...td("right"), color: c.buckets[k] === 0 ? "var(--text-tertiary, #CBD5E1)" : k !== "notDue" && c.buckets[k] > 0 ? "#B91C1C" : undefined }}>
                              {c.buckets[k] === 0 ? "·" : money(c.buckets[k])}
                            </td>
                          ))}
                          <td style={td("right")}>{c.overdueLines ? <Badge label={`${c.maxAge} d`} tone={c.maxAge > 30 ? "error" : "warning"} /> : "—"}</td>
                          <td style={td()}>
                            <button style={{ ...btn("secondary"), padding: "0.2rem 0.5rem", fontSize: "0.72rem" }} title="Export this customer's lines to Excel"
                              onClick={(e) => { e.stopPropagation(); exportExcel(c.custCode); }}>Excel</button>
                          </td>
                        </tr>
                        {lines && (
                          <tr>
                            <td colSpan={BUCKETS.length + 6} style={{ padding: "0.25rem 0.75rem 0.75rem 1.75rem", background: "var(--bg-secondary, #F8FAFC)" }}>
                              <Lines lines={lines} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {data && (
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: "0.5rem" }}>
            {data.scope.brands && <>Your data permission: brands {data.scope.brands.join(", ")} · </>}
            As of {data.asOf} · SAP data read {new Date(data.cachedAt).toLocaleTimeString()} ({data.ms} ms) · Age = days past the due date
            (negative = not due yet); buckets as in SAP Q504 (0–15 includes the due date). Green = payments / credits not yet reconciled.
          </div>
        )}
      </div>
    </div>
  );
}
