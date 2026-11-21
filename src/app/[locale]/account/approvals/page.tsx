"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { styles, btn, Badge, LoadingOrEmpty } from "../../admin/adminUi";
import { useStaffBase } from "../../admin/layout";

/**
 * SO Approval — SAP's Sales Order approval requests (the same as SAP's
 * Approval Status Report): created in SAP by a salesperson or pushed from the
 * portal, DocDate on/after Settings → "Approve SO from date". An Accountant
 * sees the requests their SAP user is an authorizer on; "Pending" = waiting
 * for their decision now. Filters: Status, Brand, DocDate, SO No, Business
 * Partner, Creator (SAP user).
 */
type Status = "pending" | "approved" | "rejected" | "all";
interface Row {
  docEntry: number; docNum: number; docNo: string | null; docDate: string | null; status: "pending" | "approved" | "rejected";
  requestedAt: string | null; cardCode: string; customerName: string | null; mstCode: string | null; brands: string[];
  creator: string | null; creatorName: string | null; totalExclTax: number; totalInclTax: number; remarks: string | null;
  sapDataStatus: string | null; portalOrder: { id: number; orderNumber: string } | null;
  ar: { openInvoices: number; overdueInvoices: number; overdueAmount: number; oldestOverdueDays: number; creditAvailable: number | null } | null;
  sapApproval: {
    state: "approved" | "pending" | "rejected"; templates: string[]; stage: string | null;
    waitingFor: string[]; waitingOnMe: boolean; noTemplate: boolean; warning: string | null; requestNo: number | null;
  };
}
interface Result {
  rows: Row[]; fromDate: string | null; me: string | null; sapReady: boolean;
  options: { brands: string[] | null; creators: { code: string; name: string | null }[] };
}

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US"));
const fmtDate = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const STATUS_LABEL: Record<Row["status"], { label: string; tone: "warning" | "success" | "error" }> = {
  pending: { label: "Pending", tone: "warning" }, approved: { label: "Approved", tone: "success" }, rejected: { label: "Not approved", tone: "error" },
};
const label: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" };

function Tile({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "#B91C1C" : tone === "warn" ? "#B45309" : "var(--text-primary, #0F172A)";
  return (
    <div style={{ ...styles.cardPadded, marginBottom: 0, padding: "1rem 1.25rem" }}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function RiskFlags({ ar }: { ar: Row["ar"] }) {
  if (!ar) return <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</span>;
  const flags: { label: string; tone: "error" | "warning" | "success" }[] = [];
  if (ar.overdueInvoices) flags.push({ label: `${ar.overdueInvoices} overdue · ${ar.oldestOverdueDays}d`, tone: "error" });
  if (ar.creditAvailable !== null && ar.creditAvailable < 0) flags.push({ label: "Over credit limit", tone: "error" });
  if (!ar.overdueInvoices && ar.openInvoices) flags.push({ label: `${ar.openInvoices} open inv.`, tone: "warning" });
  if (!flags.length) flags.push({ label: "Clear", tone: "success" });
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{flags.map((f) => <Badge key={f.label} label={f.label} tone={f.tone} />)}</div>;
}

function SapStage({ p, status }: { p: Row["sapApproval"]; status: Row["status"] }) {
  return (
    <div style={{ fontSize: "0.75rem" }}>
      <div style={{ fontWeight: 600 }}>{p.templates.join(", ") || "—"}{p.requestNo ? <span style={{ fontWeight: 400, color: "var(--text-tertiary, #94A3B8)" }}> · #{p.requestNo}</span> : null}</div>
      {status === "pending" && p.stage && <div style={{ color: "var(--text-secondary, #64748B)" }}>Stage {p.stage}</div>}
      {status === "pending" && (p.waitingOnMe
        ? <Badge label="Waiting for you" tone="warning" />
        : p.waitingFor.length > 0 && <div style={{ color: "var(--text-tertiary, #94A3B8)" }}>→ {p.waitingFor.join(", ")}</div>)}
    </div>
  );
}

type CheckStatus = "pass" | "warn" | "fail" | "error";
/** Six-check summary of one SO (from its detail). */
interface CheckSummary { status: CheckStatus | "loading"; notPass: string[]; error?: string }
/** Outcome of a bulk decision on one SO. */
interface BulkResult { ok: boolean; text: string; /** left for one-by-one review */ manual?: boolean; /** no (valid) SAP login — stop the run */ stop?: boolean }
const CHECK_META: Record<CheckStatus, { label: string; tone: "success" | "warning" | "error" | "neutral" }> = {
  pass: { label: "✓ All checks pass", tone: "success" }, warn: { label: "! Review", tone: "warning" },
  fail: { label: "✕ Not recommended", tone: "error" }, error: { label: "? Verify manually", tone: "neutral" },
};

const BLANK = { status: "pending" as Status, brand: "", dateFrom: "", dateTo: "", soNo: "", bp: "", creator: "" };

export default function ApprovalQueuePage() {
  const base = useStaffBase();
  const [f, setF] = useState(BLANK);             // what's typed
  const [applied, setApplied] = useState(BLANK); // what was searched
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (q: typeof BLANK) => {
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
      const res = await fetch(`/api/admin/approvals?${sp}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(applied); }, [applied, load]);

  const search = (next: typeof BLANK = f) => { setF(next); setApplied(next); setSelected(new Set()); };

  // ── Multi-SO approval ──
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [checks, setChecks] = useState<Map<number, CheckSummary>>(new Map());
  const [results, setResults] = useState<Map<number, BulkResult>>(new Map());
  const [bulkNote, setBulkNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const toggle = (d: number) => setSelected((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });

  /**
   * The six checks of these SOs, two at a time (each reads SAP live; the
   * server keeps the result 15 min, and the approval uses that same result).
   */
  const runChecks = async (docs: number[]): Promise<Map<number, CheckSummary>> => {
    const out = new Map<number, CheckSummary>();
    setChecks((m) => { const n = new Map(m); for (const d of docs) n.set(d, { status: "loading", notPass: [] }); return n; });
    const queue = [...docs];
    let done = 0;
    const worker = async () => {
      for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
        let sum: CheckSummary;
        try {
          const res = await fetch(`/api/admin/approvals/${d}`);
          const j = await res.json();
          if (!res.ok) throw new Error(j.error || "Failed");
          const cs = (j.checks ?? []) as { status: CheckStatus; title: string; step: number }[];
          const st: CheckStatus = cs.length === 0 ? "error"
            : cs.some((c) => c.status === "fail") ? "fail" : cs.some((c) => c.status === "error") ? "error" : cs.some((c) => c.status === "warn") ? "warn" : "pass";
          sum = { status: st, notPass: cs.filter((c) => c.status !== "pass").map((c) => `${c.step}. ${c.title}`) };
        } catch (e) {
          sum = { status: "error", notPass: [], error: e instanceof Error ? e.message : "Failed" };
        }
        out.set(d, sum);
        setChecks((m) => new Map(m).set(d!, sum));
        setProgress(`Checking ${++done} of ${docs.length}…`);
      }
    };
    await Promise.all([worker(), worker()]);
    return out;
  };

  const decide = async (d: number, decision: "approved" | "rejected", notes: string): Promise<BulkResult> => {
    try {
      const res = await fetch(`/api/admin/approvals/${d}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes }),
      });
      const j = await res.json();
      if (!res.ok) return { ok: false, text: j.error || "Failed", stop: res.status === 428 };
      return {
        ok: true,
        text: (j.outcome === "approved" ? "✓ Approved & released" : j.outcome === "stage_approved" ? `✓ Stage approved → ${(j.waitingFor ?? []).join(", ")}`
          : j.outcome === "rejected" ? "✕ Not approved" : "Rejection recorded") + (j.warning ? ` — ⚠ ${j.warning}` : ""),
      };
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : "Failed" };
    }
  };

  /**
   * Multi-SO approval: check every selected SO; those whose six checks ALL
   * pass are approved in SAP automatically; the rest are left untouched and
   * marked for one-by-one review (each needs its own checking notes).
   */
  const checkAndApprove = async () => {
    const docs = rows.filter((r) => selected.has(r.docEntry)).map((r) => r.docEntry);
    if (!docs.length) return;
    setBulkBusy(true);
    setResults(new Map());
    const out = new Map<number, BulkResult>();
    try {
      const sums = await runChecks(docs);
      const ready = docs.filter((d) => sums.get(d)?.status === "pass");
      for (const d of docs) {
        const s = sums.get(d);
        if (s?.status !== "pass") {
          out.set(d, { ok: false, manual: true, text: s?.error ? `Couldn't check: ${s.error}` : `Needs manual review — ${s?.notPass.join(", ") || "checks not complete"}` });
        }
      }
      setResults(new Map(out));
      if (ready.length === 0) {
        setProgress(`None of the ${docs.length} SO(s) passed all six checks — review them one by one (marked below).`);
        return;
      }
      if (!confirm(`${ready.length} of ${docs.length} SO(s) passed all six checks.\n\nApprove these ${ready.length} in SAP as ${data?.me}?` +
        (docs.length > ready.length ? `\n\nThe other ${docs.length - ready.length} are left for one-by-one review.` : ""))) {
        setProgress(`${ready.length} ready, ${docs.length - ready.length} need manual review — nothing approved.`);
        return;
      }
      let ok = 0;
      for (const [i, d] of ready.entries()) {
        setProgress(`Approving ${i + 1} of ${ready.length}…`);
        const r = await decide(d, "approved", bulkNote.trim() || "Approved in a multi-SO approval — all six checks passed.");
        out.set(d, r);
        setResults(new Map(out));
        if (r.ok) ok++;
        if (r.stop) break; // no (valid) SAP login — the rest would fail the same way
      }
      setProgress(`Done — ${ok} of ${ready.length} ready SO(s) approved${docs.length > ready.length ? `; ${docs.length - ready.length} left for manual review` : ""}${ok < ready.length ? "; see the rows marked ✕" : ""}.`);
    } finally {
      setResults(new Map(out));
      setBulkBusy(false);
      setSelected(new Set([...out].filter(([, r]) => !r.ok).map(([d]) => d)));
      await load(applied);
    }
  };

  const rejectSelected = async () => {
    const docs = rows.filter((r) => selected.has(r.docEntry)).map((r) => r.docEntry);
    if (!docs.length) return;
    if (!bulkNote.trim()) { setProgress("Write the reason for rejecting in the note."); return; }
    if (!confirm(`Reject ${docs.length} Sales Order(s) in SAP as ${data?.me}?\n\nReason: ${bulkNote.trim()}`)) return;
    setBulkBusy(true);
    const out = new Map<number, BulkResult>();
    let ok = 0;
    try {
      for (const [i, d] of docs.entries()) {
        setProgress(`Rejecting ${i + 1} of ${docs.length}…`);
        const r = await decide(d, "rejected", bulkNote.trim());
        out.set(d, r);
        setResults(new Map(out));
        if (r.ok) ok++;
        if (r.stop) break;
      }
      setProgress(`Done — ${ok} of ${docs.length} rejected${ok < docs.length ? "; see the rows marked ✕" : ""}.`);
    } finally {
      setResults(new Map(out));
      setBulkBusy(false);
      setSelected(new Set());
      await load(applied);
    }
  };
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const kpi = useMemo(() => {
    const value = rows.reduce((s, r) => s + (r.totalInclTax ?? 0), 0);
    const mine = rows.filter((r) => r.sapApproval.waitingOnMe).length;
    const overdueCustomers = new Set(rows.filter((r) => r.ar && r.ar.overdueInvoices > 0).map((r) => r.cardCode)).size;
    const overLimit = new Set(rows.filter((r) => r.ar && r.ar.creditAvailable !== null && r.ar.creditAvailable < 0).map((r) => r.cardCode)).size;
    return { value, mine, overdueCustomers, overLimit };
  }, [rows]);

  const th = (align?: "right"): CSSProperties => ({ ...styles.th, textAlign: align ?? "left", whiteSpace: "nowrap" });
  const td = (align?: "right"): CSSProperties => ({ ...styles.td, textAlign: align ?? "left", verticalAlign: "top" });
  const input: CSSProperties = { ...styles.input, width: "100%" };
  const field = (title: string, el: ReactNode, w = 150) => (
    <label style={{ display: "grid", gap: 4, flex: `1 1 ${w}px`, minWidth: w }}><span style={label}>{title}</span>{el}</label>
  );
  const brandChoices = data?.options.brands ?? [...new Set(rows.flatMap((r) => r.brands))].sort();
  const selectable = rows.filter((r) => r.status === "pending" && r.sapApproval.waitingOnMe);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.docEntry));

  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, maxWidth: 1500 }}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>SO Approval</h1>
            <p style={styles.subtitle}>
              SAP Sales Order approval requests (as in SAP&apos;s Approval Status Report){data?.me ? ` for SAP user ${data.me}` : ""}
              {data?.fromDate ? ` · DocDate from ${fmtDate(data.fromDate)}` : ""}. Open one to run the six checks and approve or reject it in SAP.
            </p>
          </div>
          <button style={btn("secondary", loading)} disabled={loading} onClick={() => load(applied)}>↻ Refresh</button>
        </div>

        {/* ── Filters ── */}
        <form onSubmit={(e) => { e.preventDefault(); search(); }}
          style={{ ...styles.cardPadded, display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", padding: "0.875rem 1.25rem", marginBottom: "1rem" }}>
          {field("Brand", (
            <select style={input} value={f.brand} onChange={(e) => search({ ...f, brand: e.target.value })}>
              <option value="">All</option>
              {brandChoices.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ), 110)}
          {field("SODate From", <input type="date" style={input} value={f.dateFrom} min={data?.fromDate ?? undefined} onChange={(e) => setF({ ...f, dateFrom: e.target.value })} />, 140)}
          {field("SODate To", <input type="date" style={input} value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} />, 140)}
          {field("Status", (
            <select style={input} value={f.status} onChange={(e) => search({ ...f, status: e.target.value as Status })}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Not approved</option>
              <option value="all">All</option>
            </select>
          ), 130)}
          {field("SO No", <input style={input} placeholder="U_DocNo / DocNum" value={f.soNo} onChange={(e) => setF({ ...f, soNo: e.target.value })} />, 150)}
          {field("Business Partner", <input style={input} placeholder="Code or name" value={f.bp} onChange={(e) => setF({ ...f, bp: e.target.value })} />, 180)}
          {field("Creator", (
            <select style={input} value={f.creator} onChange={(e) => search({ ...f, creator: e.target.value })}>
              <option value="">All</option>
              {f.creator && !data?.options.creators.some((c) => c.code === f.creator) && <option value={f.creator}>{f.creator}</option>}
              {data?.options.creators.map((c) => <option key={c.code} value={c.code}>{c.code}{c.name ? ` — ${c.name}` : ""}</option>)}
            </select>
          ), 150)}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="submit" style={btn("primary", loading)} disabled={loading}>Search</button>
            <button type="button" style={btn("secondary")} onClick={() => search(BLANK)}>Clear</button>
          </div>
        </form>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
          <Tile title={applied.status === "all" ? "Sales Orders" : STATUS_LABEL[applied.status].label} value={String(rows.length)} hint={rows.length >= 500 ? "first 500 — narrow the filters" : undefined} />
          {applied.status === "pending" && <Tile title="Waiting for you" value={String(kpi.mine)} tone={kpi.mine ? "warn" : undefined} />}
          <Tile title="Value (incl. tax)" value={money(kpi.value)} hint="₫" />
          <Tile title="Customers with overdue invoices" value={String(kpi.overdueCustomers)} tone={kpi.overdueCustomers ? "bad" : undefined} />
          <Tile title="Customers over credit limit" value={String(kpi.overLimit)} tone={kpi.overLimit ? "bad" : undefined} />
        </div>

        {error && <div style={{ ...styles.cardPadded, color: "#B91C1C" }}>{error}</div>}

        {/* ── Multi-SO approval ── */}
        {selectable.length > 0 && (
          <div style={{ ...styles.cardPadded, padding: "0.875rem 1.25rem", marginBottom: "1rem", position: "sticky", top: 8, zIndex: 5,
            border: selected.size ? "1px solid var(--color-primary, #2BBCB3)" : undefined }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 170 }}>
                <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>{selected.size} of {selectable.length} selected</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-secondary, #64748B)", maxWidth: 230 }}>
                  SOs waiting for you. Ready SOs (all six checks pass) are approved automatically; the rest you review one by one.
                </div>
              </div>
              <textarea value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} disabled={bulkBusy}
                placeholder="Note — optional remark on the approvals; required to reject"
                style={{ ...styles.input, flex: "1 1 320px", minHeight: 44, fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={btn("success", bulkBusy || !selected.size || !data?.sapReady)} disabled={bulkBusy || !selected.size || !data?.sapReady} onClick={checkAndApprove}
                  title="Runs the six checks; SOs that pass all six are approved in SAP, the others are left for one-by-one review">
                  {bulkBusy ? "Working…" : "✓ Check & approve ready SOs"}
                </button>
                <button style={btn("danger", bulkBusy || !selected.size || !data?.sapReady)} disabled={bulkBusy || !selected.size || !data?.sapReady} onClick={rejectSelected}>✕ Reject selected</button>
              </div>
            </div>
            {!data?.sapReady && (
              <div style={{ fontSize: "0.75rem", color: "#B45309", marginTop: 6 }}>
                Save your SAP user and password once in <a href={`${base}/change-password`} style={{ color: "inherit", fontWeight: 700 }}>My Profile</a> to approve.
              </div>
            )}
            {progress && <div style={{ fontSize: "0.8125rem", fontWeight: 600, marginTop: 6 }}>{progress}</div>}
          </div>
        )}

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={loading} isEmpty={!loading && rows.length === 0} emptyLabel="No Sales Orders for these filters" />
          {!loading && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...styles.table, fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th style={{ ...th(), width: 28 }}>
                      {selectable.length > 0 && (
                        <input type="checkbox" checked={allSelected} disabled={bulkBusy} title="Select every SO waiting for you"
                          onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.docEntry)))} />
                      )}
                    </th>
                    <th style={th()}>Brand</th>
                    <th style={th()}>SODate</th>
                    <th style={th()}>SO No</th>
                    <th style={th()}>Business Partner</th>
                    <th style={th()}>Creator</th>
                    <th style={th("right")}>Excl. tax</th>
                    <th style={th("right")}>Incl. tax</th>
                    <th style={th()}>AR / Credit</th>
                    <th style={th()}>SAP approval</th>
                    <th style={th()}>Remarks</th>
                    <th style={th()}>Status</th>
                    <th style={th()}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const risky = !!r.ar && (r.ar.overdueInvoices > 0 || (r.ar.creditAvailable !== null && r.ar.creditAvailable < 0));
                    const href = `${base}/approvals/${r.docEntry}`;
                    const st = STATUS_LABEL[r.status];
                    return (
                      <tr key={r.docEntry} style={{ cursor: "pointer", background: risky && r.status === "pending" ? "#FEF2F2" : undefined }}
                        onClick={() => { window.location.href = href; }}>
                        <td style={td()} onClick={(e) => e.stopPropagation()}>
                          {r.status === "pending" && r.sapApproval.waitingOnMe && (
                            <input type="checkbox" checked={selected.has(r.docEntry)} disabled={bulkBusy} onChange={() => toggle(r.docEntry)} />
                          )}
                        </td>
                        <td style={td()}>{r.brands.join(", ") || "—"}</td>
                        <td style={{ ...td(), whiteSpace: "nowrap" }}>{fmtDate(r.docDate)}</td>
                        <td style={td()}>
                          <div style={{ fontWeight: 700 }}>{r.docNo || "—"}</div>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary, #94A3B8)" }}>
                            DocNum {r.docNum} · DocEntry {r.docEntry}
                            {r.portalOrder && <> · <span style={{ color: "var(--color-primary, #2BBCB3)", fontWeight: 700 }}>Portal {r.portalOrder.orderNumber}</span></>}
                          </div>
                        </td>
                        <td style={td()}>
                          <div style={{ fontWeight: 600 }}>{r.customerName}</div>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary, #94A3B8)" }}>{r.cardCode}{r.mstCode ? ` · MST ${r.mstCode}` : ""}</div>
                        </td>
                        <td style={td()} title={r.creatorName ?? undefined}>{r.creator ?? "—"}</td>
                        <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums" }}>{money(r.totalExclTax)}</td>
                        <td style={{ ...td("right"), fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{money(r.totalInclTax)}</td>
                        <td style={td()}><RiskFlags ar={r.ar} /></td>
                        <td style={td()}><SapStage p={r.sapApproval} status={r.status} /></td>
                        <td style={{ ...td(), maxWidth: 240, color: "var(--text-secondary, #64748B)" }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }} title={r.remarks ?? ""}>{r.remarks || "—"}</div>
                        </td>
                        <td style={td()}>
                          <Badge label={st.label} tone={st.tone} />
                          {checks.get(r.docEntry) && (
                            <div style={{ marginTop: 4 }} title={checks.get(r.docEntry)!.error ?? checks.get(r.docEntry)!.notPass.join("\n")}>
                              {checks.get(r.docEntry)!.status === "loading"
                                ? <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>checking…</span>
                                : <Badge label={CHECK_META[checks.get(r.docEntry)!.status as CheckStatus].label} tone={CHECK_META[checks.get(r.docEntry)!.status as CheckStatus].tone} />}
                            </div>
                          )}
                          {results.get(r.docEntry) && (
                            <div style={{ marginTop: 4, fontSize: "0.7rem", fontWeight: 600, maxWidth: 220,
                              color: results.get(r.docEntry)!.ok ? "#047857" : results.get(r.docEntry)!.manual ? "#B45309" : "#B91C1C" }}>
                              {results.get(r.docEntry)!.text}
                              {results.get(r.docEntry)!.manual && (
                                <a href={href} onClick={(e) => e.stopPropagation()} style={{ display: "block", color: "var(--color-primary, #2BBCB3)", fontWeight: 800 }}>Review this SO →</a>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={td()}>
                          <a href={href} style={{ ...btn(r.sapApproval.waitingOnMe ? "primary" : "secondary"), textDecoration: "none", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                            {r.sapApproval.waitingOnMe ? "Review →" : "Open"}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
