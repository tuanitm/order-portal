"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { styles, btn, Badge, LoadingOrEmpty } from "../adminUi";
import { useAdminSession } from "../layout";

interface AuditLogRow {
  id: number;
  actor_type: "admin" | "customer";
  actor_id: number | null;
  actor_label: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

const inputStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  borderRadius: "var(--radius-md, 6px)",
  border: "1px solid var(--color-gray-200, #E2E8F0)",
  background: "var(--bg-primary, #fff)",
  color: "var(--text-primary, #0F172A)",
  fontSize: "0.8125rem",
  outline: "none",
  minWidth: "160px",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** "login_failed" -> "Login Failed" */
function formatAction(action: string): string {
  return action.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function isFailureAction(action: string): boolean {
  return /failed|reject|delete|cancel/.test(action);
}

export default function AuditLogsPage() {
  const session = useAdminSession();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Belt-and-suspenders on top of the sidebar nav already hiding this link
  // for non-root admins (../layout.tsx's rootOnly filter) and the API route
  // itself requiring the "audit-logs" permission (root-only — see
  // ROOT_ONLY_PERMISSIONS in adminSession.ts): a non-root admin who
  // navigates straight to this URL gets a clear "forbidden" message
  // instead of a misleadingly empty table (the API would 403, which this
  // component would otherwise just render as zero results).
  const [forbidden, setForbidden] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p: number, at: string, a: string, s: string, df: string, dt: string) => {
    setIsLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (at) params.set("actorType", at);
    if (a) params.set("action", a);
    if (s) params.set("search", s);
    if (df) params.set("dateFrom", df);
    if (dt) params.set("dateTo", dt);
    const res = await fetch(`/api/admin/audit-logs?${params}`);
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      setIsLoading(false);
      return;
    }
    const data = await res.json();
    setLogs(data.logs || []);
    setTotal(data.total || 0);
    setActions(data.actions || []);
    setIsLoading(false);
  }, [limit]);

  // actorType/action/date pills reload immediately; the text search is debounced.
  // Skipped entirely once the session resolves as non-root — no point
  // round-tripping to an API call that's guaranteed to 403.
  useEffect(() => {
    if (session && !session.isSuperAdmin) {
      setForbidden(true);
      setIsLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      load(1, actorType, action, search, dateFrom, dateTo);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorType, action, search, dateFrom, dateTo, session]);

  const totalPages = Math.ceil(total / limit) || 1;
  const goToPage = (p: number) => {
    setPage(p);
    load(p, actorType, action, search, dateFrom, dateTo);
  };

  if (forbidden) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.header}>
            <div>
              <h1 style={styles.title}>Audit Logs</h1>
            </div>
          </div>
          <div style={{ ...styles.cardPadded, maxWidth: "480px" }}>
            <p style={{ fontSize: "0.875rem", color: "#991B1B" }}>
              🔒 Access restricted to Super Admin. If you believe this is a mistake, ask a Super Admin to review your account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Audit Logs</h1>
            <p style={styles.subtitle}>
              Login/logout (success and failure) and key business actions for both admin and customer
              accounts — read-only, append-only trail. Super Admin only.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <select style={inputStyle} value={actorType} onChange={(e) => setActorType(e.target.value)}>
            <option value="">All actor types</option>
            <option value="admin">Admin</option>
            <option value="customer">Customer</option>
          </select>
          <select style={inputStyle} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{formatAction(a)}</option>
            ))}
          </select>
          <input
            type="text" style={inputStyle} placeholder="Search by email/name..."
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <input
            type="date" style={inputStyle} value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)} title="From date"
          />
          <input
            type="date" style={inputStyle} value={dateTo}
            onChange={(e) => setDateTo(e.target.value)} title="To date"
          />
          {(actorType || action || search || dateFrom || dateTo) && (
            <button
              style={btn("secondary")}
              onClick={() => { setActorType(""); setAction(""); setSearch(""); setDateFrom(""); setDateTo(""); }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div style={styles.card}>
          <LoadingOrEmpty isLoading={isLoading} isEmpty={!isLoading && logs.length === 0} emptyLabel="No audit log entries match these filters" />
          {!isLoading && logs.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Time</th>
                    <th style={styles.th}>Actor</th>
                    <th style={styles.th}>Action</th>
                    <th style={styles.th}>Entity</th>
                    <th style={styles.th}>IP Address</th>
                    <th style={styles.th}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ ...styles.td, whiteSpace: "nowrap", fontSize: "0.75rem" }}>{formatDateTime(log.created_at)}</td>
                      <td style={styles.td}>
                        <div>{log.actor_label || <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>unknown</em>}</div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary, #94A3B8)" }}>
                          {log.actor_type}{log.actor_id ? ` #${log.actor_id}` : ""}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <Badge label={formatAction(log.action)} tone={isFailureAction(log.action) ? "error" : "success"} />
                      </td>
                      <td style={{ ...styles.td, fontSize: "0.75rem" }}>
                        {log.entity_type ? `${log.entity_type} #${log.entity_id}` : <em style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</em>}
                      </td>
                      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.75rem" }}>{log.ip_address || "—"}</td>
                      <td style={styles.td}>
                        {log.details ? (
                          <button
                            onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                            style={{ fontSize: "0.75rem", color: "var(--color-primary, #2563EB)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                          >
                            {expandedId === log.id ? "Hide" : "View"}
                          </button>
                        ) : <em style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>—</em>}
                        {expandedId === log.id && log.details && (
                          <pre style={{
                            marginTop: "0.375rem", fontSize: "0.7rem", background: "var(--bg-secondary, #F8FAFC)",
                            padding: "0.5rem", borderRadius: "var(--radius-md, 6px)", maxWidth: "360px", overflowX: "auto",
                          }}>
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.75rem", marginTop: "1.5rem" }}>
            <button disabled={page <= 1} onClick={() => goToPage(page - 1)} style={btn("secondary", page <= 1)}>← Prev</button>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>Page {page} of {totalPages} ({total} total)</span>
            <button disabled={page >= totalPages} onClick={() => goToPage(page + 1)} style={btn("secondary", page >= totalPages)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
