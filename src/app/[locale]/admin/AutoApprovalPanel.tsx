"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { styles, btn, Badge } from "./adminUi";
import { useStaffBase } from "./layout";
import { VN_TIME_ZONE } from "@/lib/vnTime";
import {
  validateStockSyncWindows, STOCK_SYNC_MIN_MINUTES, STOCK_SYNC_MAX_MINUTES, STOCK_SYNC_MAX_WINDOWS, type StockSyncWindow,
} from "@/lib/stockSyncWindows";

/**
 * Auto SO Approval for ONE Accountant — their own page (Credit Control →
 * Auto SO Approval, apiUrl /api/admin/me/auto-approval) and System Admin's
 * Settings (apiUrl /api/admin/settings/auto-approval/<id>). Same API shape.
 */
interface AutoCheck { key: string; step: number; title: string; status: string; summary: string }
interface LogRow {
  id: number; runId: number; docEntry: number; docNo: string | null; cardCode: string | null; cardName: string | null;
  outcome: "approved" | "skipped" | "failed"; reason: string | null; checks: AutoCheck[]; approvalOutcome: string | null;
  checkCount: number; createdAt: string; lastCheckedAt: string;
}
interface RunRow {
  id: number; trigger: "schedule" | "manual"; status: string; checked: number; approved: number; skipped: number; failed: number;
  summary: string | null; startedAt: string; finishedAt: string | null;
}
interface Detail {
  setting: { enabled: boolean; windows: StockSyncWindow[]; lastRunAt: string | null; lastRunStatus: string | null; lastRunSummary: string | null; updatedAt: string | null };
  runs: RunRow[];
  log: LogRow[];
  running: boolean;
  sap: { userCode: string | null; hasPassword: boolean };
}

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-GB", { timeZone: VN_TIME_ZONE }) : "—");
const toneOf = (s: string): "success" | "warning" | "error" | "neutral" =>
  s === "approved" || s === "success" || s === "pass" ? "success" : s === "skipped" || s === "partial" || s === "warn" ? "warning" : s === "failed" || s === "fail" || s === "error" ? "error" : "neutral";
const STEP_COLORS: Record<string, string> = { pass: "#16A34A", warn: "#D97706", fail: "#DC2626", error: "#7C3AED" };

export function AutoApprovalPanel({ apiUrl, who }: { apiUrl: string; who?: string }) {
  const base = useStaffBase();
  const [d, setD] = useState<Detail | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [windows, setWindows] = useState<StockSyncWindow[]>([]);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const load = useCallback(async (resetForm = false) => {
    const r = await fetch(`${apiUrl}${outcome ? `?outcome=${outcome}` : ""}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? `Error ${r.status}`); return; }
    setError(null);
    setD(j);
    if (resetForm) { setEnabled(!!j.setting?.enabled); setWindows(j.setting?.windows ?? []); }
  }, [apiUrl, outcome]);

  useEffect(() => { void load(true); }, [apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d) void load(false); }, [outcome]); // eslint-disable-line react-hooks/exhaustive-deps
  // While a run is going, refresh every 4 s.
  useEffect(() => {
    if (!d?.running) return;
    const t = setInterval(() => void load(false), 4000);
    return () => clearInterval(t);
  }, [d?.running, load]);

  const save = async () => {
    const err = validateStockSyncWindows(windows);
    if (err) { setMessage(err); return; }
    if (enabled && windows.length === 0) { setMessage("Add at least one time window — outside every window it doesn't run."); return; }
    setBusy(true); setMessage(null);
    const r = await fetch(apiUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, windows }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMessage(r.ok ? "Saved." : j.error ?? `Error ${r.status}`);
    if (r.ok) void load(true);
  };

  const runNow = async () => {
    setBusy(true); setMessage(null);
    const r = await fetch(apiUrl, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMessage(r.ok ? "Run started — results appear below." : j.message ?? j.error ?? `Error ${r.status}`);
    void load(false);
  };

  if (error && !d) return <div style={{ ...styles.empty, color: "var(--color-error, #DC2626)" }}>{error}</div>;
  if (!d) return <div style={styles.empty}>Loading…</div>;

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const small = { fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {!d.sap.hasPassword && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: 8, background: "#FEF3C7", color: "#92400E", fontSize: "0.8125rem" }}>
          ⚠ {who ?? "This user"} has no SAP password saved{d.sap.userCode ? ` for ${d.sap.userCode}` : ""} (My Profile → SAP account).
          Auto SO Approval approves as that SAP user, so runs will fail until it&apos;s saved.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", maxWidth: 560 }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16 }} />
          Auto SO Approval
        </label>
        <p style={small}>
          On the time windows below (Vietnam time), the portal re-runs the 6 checks on every SO waiting for
          {who ? ` ${who}'s` : " your"} approval — only {who ? "their" : "your"} own queue, never another Accountant&apos;s. When all 6 steps
          pass it approves the SO as {d.sap.userCode ?? "the SAP user"}; otherwise the SO stays pending for manual approval and the
          log below says which step failed and why. SOs whose approval was undone are never auto-approved.
          Outside every window it doesn&apos;t run. End is exclusive (24:00 = end of day); an end earlier than the start crosses midnight.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8125rem" }}>
          <div style={{ fontWeight: 600 }}>Time windows</div>
          {windows.length === 0 && <div style={small}>No time window — it will not run automatically.</div>}
          {windows.map((w, i) => {
            const update = (patch: Partial<StockSyncWindow>) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
                <input type="text" inputMode="numeric" placeholder="HH:MM" value={w.start} onChange={(e) => update({ start: e.target.value.trim() })}
                  style={{ ...styles.input, width: 80 }} aria-label={`Window ${i + 1} start`} />
                <span>to</span>
                <input type="text" inputMode="numeric" placeholder="HH:MM" value={w.end} onChange={(e) => update({ end: e.target.value.trim() })}
                  style={{ ...styles.input, width: 80 }} aria-label={`Window ${i + 1} end`} />
                <span>every</span>
                <input type="number" min={STOCK_SYNC_MIN_MINUTES} max={STOCK_SYNC_MAX_MINUTES} value={w.intervalMinutes}
                  onChange={(e) => update({ intervalMinutes: Math.round(Number(e.target.value) || 0) })}
                  style={{ ...styles.input, width: 80 }} aria-label={`Window ${i + 1} interval in minutes`} />
                <span>min</span>
                <button type="button" onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))} style={btn("secondary", false)} aria-label={`Remove window ${i + 1}`}>✕</button>
              </div>
            );
          })}
          {windows.length < STOCK_SYNC_MAX_WINDOWS && (
            <div>
              <button type="button" style={btn("secondary", false)}
                onClick={() => setWindows((ws) => [...ws, ws.length === 0 ? { start: "08:00", end: "17:00", intervalMinutes: 10 } : { start: "17:00", end: "22:00", intervalMinutes: 30 }])}>
                + Add time window
              </button>
            </div>
          )}
          <div style={small}>Interval {STOCK_SYNC_MIN_MINUTES}–{STOCK_SYNC_MAX_MINUTES} minutes. Windows must not overlap.</div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={save} disabled={busy} style={btn("primary", busy)}>Save</button>
          <button onClick={runNow} disabled={busy || d.running} style={btn("secondary", busy || d.running)}>
            {d.running ? "Running…" : "▶ Run now"}
          </button>
          {message && <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>{message}</span>}
        </div>
        <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
          <strong>Last run:</strong> {fmt(d.setting.lastRunAt)}
          {d.setting.lastRunStatus && <> · <Badge label={d.setting.lastRunStatus} tone={toneOf(d.setting.lastRunStatus)} /></>}
          {d.setting.lastRunSummary && <div style={{ marginTop: 4 }}>{d.setting.lastRunSummary}</div>}
        </div>
      </div>

      {d.runs.length > 0 && (
        <div>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.5rem" }}>Recent runs</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead><tr>
                {["#", "Started", "Trigger", "Status", "Checked", "Approved", "Manual review", "Failed", "Summary"].map((h) => <th key={h} style={styles.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {d.runs.map((r) => (
                  <tr key={r.id}>
                    <td style={styles.td}>{r.id}</td>
                    <td style={styles.td}>{fmt(r.startedAt)}</td>
                    <td style={styles.td}>{r.trigger === "manual" ? "Run now" : "Schedule"}</td>
                    <td style={styles.td}><Badge label={r.status} tone={toneOf(r.status)} /></td>
                    <td style={styles.td}>{r.checked}</td>
                    <td style={styles.td}>{r.approved}</td>
                    <td style={styles.td}>{r.skipped}</td>
                    <td style={styles.td}>{r.failed}</td>
                    <td style={{ ...styles.td, whiteSpace: "normal", minWidth: 260 }}>{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 700 }}>Log — each SO checked</h3>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ ...styles.input, width: "auto" }}>
            <option value="">All outcomes</option>
            <option value="approved">Auto-approved</option>
            <option value="skipped">Left for manual review</option>
            <option value="failed">Failed</option>
          </select>
          <span style={small}>A repeated identical result is counted on one row (“checked N×”).</span>
        </div>
        {d.log.length === 0 ? <div style={styles.empty}>Nothing logged yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead><tr>
                {["Last checked", "SO No", "Customer", "Outcome", "Steps 1–6", "Why", ""].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {d.log.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td style={styles.td}>
                        {fmt(l.lastCheckedAt)}
                        {l.checkCount > 1 && <div style={small}>checked {l.checkCount}× since {fmt(l.createdAt)}</div>}
                      </td>
                      <td style={styles.td}><a href={`${base}/approvals/${l.docEntry}`} style={{ color: "var(--color-primary, #2BBCB3)", fontWeight: 600 }}>{l.docNo ?? l.docEntry}</a></td>
                      <td style={{ ...styles.td, whiteSpace: "normal", minWidth: 160 }}>{l.cardName ?? ""}<div style={small}>{l.cardCode}</div></td>
                      <td style={styles.td}>
                        <Badge label={l.outcome === "skipped" ? "manual review" : l.outcome === "approved" && l.approvalOutcome === "stage_approved" ? "stage approved" : l.outcome} tone={toneOf(l.outcome)} />
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", gap: 3 }}>
                          {l.checks.length === 0 ? <span style={small}>—</span> : l.checks.map((c) => (
                            <span key={c.key} title={`${c.step}. ${c.title}: ${c.status} — ${c.summary}`}
                              style={{ width: 20, height: 20, borderRadius: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", background: STEP_COLORS[c.status] ?? "#64748B" }}>
                              {c.step}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ ...styles.td, whiteSpace: "pre-wrap", minWidth: 280, fontSize: "0.75rem" }}>{l.reason}</td>
                      <td style={styles.td}>
                        {l.checks.length > 0 && <button type="button" onClick={() => toggle(l.id)} style={btn("secondary", false)}>{open.has(l.id) ? "Hide" : "Steps"}</button>}
                      </td>
                    </tr>
                    {open.has(l.id) && (
                      <tr>
                        <td colSpan={7} style={{ ...styles.td, background: "var(--bg-secondary, #F8FAFC)", whiteSpace: "normal" }}>
                          {l.checks.map((c) => (
                            <div key={c.key} style={{ fontSize: "0.75rem", padding: "2px 0" }}>
                              <strong style={{ color: STEP_COLORS[c.status] ?? "inherit" }}>{c.step}. {c.title} — {c.status.toUpperCase()}</strong>: {c.summary}
                            </div>
                          ))}
                          <div style={{ ...small, marginTop: 4 }}>Run #{l.runId}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
