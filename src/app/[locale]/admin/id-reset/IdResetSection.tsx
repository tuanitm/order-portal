"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, Section, Badge } from "../adminUi";

interface TablePreview {
  table: string;
  rows: number;
  maxId: number;
  nextAutoIncrement: number | null;
  idType: string;
  rangeUsedPct: number;
  method: "swap" | "in_place";
  children: { table: string; column: string; rows: number }[];
  busy: boolean;
}

interface ResetResult {
  table: string;
  rows: number;
  oldMaxId: number;
  newMaxId: number;
  childrenUpdated: { table: string; column: string; rows: number }[];
  ms: number;
}

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString());

/**
 * "Reset the Id": renumbers the ids of the SAP-sync and group tables back to
 * 1..N (see src/lib/db/idReset.ts for which tables and why only those).
 */
export default function IdResetSection() {
  const [tables, setTables] = useState<TablePreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/id-reset");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setTables(data.tables);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to load", isError: true });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reset = async (t: TablePreview) => {
    const childNote = t.children.length
      ? `\n\nLinked rows in ${t.children.map((c) => c.table).join(", ")} are updated in the same step. ` +
        "Other admins should reload any open admin page that edits groups afterwards."
      : "";
    const ok = confirm(
      `Reset the ids of "${t.table}"?\n\n${fmt(t.rows)} rows will be renumbered 1 to ${fmt(t.rows)} ` +
      `(highest id now ${fmt(t.maxId)}). Nothing else about the rows changes.${childNote}`
    );
    if (!ok) return;

    setResetting(t.table);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/id-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: t.table }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      const r: ResetResult = data.result;
      const children = r.childrenUpdated.filter((c) => c.rows > 0).map((c) => `${fmt(c.rows)} in ${c.table}`).join(", ");
      setMessage({
        text: `${r.table}: highest id ${fmt(r.oldMaxId)} → ${fmt(r.newMaxId)} (${fmt(r.rows)} rows` +
          `${children ? `; also updated ${children}` : ""}) in ${(r.ms / 1000).toFixed(1)} s.`,
        isError: false,
      });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Reset failed", isError: true });
    } finally {
      setResetting(null);
      await load();
    }
  };

  return (
    <Section title="Tables">
      <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem", maxWidth: "760px" }}>
        Syncs replace these tables&apos; rows again and again, which pushes their ids ever higher. A reset renumbers
        the rows 1, 2, 3 … in their current order, and updates every row in other tables that points to them. Users,
        orders and audit logs are never renumbered: their ids are also kept in logins, order links and notifications.
        While a sync is working on a table its reset is refused; try again once the sync has finished.
      </p>

      {isLoading && tables.length === 0 ? (
        <div style={styles.empty}>Loading...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Table</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Rows</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Highest id</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Id range used</th>
                <th style={styles.th}>Linked tables</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                const compact = t.maxId <= t.rows;
                const tone = t.rangeUsedPct >= 50 ? "error" : t.rangeUsedPct >= 10 ? "warning" : "neutral";
                return (
                  <tr key={t.table}>
                    <td style={styles.td}>
                      <code>{t.table}</code>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{t.idType}</div>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{fmt(t.rows)}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{fmt(t.maxId)}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      <Badge label={`${t.rangeUsedPct}%`} tone={tone} />
                    </td>
                    <td style={{ ...styles.td, fontSize: "0.75rem" }}>
                      {t.children.length
                        ? t.children.map((c) => `${c.table} (${fmt(c.rows)})`).join(", ")
                        : <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>none</span>}
                    </td>
                    <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                      {t.busy ? (
                        <Badge label="Sync running" tone="warning" />
                      ) : (
                        <button
                          onClick={() => reset(t)}
                          disabled={resetting !== null || compact}
                          title={compact ? "Ids are already 1 to " + fmt(t.rows) : undefined}
                          style={btn("danger", resetting !== null || compact)}
                        >
                          {resetting === t.table ? "Resetting..." : compact ? "Already compact" : "Reset ids"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {message && (
        <p style={{ marginTop: "1rem", fontSize: "0.8125rem", color: message.isError ? "#DC2626" : "var(--text-secondary, #64748B)" }}>
          {message.text}
        </p>
      )}
    </Section>
  );
}
