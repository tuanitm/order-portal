"use client";

import { useState, useEffect, useCallback } from "react";
import { styles, btn, Section } from "../adminUi";

interface SyncSchedule {
  id: number;
  is_enabled: number;
  interval_hours: number;
  last_run_at: string | null;
  last_run_status: "success" | "partial" | "failed" | null;
  last_run_summary: string | null;
  updated_at: string;
}

export default function SettingsPage() {
  const [schedule, setSchedule] = useState<SyncSchedule | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnabled, setIsEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/settings/sync-schedule");
    const data = await res.json();
    if (data.schedule) {
      setSchedule(data.schedule);
      setIsEnabled(!!data.schedule.is_enabled);
      setIntervalHours(data.schedule.interval_hours);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setIsSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings/sync-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled, intervalHours }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSchedule(data.schedule);
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const runNow = async () => {
    setIsRunning(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings/sync-schedule/run-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      setMessage(`Run finished: ${data.status}`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync run failed");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Settings</h1>
            <p style={styles.subtitle}>Root-only. Configure the automated SAP sync schedule.</p>
          </div>
        </div>

        <Section title="SAP Sync Schedule">
          <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
            One combined run covers: Customer Group, Item Group, SAP Customers, Items, Warehouse, Price List, Channel
            Price List (every price list), Period Discount (every price list), Contract Discount, and Promotion
            Discount.
          </p>

          {isLoading ? (
            <div style={styles.empty}>Loading...</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "420px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => setIsEnabled(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  Enable automated sync
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem", fontSize: "0.8125rem" }}>
                  Run every (hours)
                  <input
                    type="number"
                    min={1}
                    value={intervalHours}
                    onChange={(e) => setIntervalHours(Math.max(1, Number(e.target.value) || 1))}
                    style={{ ...styles.input, width: "120px" }}
                  />
                </label>

                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button onClick={save} disabled={isSaving} style={btn("primary", isSaving)}>
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={runNow} disabled={isRunning} style={btn("secondary", isRunning)}>
                    {isRunning ? "Running..." : "Run now"}
                  </button>
                </div>

                {message && <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>{message}</p>}
              </div>

              <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)" }}>
                <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.5rem" }}>Last run</h3>
                {schedule?.last_run_at ? (
                  <>
                    <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                      {new Date(schedule.last_run_at).toLocaleString()} — {schedule.last_run_status}
                    </p>
                    <pre style={{
                      marginTop: "0.5rem", padding: "0.75rem", background: "var(--bg-secondary, #F8FAFC)",
                      borderRadius: "var(--radius-lg, 8px)", fontSize: "0.75rem", whiteSpace: "pre-wrap",
                      border: "1px solid var(--color-gray-200, #E2E8F0)",
                    }}>
                      {schedule.last_run_summary}
                    </pre>
                  </>
                ) : (
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>Never run yet.</p>
                )}
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
