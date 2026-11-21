"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { styles, btn, Badge, BackLink } from "../../../admin/adminUi";
import { useStaffBase } from "../../../admin/layout";

/**
 * SO Approval — review one Sales Order.
 *
 * Layout (recommended for credit control): the SO identity and totals on
 * top; the six checks as a guided top-down stepper in the main column (each
 * step shows its evidence, the system's recommendation, and asks for a note
 * when the Accountant continues against it); the customer's credit / AR
 * position pinned in a side panel so it's visible at every step; the
 * decision (Approve in SAP / Reject) at the end of the stepper.
 */
type CheckStatus = "pass" | "warn" | "fail" | "error";
type Cell = string | number | null | undefined;
interface SubTable { columns: { key: string; label: string; align?: "right" }[]; rows: CheckRowData[] }
/** A check table row; _sub = nested table (an item's batches in the stock check). */
type CheckRowData = { [col: string]: Cell | SubTable } & { _status?: CheckStatus; _sub?: SubTable };
interface Check {
  key: string; step: number; title: string; status: CheckStatus; summary: string; recommendation: string;
  columns: { key: string; label: string; align?: "right" }[];
  rows: CheckRowData[];
}
interface Ar {
  cardCode: string; cardName: string | null; taxCode: string | null; phone: string | null; email: string | null;
  balance: number; creditLimit: number; openOrders: number; openDeliveries: number; creditAvailable: number | null;
  agingAsOf: string;
  openInvoiceCount: number; openInvoiceAmount: number; overdueInvoiceCount: number; overdueAmount: number; oldestOverdueDays: number;
  unreconciledCreditCount: number; unreconciledCredits: number; agingTotal: number;
  aging: Record<AgingBucket, number>;
}
type AgingBucket = "notDue" | "d15" | "d30" | "d45" | "d60" | "d90" | "d180" | "d181";
/** SAP QRM_Q504_AR_Aging2 buckets (days past due). */
const AGING_BUCKETS: [AgingBucket, string, string][] = [
  ["notDue", "Not due", "#10B981"], ["d15", "0–15", "#FBBF24"], ["d30", "16–30", "#F59E0B"], ["d45", "31–45", "#F97316"],
  ["d60", "46–60", "#EA580C"], ["d90", "61–90", "#EF4444"], ["d180", "91–180", "#B91C1C"], ["d181", "> 180", "#7F1D1D"],
];
interface Detail {
  order: {
    id: number; orderNumber: string; arStatus: "pending" | "approved" | "rejected" | null; createdAt: string; warehouseCode: string | null;
    customerName: string | null; mstCode: string | null; cardCode: string; contactPhone: string | null; deliveryAddress: string | null;
    supervisorName: string | null; createdByStaff: string | null;
    /** portal = pushed from the portal; sap = created in SAP (by `creator`). */
    source: "portal" | "sap"; docEntry: number; creator: string | null;
    lines: { item: string; name: string | null; qty: number; uom: string | null; price: number; discountPct: number; total: number; gift: boolean; kind?: string | null }[];
  };
  sap: { docEntry: number; docNum: number; docNo: string | null; totalInclTax: number; vatSum: number; totalExclTax: number; comments: string | null; docStatus: string | null; cancelled: boolean; dataStatus: string | null; docDate: string | null } | null;
  ar: Ar | null;
  checks: Check[];
  checkedAt: string;
  history: { decision: string; by: string | null; sapUser: string | null; stage: string | null; superseded: boolean; notes: string | null; stepNotes: Record<string, string> | null; at: string }[];
  procedure: Procedure;
  decide: { canDecide: boolean; reason: string | null; stages: { templateName: string; stageName: string }[]; completes: boolean; override: boolean; requestNo: number | null };
  sapSession: { sapUser: string; expiresAt: number } | null;
  /** SAP login saved in My Profile — approving signs in with it automatically. */
  sapAccount: { hasPassword: boolean; updatedAt: string | null };
  sapUserCode: string | null;
  /** The role's Brands the AR aging covers; null = all brands. */
  arBrands: string[] | null;
}

interface StageDecision { decision: "approved" | "rejected"; sapUserCode: string | null; adminLabel: string | null; at: string }
interface Procedure {
  noTemplate: boolean;
  state: "approved" | "pending" | "rejected";
  waitingFor: string[];
  templates: {
    wtmCode: number; name: string; warning?: string; state: "approved" | "pending" | "rejected";
    stages: {
      wstCode: number; name: string; remarks: string | null; sortId: number; maxReqr: number; maxRejReqr: number;
      authorizers: { userCode: string; name: string | null }[];
      approvals: StageDecision[]; rejections: StageDecision[];
      state: "done" | "current" | "waiting" | "rejected";
    }[];
  }[];
}

const STAGE_META = {
  done: { icon: "✓", color: "#047857", bg: "#D1FAE5", label: "Approved" },
  current: { icon: "●", color: "#B45309", bg: "#FEF3C7", label: "Current stage" },
  waiting: { icon: "○", color: "#64748B", bg: "#F1F5F9", label: "Waiting" },
  rejected: { icon: "✕", color: "#B91C1C", bg: "#FEE2E2", label: "Rejected" },
} as const;

/** SAP Approval Templates / Stages that apply to this Sales Order, and where it stands. */
function ProcedureCard({ p, me }: { p: Procedure; me: string | null }) {
  const isMe = (u: string | null) => !!me && !!u && u.toLowerCase() === me.toLowerCase();
  return (
    <div>
      {p.noTemplate && (
        <div style={{ fontSize: "0.8125rem", color: "#B45309" }}>
          No SAP approval request for this Sales Order — SAP didn&apos;t require approval (no Approval Template applied when it was set to C).
        </div>
      )}
      {p.templates.map((t) => (
        <div key={t.wtmCode} style={{ marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "0.8125rem" }}>{t.name}</span>
            <Badge label={t.state === "approved" ? "Approved" : t.state === "rejected" ? "Rejected" : "In progress"} tone={t.state === "approved" ? "success" : t.state === "rejected" ? "error" : "warning"} />
          </div>
          {t.warning && <div style={{ fontSize: "0.7rem", color: "#B45309", marginTop: 2 }}>⚠ {t.warning}</div>}
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {t.stages.map((st) => {
              const m = STAGE_META[st.state];
              const decided = new Map(st.approvals.concat(st.rejections).map((x) => [(x.sapUserCode ?? "").toLowerCase(), x]));
              return (
                <div key={st.wstCode} style={{ border: `1px solid ${st.state === "current" ? m.color : "var(--color-gray-200, #E2E8F0)"}`, borderRadius: 8, padding: "0.5rem 0.6rem", background: st.state === "current" ? m.bg : undefined }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: "0.78rem" }}>
                    <span><span style={{ color: m.color, fontWeight: 800 }}>{m.icon}</span> <strong>Stage {st.sortId}: {st.name}</strong></span>
                    <span style={{ color: "var(--text-secondary, #64748B)", whiteSpace: "nowrap" }}>{st.approvals.length}/{st.maxReqr} approval{st.maxReqr === 1 ? "" : "s"}</span>
                  </div>
                  {st.remarks && <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{st.remarks}</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {st.authorizers.map((a) => {
                      const dec = decided.get(a.userCode.toLowerCase());
                      return (
                        <span key={a.userCode} title={a.name ?? undefined} style={{
                          fontSize: "0.7rem", padding: "0.1rem 0.45rem", borderRadius: 999, fontWeight: isMe(a.userCode) ? 800 : 600,
                          border: `1px solid ${isMe(a.userCode) ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-200, #E2E8F0)"}`,
                          background: dec ? (dec.decision === "approved" ? "#D1FAE5" : "#FEE2E2") : "var(--bg-primary, #fff)",
                        }}>
                          {dec ? (dec.decision === "approved" ? "✓ " : "✕ ") : ""}{a.userCode}{isMe(a.userCode) ? " (you)" : ""}
                        </span>
                      );
                    })}
                    {st.authorizers.length === 0 && <span style={{ fontSize: "0.7rem", color: "#B91C1C" }}>No authorizers set in SAP</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {p.state === "pending" && p.waitingFor.length > 0 && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Waiting for: <strong>{p.waitingFor.join(", ")}</strong></div>
      )}
    </div>
  );
}

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US"));
const STATUS_META: Record<CheckStatus, { label: string; color: string; bg: string; icon: string }> = {
  pass: { label: "Pass", color: "#047857", bg: "#D1FAE5", icon: "✓" },
  warn: { label: "Review", color: "#B45309", bg: "#FEF3C7", icon: "!" },
  fail: { label: "Not recommended", color: "#B91C1C", bg: "#FEE2E2", icon: "✕" },
  error: { label: "Couldn't check", color: "#475569", bg: "#E2E8F0", icon: "?" },
};
const label: CSSProperties = { fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" };

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ ...styles.cardPadded, padding: "1.125rem 1.25rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", gap: 8 }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text-primary, #0F172A)" }}>{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Stat({ k, v, tone, sub }: { k: string; v: string; tone?: "bad" | "warn" | "good"; sub?: string }) {
  const color = tone === "bad" ? "#B91C1C" : tone === "warn" ? "#B45309" : tone === "good" ? "#047857" : "var(--text-primary, #0F172A)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "0.375rem 0", borderBottom: "1px dashed var(--color-gray-200, #E2E8F0)", fontSize: "0.8125rem" }}>
      <span style={{ color: "var(--text-secondary, #64748B)" }}>{k}</span>
      <span style={{ fontWeight: 700, color, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{v}{sub && <span style={{ display: "block", fontWeight: 500, fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)" }}>{sub}</span>}</span>
    </div>
  );
}

/** Credit used vs limit — the one picture an Accountant needs first. */
function CreditBar({ ar }: { ar: Ar }) {
  if (ar.creditLimit <= 0) return <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>No credit limit set in SAP.</div>;
  const used = ar.balance + ar.openOrders + ar.openDeliveries;
  const pct = Math.min(100, Math.max(0, (used / ar.creditLimit) * 100));
  const over = used > ar.creditLimit;
  const color = over ? "#DC2626" : pct > 85 ? "#D97706" : "#10B981";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", marginBottom: 4 }}>
        <span>Credit used {Math.round((used / ar.creditLimit) * 100)}%</span>
        <span>{money(used)} / {money(ar.creditLimit)}</span>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: "var(--color-gray-200, #E2E8F0)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <div style={{ fontSize: "0.75rem", marginTop: 4, color: over ? "#B91C1C" : "#047857", fontWeight: 700 }}>
        {over ? `Over limit by ${money(used - ar.creditLimit)}` : `Available ${money(ar.creditLimit - used)}`}
      </div>
    </div>
  );
}

function Aging({ ar }: { ar: Ar }) {
  const buckets: [string, number, string][] = AGING_BUCKETS.map(([k, l, c]) => [l, ar.aging[k], c]);
  const max = Math.max(1, ...buckets.map((b) => Math.abs(b[1])));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {buckets.map(([k, v, c]) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "64px 1fr 96px", alignItems: "center", gap: 8, fontSize: "0.75rem" }}>
          <span style={{ color: "var(--text-secondary, #64748B)" }}>{k} {k !== "Not due" ? "d" : ""}</span>
          <div style={{ height: 8, background: "var(--color-gray-100, #F1F5F9)", borderRadius: 999 }}>
            <div style={{ width: `${(Math.max(0, v) / max) * 100}%`, height: "100%", background: c, borderRadius: 999, minWidth: v > 0 ? 4 : 0 }} />
          </div>
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: v > 0 ? 700 : 400 }}>{money(v)}</span>
        </div>
      ))}
    </div>
  );
}

const cellText = (v: Cell | SubTable) =>
  v === null || v === undefined ? "—" : typeof v === "number" ? money(v) : typeof v === "string" ? v : "";

function SimpleTable({ columns, rows, compact }: { columns: SubTable["columns"]; rows: CheckRowData[]; compact?: boolean }) {
  const pad = compact ? "0.3rem 0.6rem" : "0.4rem 0.75rem";
  return (
    <table style={{ ...styles.table, fontSize: compact ? "0.74rem" : "0.78rem" }}>
      <thead>
        <tr>
          <th style={{ ...styles.th, padding: pad }}></th>
          {columns.map((c) => <th key={c.key} style={{ ...styles.th, padding: pad, textAlign: c.align ?? "left" }}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const m = STATUS_META[r._status ?? "pass"];
          return (
            <tr key={i} style={{ background: r._status && r._status !== "pass" ? m.bg : undefined }}>
              <td style={{ ...styles.td, padding: pad, color: m.color, fontWeight: 800 }}>{m.icon}</td>
              {columns.map((c) => (
                <td key={c.key} style={{ ...styles.td, padding: pad, textAlign: c.align ?? "left", fontVariantNumeric: "tabular-nums" }}>{cellText(r[c.key])}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CheckTable({ check }: { check: Check }) {
  // Rows with a nested table (an item's batches) can be opened; failing ones start open.
  const [open, setOpen] = useState<Set<number>>(() => new Set(check.rows.map((r, i) => (r._sub && r._status === "fail" ? i : -1)).filter((i) => i >= 0)));
  if (!check.rows.length) return null;
  const pad = "0.4rem 0.75rem";
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 8, marginTop: "0.75rem" }}>
      <table style={{ ...styles.table, fontSize: "0.78rem" }}>
        <thead>
          <tr>
            <th style={{ ...styles.th, padding: "0.5rem 0.75rem" }}></th>
            {check.columns.map((c) => <th key={c.key} style={{ ...styles.th, padding: "0.5rem 0.75rem", textAlign: c.align ?? "left" }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {check.rows.map((r, i) => {
            const m = STATUS_META[r._status ?? "pass"];
            const sub = r._sub;
            const isOpen = open.has(i);
            return (
              <Fragment key={i}>
                <tr style={{ background: r._status && r._status !== "pass" ? m.bg : undefined }}>
                  <td style={{ ...styles.td, padding: pad, color: m.color, fontWeight: 800 }}>{m.icon}</td>
                  {check.columns.map((c, ci) => (
                    <td key={c.key} style={{ ...styles.td, padding: pad, textAlign: c.align ?? "left", fontVariantNumeric: "tabular-nums" }}>
                      {cellText(r[c.key])}
                      {ci === 0 && sub && (
                        <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                          style={{ marginLeft: 6, border: "none", background: "none", color: "var(--color-primary, #2BBCB3)", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
                          {isOpen ? "▾" : "▸"} {sub.rows.length} batch{sub.rows.length === 1 ? "" : "es"}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
                {sub && isOpen && (
                  <tr>
                    <td colSpan={check.columns.length + 1} style={{ padding: "0.25rem 0.75rem 0.75rem 2.25rem", background: "var(--bg-secondary, #F8FAFC)" }}>
                      <SimpleTable columns={sub.columns} rows={sub.rows} compact />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {check.key === "stock" && (
        <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", padding: "0.4rem 0.75rem", lineHeight: 1.5 }}>
          * Committed = open Sales Orders + transfer requests + production orders (SAP QRM_Inventory by Warehouse); &quot;by others&quot; leaves out
          this order. Available for order = On hand − Committed by others. Meets shelf life = qty of the batches inside the customer&apos;s
          required range. Usable = the smaller of the two (SAP doesn&apos;t reserve batches, so other orders may take the good ones first).
        </div>
      )}
    </div>
  );
}

export default function ApprovalDetailPage() {
  // Same pattern as the admin order page (client component, useParams).
  const { id } = useParams<{ id: string; locale: string }>();
  const base = useStaffBase();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);          // index of the open step (6 = decision)
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({});
  const [finalNote, setFinalNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (recheck = false) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/approvals/${id}${recheck ? "?recheck=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setD(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const checks = d?.checks ?? [];
  const decided = d?.order.arStatus === "approved";
  const needsNote = (c: Check) => c.status !== "pass";
  const canLeave = (c: Check) => !needsNote(c) || !!stepNotes[c.key]?.trim();
  // Approve needs a checking note on every step that isn't a pass; passed steps need nothing more
  // (clicking through them is optional), so opening a step directly can't block approval.
  const missingNotes = checks.filter((c) => !canLeave(c));
  const allReviewed = checks.length > 0 && missingNotes.length === 0;
  const overall: CheckStatus = useMemo(() => {
    const s = checks.map((c) => c.status);
    return s.includes("fail") ? "fail" : s.includes("error") ? "error" : s.includes("warn") ? "warn" : "pass";
  }, [checks]);

  const next = (c: Check, i: number) => {
    if (!canLeave(c)) return;
    setReviewed((r) => new Set(r).add(c.key));
    setCurrent(i + 1);
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !finalNote.trim()) { setMessage("Write the reason for rejecting."); return; }
    const stageText = d?.decide.stages.map((x) => x.stageName).join(", ");
    const asUser = d?.decide.override && !d?.sapSession ? "the portal's SAP integration login" : d?.sapSession?.sapUser ?? d?.sapUserCode;
    if (decision === "approved" && !confirm(d?.decide.completes
      ? `Approve ${d?.sap?.docNo ?? "this Sales Order"}${stageText ? ` (stage ${stageText})` : ""} and release it in SAP (U_DataStatus C) as ${asUser}?`
      : `Approve stage ${stageText} of ${d?.sap?.docNo ?? "this Sales Order"}? It then waits for the next stage.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/approvals/${id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: finalNote, stepNotes }),
      });
      const data = await res.json();
      if (res.status === 428) {
        // No saved SAP login, or SAP refused it (password changed in SAP) — update it in My Profile.
        setD((prev) => (prev ? { ...prev, sapSession: null, sapAccount: data.code === "sap_password_invalid" ? prev.sapAccount : { hasPassword: false, updatedAt: null } } : prev));
        throw new Error(data.error || "Save your SAP user and password in My Profile first");
      }
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage(
        data.outcome === "approved" ? `✓ Approved — U_DataStatus set to C in SAP as ${data.sapUser}.`
          : data.outcome === "stage_approved" ? `✓ Stage approved — now waiting for ${(data.waitingFor ?? []).join(", ") || "the next stage"}.`
          : data.outcome === "stage_rejected" ? `Rejection recorded — the stage needs more rejections to reject the order.`
          : "Rejected — the Sales Order stays at I in SAP."
      );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !d) return <div style={styles.page}><div style={styles.empty}>Loading — checking prices, stock and AR in SAP…</div></div>;
  if (error && !d) return <div style={styles.page}><div style={styles.container}><BackLink href={`${base}/approvals`} label="← Back to queue" /><div style={{ ...styles.cardPadded, marginTop: "1rem", color: "#B91C1C" }}>{error}</div></div></div>;
  if (!d) return null;

  const { order, sap, ar } = d;
  const sapReady = !!d.sapSession || d.sapAccount.hasPassword || d.decide.override;
  const sapAs = d.sapSession?.sapUser ?? (d.sapAccount.hasPassword ? d.sapUserCode : null);
  const statusBadge = order.arStatus === "approved" ? <Badge label="Approved" tone="success" /> : order.arStatus === "rejected" ? <Badge label="Rejected" tone="error" /> : <Badge label="Waiting for approval" tone="warning" />;

  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, maxWidth: 1400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", gap: 8, flexWrap: "wrap" }}>
          <BackLink href={`${base}/approvals`} label="← Back to queue" />
          <button style={btn("secondary", loading)} disabled={loading} onClick={() => { setReviewed(new Set()); setCurrent(0); load(true); }}>
            {loading ? "Checking…" : "↻ Re-run checks"}
          </button>
        </div>

        {/* ── SO header ── */}
        <div style={{ ...styles.cardPadded, padding: "1.25rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: "1.4rem", fontWeight: 800 }}>{sap?.docNo || order.orderNumber}</h1>
                {statusBadge}
                {sap && <Badge label={`SAP U_DataStatus ${sap.dataStatus ?? "?"}`} tone={sap.dataStatus === "C" ? "success" : "neutral"} />}
                {sap?.cancelled && <Badge label="Cancelled in SAP" tone="error" />}
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)", marginTop: 4 }}>
                DocEntry <strong>{sap?.docEntry ?? order.docEntry}</strong> · DocNum {sap?.docNum ?? "—"}
                {order.source === "portal" ? ` · Portal ${order.orderNumber}` : " · created in SAP"}
                {order.creator ? ` by SAP user ${order.creator}` : ""} · {order.createdAt?.slice(0, 16).replace("T", " ")}
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{order.customerName}</div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                  {order.cardCode} · MST <strong>{order.mstCode || "—"}</strong>{order.warehouseCode ? ` · Warehouse ${order.warehouseCode}` : ""}
                  {order.supervisorName ? ` · Supervisor ${order.supervisorName}` : ""}{order.createdByStaff ? ` · Created by ${order.createdByStaff}` : ""}
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, auto))", gap: "0.5rem 1.5rem", alignContent: "start" }}>
              <div><div style={label}>Excl. tax</div><div style={{ fontSize: "1.1rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(sap?.totalExclTax)}</div></div>
              <div><div style={label}>VAT</div><div style={{ fontSize: "1.1rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(sap?.vatSum)}</div></div>
              <div><div style={label}>Incl. tax</div><div style={{ fontSize: "1.35rem", fontWeight: 800, color: "var(--color-primary, #2BBCB3)", fontVariantNumeric: "tabular-nums" }}>{money(sap?.totalInclTax)}</div></div>
            </div>
          </div>
          {sap?.comments && <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "var(--bg-secondary, #F8FAFC)", borderRadius: 8, fontSize: "0.8125rem" }}><span style={label}>Remarks </span>{sap.comments}</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(300px, 1fr)", gap: "1rem", alignItems: "start" }} className="so-approval-grid">
          {/* ── Main: checklist stepper ── */}
          <div>
            <Card title="Approval checklist" right={<span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>checked {new Date(d.checkedAt).toLocaleTimeString()}</span>}>
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {checks.map((c, i) => {
                  const m = STATUS_META[c.status];
                  const open = current === i && !decided;
                  const done = reviewed.has(c.key) && canLeave(c);
                  return (
                    <div key={c.key} style={{ border: `1px solid ${open ? m.color : "var(--color-gray-200, #E2E8F0)"}`, borderRadius: 10, overflow: "hidden" }}>
                      <button onClick={() => setCurrent(i)} style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "0.75rem 1rem",
                        background: open ? m.bg : "var(--bg-primary, #fff)", border: "none", cursor: "pointer", textAlign: "left",
                      }}>
                        <span style={{ width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 800, fontSize: "0.8rem", color: "#fff", background: m.color }}>
                          {done ? "✓" : c.step}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--text-primary, #0F172A)" }}>{c.title}</span>
                          <span style={{ display: "block", fontSize: "0.78rem", color: "var(--text-secondary, #64748B)", whiteSpace: open ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.summary}</span>
                        </span>
                        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: m.color, background: m.bg, padding: "0.2rem 0.6rem", borderRadius: 999, whiteSpace: "nowrap" }}>{m.label}</span>
                      </button>
                      {open && (
                        <div style={{ padding: "0 1rem 1rem" }}>
                          <CheckTable check={c} />
                          <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.75rem", borderRadius: 8, background: m.bg, color: m.color, fontSize: "0.8125rem", fontWeight: 600 }}>
                            System: {c.recommendation}
                          </div>
                          {needsNote(c) && (
                            <div style={{ marginTop: "0.75rem" }}>
                              <div style={label}>Checking note * <span style={{ textTransform: "none", fontWeight: 500 }}>(required to continue)</span></div>
                              <textarea style={{ ...styles.input, width: "100%", minHeight: 64, marginTop: 4, fontFamily: "inherit" }}
                                placeholder="Why it's OK to continue — e.g. price agreed by Sales Manager, payment promised on …"
                                value={stepNotes[c.key] ?? ""} onChange={(e) => setStepNotes({ ...stepNotes, [c.key]: e.target.value })} />
                            </div>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.75rem", gap: 8 }}>
                            <button style={btn("secondary", i === 0)} disabled={i === 0} onClick={() => setCurrent(i - 1)}>← Previous</button>
                            <button style={btn("primary", !canLeave(c))} disabled={!canLeave(c)} onClick={() => next(c, i)}>
                              {c.status === "pass"
                                ? (i === checks.length - 1 ? "Go to decision →" : "Next step →")
                                : (i === checks.length - 1 ? "Continue anyway → Decision" : "Continue anyway →")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* ── Decision ── */}
            <Card title="Decision">
              {decided ? (
                <div style={{ fontSize: "0.875rem", color: "#047857", fontWeight: 600 }}>This Sales Order is approved (U_DataStatus = C in SAP).</div>
              ) : (
                <>
                  <div style={{ padding: "0.6rem 0.75rem", borderRadius: 8, background: STATUS_META[overall].bg, color: STATUS_META[overall].color, fontSize: "0.8125rem", fontWeight: 700, marginBottom: "0.75rem" }}>
                    {overall === "pass" ? "System recommends: APPROVE — all six checks passed."
                      : overall === "fail" ? `System does NOT recommend approving — ${checks.filter((c) => c.status === "fail").map((c) => c.title).join(", ")}.`
                      : `Review needed — ${checks.filter((c) => c.status !== "pass").map((c) => c.title).join(", ")}.`}
                  </div>
                  {!d.decide.canDecide && (
                    <div style={{ padding: "0.6rem 0.75rem", borderRadius: 8, background: "#F1F5F9", color: "#334155", fontSize: "0.8125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
                      🔒 {d.decide.reason}
                    </div>
                  )}
                  {d.decide.canDecide && (
                    <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                      {d.decide.override
                        ? <>⚠ {d.decide.reason}</>
                        : <>You decide in SAP approval stage <strong>{d.decide.stages.map((x) => `${x.templateName} · ${x.stageName}`).join(", ")}</strong>.
                          {d.decide.completes ? " Approving completes the procedure and releases the Sales Order in SAP." : " After your approval it waits for the next stage."}</>}
                    </div>
                  )}
                  {!allReviewed && (
                    <div style={{ fontSize: "0.8125rem", color: "#B45309", marginBottom: "0.75rem", fontWeight: 600 }}>
                      {checks.length === 0
                        ? "The checks haven't run — click ↻ Re-run checks."
                        : <>Write the checking note for: {missingNotes.map((c, k) => (
                            <button key={c.key} type="button" onClick={() => setCurrent(checks.indexOf(c))}
                              style={{ border: "none", background: "none", padding: 0, color: "var(--color-primary, #2BBCB3)", fontWeight: 800, cursor: "pointer", textDecoration: "underline" }}>
                              {k ? ", " : ""}{c.step}. {c.title}
                            </button>
                          ))} — then Approve is enabled.</>}
                    </div>
                  )}
                  <div style={label}>Decision note {order.arStatus === "rejected" ? "" : "(required to reject)"}</div>
                  <textarea style={{ ...styles.input, width: "100%", minHeight: 70, marginTop: 4, fontFamily: "inherit" }} value={finalNote}
                    onChange={(e) => setFinalNote(e.target.value)} placeholder="Overall comment — shown in the approval history" />
                  <div style={{ display: "flex", gap: 8, marginTop: "0.75rem", flexWrap: "wrap" }}>
                    <button style={btn("success", busy || !allReviewed || !sapReady || !d.decide.canDecide)} disabled={busy || !allReviewed || !sapReady || !d.decide.canDecide} onClick={() => decide("approved")}>
                      {busy ? "Working…" : d.decide.completes
                        ? `✓ Approve & release in SAP${sapAs ? ` as ${sapAs}` : ""}`
                        : `✓ Approve stage${sapAs ? ` as ${sapAs}` : ""}`}
                    </button>
                    <button style={btn("danger", busy || !d.decide.canDecide)} disabled={busy || !d.decide.canDecide} onClick={() => decide("rejected")}>✕ Reject</button>
                  </div>
                  {!sapReady && (
                    <div style={{ fontSize: "0.75rem", color: "#B45309", marginTop: 6 }}>
                      Save your SAP user and password once in <a href={`${base}/change-password`} style={{ color: "inherit", fontWeight: 700 }}>My Profile</a> to approve.
                    </div>
                  )}
                </>
              )}
              {message && <div style={{ marginTop: "0.75rem", fontSize: "0.8125rem", fontWeight: 600 }}>{message}</div>}
            </Card>

            {/* ── Order lines ── */}
            <Card title={`Order lines (${order.lines.length})`}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ ...styles.table, fontSize: "0.78rem" }}>
                  <thead><tr>{["Item", "Name", "Qty", "Price", "Disc %", "Total"].map((h, i) => <th key={h} style={{ ...styles.th, padding: "0.5rem 0.75rem", textAlign: i >= 2 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {order.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ ...styles.td, padding: "0.4rem 0.75rem" }}>
                          {l.item}
                          {l.gift && <span style={{ marginLeft: 6 }}><Badge label="Free" tone="success" /></span>}
                          {l.kind && <span style={{ marginLeft: 6 }}><Badge label={l.kind} tone="neutral" /></span>}
                        </td>
                        <td style={{ ...styles.td, padding: "0.4rem 0.75rem" }}>{l.name}</td>
                        <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{l.qty} {l.uom}</td>
                        <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{money(l.price)}</td>
                        <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right" }}>{l.discountPct ? `${l.discountPct}%` : "—"}</td>
                        <td style={{ ...styles.td, padding: "0.4rem 0.75rem", textAlign: "right", fontWeight: 600 }}>{money(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {d.history.length > 0 && (
              <Card title="Approval history">
                {d.history.map((h, i) => (
                  <div key={i} style={{ padding: "0.5rem 0", borderBottom: "1px dashed var(--color-gray-200, #E2E8F0)", fontSize: "0.8125rem" }}>
                    <Badge label={h.decision === "approved" ? "Approved" : "Rejected"} tone={h.decision === "approved" ? "success" : "error"} />{" "}
                    <strong>{h.by}</strong>{h.sapUser ? ` (SAP ${h.sapUser})` : ""} · {h.at?.slice(0, 16).replace("T", " ")}
                    <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", marginTop: 2 }}>
                      {h.stage ?? "Super Admin decision (outside SAP stages)"}{h.superseded ? " · previous round" : ""}
                    </div>
                    {h.notes && <div style={{ marginTop: 4 }}>{h.notes}</div>}
                    {h.stepNotes && Object.entries(h.stepNotes).map(([k, v]) => (
                      <div key={k} style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2 }}>• {checks.find((c) => c.key === k)?.title ?? k}: {v}</div>
                    ))}
                  </div>
                ))}
              </Card>
            )}
          </div>

          {/* ── Side: SAP approval procedure, customer credit / AR ── */}
          <div style={{ position: "sticky", top: "1rem" }}>
            <Card title="SAP approval request" right={d.decide.requestNo ? <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>#{d.decide.requestNo}</span> : undefined}>
              <ProcedureCard p={d.procedure} me={d.sapUserCode} />
            </Card>

            <Card title="Customer credit & AR" right={ar && ar.overdueInvoiceCount > 0 ? <Badge label="Overdue" tone="error" /> : ar && ar.openInvoiceCount ? <Badge label="Open invoices" tone="warning" /> : <Badge label="Clear" tone="success" />}>
              {!ar ? <div style={{ color: "#B91C1C", fontSize: "0.8125rem" }}>AR data unavailable from SAP.</div> : (
                <>
                  <CreditBar ar={ar} />
                  <div style={{ marginTop: "0.75rem" }}>
                    <Stat k="AR balance" v={money(ar.balance)} />
                    <Stat k="Open Sales Orders" v={money(ar.openOrders)} sub="incl. this order" />
                    <Stat k="Delivered, not invoiced" v={money(ar.openDeliveries)} />
                    <Stat k="Invoices not reconciled" v={`${ar.openInvoiceCount} · ${money(ar.openInvoiceAmount)}`} tone={ar.openInvoiceCount ? "warn" : "good"} />
                    <Stat k="Overdue" v={`${ar.overdueInvoiceCount} · ${money(ar.overdueAmount)}`} tone={ar.overdueInvoiceCount ? "bad" : "good"} sub={ar.overdueInvoiceCount ? `oldest ${ar.oldestOverdueDays} days` : undefined} />
                    {ar.unreconciledCreditCount > 0 && <Stat k="Payments / credits not reconciled" v={`${ar.unreconciledCreditCount} · −${money(ar.unreconciledCredits)}`} tone="warn" />}
                    <Stat k="Net open (AR aging)" v={money(ar.agingTotal)} />
                  </div>
                  <div style={{ ...label, margin: "0.875rem 0 0.5rem", display: "flex", justifyContent: "space-between" }}>
                    <span>AR aging (days past due)</span><span style={{ textTransform: "none", letterSpacing: 0 }}>as of {ar.agingAsOf}</span>
                  </div>
                  <Aging ar={ar} />
                  {d.arBrands && (
                    <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: 6 }}>
                      Aging covers your brands only: {d.arBrands.join(", ")}. AR balance / credit limit are the customer&apos;s totals in SAP.
                    </div>
                  )}
                  <a href={`${base}/ar-aging?card=${encodeURIComponent(ar.cardCode)}`} target="_blank" rel="noreferrer"
                    style={{ display: "inline-block", marginTop: "0.6rem", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-primary, #2BBCB3)" }}>
                    Open in AR Aging ↗
                  </a>
                  {(ar.phone || ar.email) && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.75rem" }}>{[ar.phone, ar.email].filter(Boolean).join(" · ")}</div>}
                </>
              )}
            </Card>

            <Card title="SAP account">
              {d.decide.override && !d.sapSession && !d.sapAccount.hasPassword ? (
                <div style={{ fontSize: "0.8125rem" }}>
                  Super Admin decisions are released in SAP by the portal&apos;s SAP integration login.
                </div>
              ) : !d.sapUserCode || !d.sapAccount.hasPassword ? (
                <div style={{ fontSize: "0.8125rem" }}>
                  <div style={{ color: "#B45309", fontWeight: 600 }}>
                    {d.sapUserCode ? `No SAP password saved for ${d.sapUserCode}.` : "No SAP user is linked to your account."}
                  </div>
                  <div style={{ marginTop: 4 }}>Enter your SAP user and password once in My Profile — approving then signs in to SAP automatically.</div>
                  <a href={`${base}/change-password`} style={{ ...btn("primary"), display: "inline-block", marginTop: 8, textDecoration: "none" }}>Open My Profile →</a>
                </div>
              ) : (
                <div style={{ fontSize: "0.8125rem" }}>
                  Approving as SAP user <strong>{d.sapUserCode}</strong>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginTop: 2 }}>
                    Password saved{d.sapAccount.updatedAt ? ` ${d.sapAccount.updatedAt.slice(0, 16).replace("T", " ")}` : ""} (encrypted)
                    {d.sapSession ? ` · signed in to SAP until about ${new Date(d.sapSession.expiresAt).toLocaleTimeString()}` : " · signs in to SAP when you approve"}
                  </div>
                  <a href={`${base}/change-password`} style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--color-primary, #2BBCB3)" }}>Changed your SAP password? Update it in My Profile</a>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .so-approval-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
