"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { styles, btn, LoadingOrEmpty } from "../adminUi";
import { useStaffBase, useAdminSession } from "../layout";
import { ArStatusBadge, AR_STATUS, money, dmy } from "./arUi";

/**
 * AR Invoice — invoices entered on the portal and added to SAP as A/R
 * Invoices as the user's own SAP user; SAP's AR approval templates
 * (AR01–AR05) apply. Click a row to open it; "Waiting for you" = SAP approval
 * requests where you are a pending approver of the current stage.
 */
interface Row {
  id: number; source: "portal" | "sap"; doc_number: string | null; status: string; sap_card_code: string; card_name: string | null;
  doc_date: string; num_at_card: string | null; comments: string | null; doc_total: number; total_before_vat: number;
  sap_doc_num: number | null; sap_doc_no: string | null; brand_code: string | null; template_name: string | null; created_by_label: string | null; posted_sap_user: string | null;
  last_error: string | null; waitingForMe: boolean;
}

export default function ArInvoicesPage() {
  const base = useStaffBase();
  const blank = { brand: "", search: "", status: "all", from: "", to: "", waiting: false };
  const [f, setF] = useState(blank);
  const [applied, setApplied] = useState(blank);
  const [rows, setRows] = useState<Row[]>([]);
  const [sapUser, setSapUser] = useState<string | null>(null);
  const [brands, setBrands] = useState<{ code: string; name: string | null }[]>([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (q: typeof blank) => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams();
      if (q.brand) p.set("brand", q.brand);
      if (q.search) p.set("search", q.search);
      if (q.status !== "all") p.set("status", q.status);
      if (q.from) p.set("from", q.from);
      if (q.to) p.set("to", q.to);
      if (q.waiting) p.set("waiting", "1");
      const res = await fetch(`/api/admin/ar-invoices?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setRows(json.rows);
      setSapUser(json.sapUser);
      setBrands(json.brands ?? []);
      setWaitingCount(json.counts.waitingForMe);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(applied); }, [load, applied]);
  const run = (q = f) => { setF(q); setApplied({ ...q }); };

  // AR Approve (Accountants): approve SAP's approval request as your own SAP user — only the
  // invoices whose current approval stage (AR01–AR05 template) waits for you. Reject is on the invoice page.
  const session = useAdminSession();
  const canApprove = session?.kind === "account";
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);
  const [approveMsg, setApproveMsg] = useState<{ ok: string[]; failed: string[] } | null>(null);
  const waitingRows = rows.filter((r) => r.waitingForMe);
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => rows.some((r) => r.id === id && r.waitingForMe)))); }, [rows]);
  const label = (r: Row) => r.sap_doc_no ?? r.doc_number ?? `#${r.id}`;
  const approve = async (targets: Row[]) => {
    if (!targets.length) return;
    const total = targets.reduce((t, r) => t + Number(r.doc_total), 0);
    if (!confirm(`AR Approve ${targets.length} AR Invoice${targets.length > 1 ? "s" : ""} as SAP user ${sapUser ?? "(yours)"}?\n\n`
      + targets.slice(0, 12).map((r) => `• ${label(r)} — ${r.sap_card_code} — ${money(r.doc_total)} ₫`).join("\n")
      + (targets.length > 12 ? `\n… and ${targets.length - 12} more` : "") + `\n\nTotal ${money(total)} ₫. After the last stage SAP adds the invoice.`)) return;
    setApproving(true);
    const ok: string[] = [], failed: string[] = [];
    for (const r of targets) {
      try {
        const res = await fetch(`/api/admin/ar-invoices/${r.id}/decision`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approved", remarks: "" }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.code === "sap_login_required" || j.code === "sap_password_invalid" ? `${j.error} — open My Profile to save your SAP user and password` : j.error || "Failed");
        ok.push(`${label(r)}: ${j.message ?? "Approved."}`);
      } catch (e) {
        failed.push(`${label(r)}: ${e instanceof Error ? e.message : "Failed"}`);
        if (/My Profile/.test(String((e as Error)?.message))) break; // no SAP login — the rest would fail the same way
      }
    }
    setApproving(false);
    setSel(new Set());
    setApproveMsg({ ok, failed });
    load(applied);
  };

  const td: CSSProperties = { ...styles.td, padding: "0.55rem 0.75rem" };
  const th: CSSProperties = { ...styles.th, padding: "0.6rem 0.75rem" };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, maxWidth: 1400 }}>
        <div style={styles.header}>
          <h1 style={styles.title}>AR Invoice (CK)</h1>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {canApprove && (
              <button type="button" style={btn("primary", approving || sel.size === 0)} disabled={approving || sel.size === 0}
                title={sel.size ? "Approve the ticked AR Invoices" : "Tick the AR Invoices waiting for you (or open one), then AR Approve"}
                onClick={() => approve(sel.size ? waitingRows.filter((r) => sel.has(r.id)) : [])}>
                {approving ? "Approving…" : `✅ AR Approve${sel.size ? ` (${sel.size})` : ""}`}
              </button>
            )}
            <a href={`${base}/ar-invoices/new`} style={{ ...btn(canApprove ? "secondary" : "primary"), textDecoration: "none" }}>+ New AR Invoice</a>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
          <button type="button" onClick={() => run({ ...f, waiting: !f.waiting })}
            style={{ ...styles.cardPadded, marginBottom: 0, padding: "0.9rem 1.25rem", textAlign: "left", cursor: "pointer",
              outline: f.waiting ? "2px solid var(--color-primary, #2BBCB3)" : "none" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" }}>
              Waiting for you{sapUser ? `(${sapUser})` : ""}
            </div>
            <div style={{ fontSize: "1.45rem", fontWeight: 800, marginTop: 4 }}>{waitingCount}</div>
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); run(); }}
          style={{ ...styles.cardPadded, display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", padding: "0.875rem 1.25rem", marginBottom: "1rem" }}>
          <select style={styles.input} value={f.brand} onChange={(e) => run({ ...f, brand: e.target.value })} title="Brand (U_ProdBrand)">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.code} value={b.code}>{b.code}{b.name ? ` – ${b.name}` : ""}</option>)}
          </select>
          <input style={{ ...styles.input, flex: "1 1 260px" }} placeholder="🔍 No., customer, reference, remarks, DocNum, AR. No"
            value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          <select style={styles.input} value={f.status} onChange={(e) => run({ ...f, status: e.target.value })}>
            <option value="all">All statuses</option>
            {Object.entries(AR_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input type="date" style={styles.input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="Posting date from" />
          <input type="date" style={styles.input} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} title="Posting date to" />
          <button type="submit" style={btn("primary", loading)} disabled={loading}>Search</button>
          <button type="button" style={btn("secondary")} onClick={() => run(blank)}>Clear</button>
          <button type="button" style={btn("secondary", loading)} disabled={loading} onClick={() => load(applied)}>↻ Refresh</button>
        </form>

        {error && <div style={{ ...styles.cardPadded, color: "#B91C1C" }}>{error}</div>}
        {approveMsg && (
          <div style={{ ...styles.cardPadded, padding: "0.8rem 1.1rem", fontSize: "0.8125rem", position: "relative" }}>
            <button type="button" onClick={() => setApproveMsg(null)} aria-label="Dismiss" style={{ position: "absolute", top: 8, right: 10, border: "none", background: "none", cursor: "pointer" }}>✕</button>
            {approveMsg.ok.length > 0 && <div style={{ color: "#065F46" }}><b>✅ Approved {approveMsg.ok.length}</b><ul style={{ margin: "0.25rem 0 0 1rem" }}>{approveMsg.ok.map((m) => <li key={m}>{m}</li>)}</ul></div>}
            {approveMsg.failed.length > 0 && <div style={{ color: "#B91C1C", marginTop: approveMsg.ok.length ? 6 : 0 }}><b>Not approved {approveMsg.failed.length}</b><ul style={{ margin: "0.25rem 0 0 1rem" }}>{approveMsg.failed.map((m) => <li key={m}>{m}</li>)}</ul></div>}
          </div>
        )}

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={loading} isEmpty={!loading && rows.length === 0} emptyLabel={f.waiting ? "Nothing is waiting for you" : "No AR Invoices yet"} />
          {!loading && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>{canApprove && (
                    <th style={{ ...th, width: 34 }}>
                      <input type="checkbox" title="Tick all waiting for you" disabled={waitingRows.length === 0}
                        checked={waitingRows.length > 0 && waitingRows.every((r) => sel.has(r.id))}
                        onChange={(e) => setSel(e.target.checked ? new Set(waitingRows.map((r) => r.id)) : new Set())} />
                    </th>
                  )}{["Brand", "DocNum", "AR. No", "Posting date", "Customer", "Reference / Remarks", "Total (incl. VAT)", "Status", "Created by"].map((h) =>
                    <th key={h} style={{ ...th, textAlign: h.startsWith("Total") ? "right" : "left" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => { window.location.href = `${base}/ar-invoices/${r.id}`; }}
                      title={`${r.doc_number ?? r.id}${r.template_name ? ` · ${r.template_name}` : ""}`}
                      style={{ cursor: "pointer", background: r.waitingForMe ? "#FFFBEB" : undefined }}>
                      {canApprove && (
                        <td style={td} onClick={(e) => e.stopPropagation()}>
                          {r.waitingForMe && <input type="checkbox" checked={sel.has(r.id)} title="Select for AR Approve"
                            onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />}
                        </td>
                      )}
                      <td style={{ ...td, fontWeight: 700 }}>{r.brand_code ?? "—"}</td>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{r.sap_doc_num ?? "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {r.sap_doc_no ?? "—"}
                        {r.source === "sap" && <span title="Approval request raised in the SAP client — approve / reject it here; change it in SAP" style={{ marginLeft: 6, fontSize: "0.65rem", fontWeight: 800, color: "#1D4ED8", background: "#DBEAFE", borderRadius: 4, padding: "1px 5px" }}>SAP</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{dmy(r.doc_date)}</td>
                      <td style={td}><div style={{ fontWeight: 600 }}>{r.sap_card_code}</div><div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)" }}>{r.card_name}</div></td>
                      <td style={{ ...td, maxWidth: 320 }}>
                        {r.num_at_card && <div style={{ fontWeight: 600 }}>{r.num_at_card}</div>}
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.comments}</div>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(r.doc_total)}</td>
                      <td style={td}>
                        <ArStatusBadge status={r.status} />
                        {r.waitingForMe && <div style={{ fontSize: "0.7rem", color: "#B45309", fontWeight: 700, marginTop: 2 }}>Your approval</div>}
                        {r.waitingForMe && canApprove && (
                          <button type="button" disabled={approving} onClick={(e) => { e.stopPropagation(); approve([r]); }}
                            style={{ ...btn("primary", approving), padding: "0.15rem 0.5rem", fontSize: "0.7rem", marginTop: 4 }}>AR Approve</button>
                        )}
                        {r.status === "failed" && r.last_error && <div title={r.last_error} style={{ fontSize: "0.7rem", color: "#B91C1C", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.last_error}</div>}
                      </td>
                      <td style={{ ...td, fontSize: "0.75rem" }}>{r.source === "sap" ? <>In SAP by <b>{r.posted_sap_user ?? "—"}</b></> : <>{r.created_by_label}{r.posted_sap_user ? <div style={{ color: "var(--text-tertiary)" }}>SAP {r.posted_sap_user}</div> : null}</>}</td>
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
