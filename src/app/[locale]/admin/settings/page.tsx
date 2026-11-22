"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { styles, btn, Section, Badge } from "../adminUi";
import { AutoApprovalPanel } from "../AutoApprovalPanel";
import { VN_TIME_ZONE } from "@/lib/vnTime";
import {
  validateStockSyncWindows,
  STOCK_SYNC_MIN_MINUTES,
  STOCK_SYNC_MAX_MINUTES,
  STOCK_SYNC_MAX_WINDOWS,
  type StockSyncWindow,
} from "@/lib/stockSyncWindows";

interface SyncSchedule {
  id: number;
  is_enabled: number;
  interval_hours: number;
  post_so_mode: "draft" | "sales_order";
  so_approval_required?: number;
  so_approval_from_date?: string | null;
  last_run_at: string | null;
  last_run_status: "success" | "partial" | "failed" | null;
  last_run_summary: string | null;
  updated_at: string;
}

interface StockSyncSchedule {
  stock_sync_enabled: number;
  stock_sync_windows: StockSyncWindow[];
  stock_last_run_at: string | null;
  stock_last_run_status: "success" | "failed" | null;
  stock_last_run_summary: string | null;
  stock_source: "sync" | "live";
  stock_live_cache_seconds: number;
  stock_live_refreshed_at: string | null;
  stock_live_shelf_refreshed_at: string | null;
  stock_live_last_status: "success" | "failed" | null;
  stock_live_last_summary: string | null;
}

// Keep in sync with LIVE_CACHE_MIN/MAX_SECONDS in src/lib/stock/liveStock.ts.
const LIVE_CACHE_MIN_SECONDS = 5;
const LIVE_CACHE_MAX_SECONDS = 300;


export default function SettingsPage() {
  const [schedule, setSchedule] = useState<SyncSchedule | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnabled, setIsEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const [postSoMode, setPostSoMode] = useState<"draft" | "sales_order">("draft");
  // Accountant (AR / Credit Control) approval of pushed Sales Orders.
  const [soApprovalRequired, setSoApprovalRequired] = useState(false);
  const [soApprovalFromDate, setSoApprovalFromDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");

  // Inventory Stock sync — its own schedule, separate from the combined one above.
  const [stockSchedule, setStockSchedule] = useState<StockSyncSchedule | null>(null);
  const [stockEnabled, setStockEnabled] = useState(false);
  const [stockWindows, setStockWindows] = useState<StockSyncWindow[]>([]);
  const [isStockSaving, setIsStockSaving] = useState(false);
  const [isStockRunning, setIsStockRunning] = useState(false);
  const [stockMessage, setStockMessage] = useState("");
  // Option 1 "sync" (scheduled) vs option 2 "live" (on demand from SAP).
  const [stockSource, setStockSource] = useState<"sync" | "live">("sync");
  const [liveCacheSeconds, setLiveCacheSeconds] = useState(30);
  const [isLiveRefreshing, setIsLiveRefreshing] = useState(false);

  const loadStock = useCallback(async () => {
    const res = await fetch("/api/admin/settings/stock-sync-schedule");
    const data = await res.json();
    if (data.schedule) {
      setStockSchedule(data.schedule);
      setStockEnabled(!!data.schedule.stock_sync_enabled);
      setStockWindows(data.schedule.stock_sync_windows ?? []);
      setStockSource(data.schedule.stock_source === "live" ? "live" : "sync");
      setLiveCacheSeconds(data.schedule.stock_live_cache_seconds ?? 30);
    }
  }, []);

  useEffect(() => {
    loadStock();
  }, [loadStock]);

  const saveStock = async () => {
    const windowsError = validateStockSyncWindows(stockWindows);
    if (windowsError) {
      setStockMessage(windowsError);
      return;
    }
    if (!Number.isInteger(liveCacheSeconds) || liveCacheSeconds < LIVE_CACHE_MIN_SECONDS || liveCacheSeconds > LIVE_CACHE_MAX_SECONDS) {
      setStockMessage(`Live cache must be ${LIVE_CACHE_MIN_SECONDS}–${LIVE_CACHE_MAX_SECONDS} seconds`);
      return;
    }
    setIsStockSaving(true);
    setStockMessage("");
    try {
      const res = await fetch("/api/admin/settings/stock-sync-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: stockEnabled, windows: stockWindows, stockSource, liveCacheSeconds }),
      });
      const data = await res.json();
      if (!res.ok) {
        // e.g. option 2 chosen but SAP couldn't be read: nothing saved, still option 1.
        if (data.schedule === undefined && stockSource === "live") setStockSource(stockSchedule?.stock_source ?? "sync");
        throw new Error([data.error, data.message].filter(Boolean).join(" — ") || "Failed to save");
      }
      setStockSchedule(data.schedule);
      setStockWindows(data.schedule?.stock_sync_windows ?? []);
      setStockMessage(data.note ? `Saved. ${data.note}` : "Saved.");
    } catch (err) {
      setStockMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsStockSaving(false);
    }
  };

  const runStockNow = async () => {
    setIsStockRunning(true);
    setStockMessage("");
    try {
      const res = await fetch("/api/admin/settings/stock-sync-schedule/run-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      setStockMessage(`Run finished: ${data.status}`);
      await loadStock();
    } catch (err) {
      setStockMessage(err instanceof Error ? err.message : "Stock sync run failed");
    } finally {
      setIsStockRunning(false);
    }
  };

  const refreshLiveNow = async () => {
    setIsLiveRefreshing(true);
    setStockMessage("");
    try {
      const res = await fetch("/api/admin/settings/stock-sync-schedule/live-refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.message].filter(Boolean).join(" — "));
      setStockMessage(data.summary || "Live stock refreshed.");
      await loadStock();
    } catch (err) {
      setStockMessage(err instanceof Error ? err.message : "Live stock refresh failed");
    } finally {
      setIsLiveRefreshing(false);
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch("/api/admin/settings/sync-schedule");
    const data = await res.json();
    if (data.schedule) {
      setSchedule(data.schedule);
      setIsEnabled(!!data.schedule.is_enabled);
      setIntervalHours(data.schedule.interval_hours);
      setPostSoMode(data.schedule.post_so_mode === "sales_order" ? "sales_order" : "draft");
      setSoApprovalRequired(!!data.schedule.so_approval_required);
      setSoApprovalFromDate(data.schedule.so_approval_from_date || "");
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
        body: JSON.stringify({ isEnabled, intervalHours, postSoMode, soApprovalFromDate: soApprovalFromDate || null }),
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
            <h1 style={styles.title}>SAP Sync Config</h1>
            <p style={styles.subtitle}>Root-only. Configure SAP sync schedule and order posting mode.</p>
          </div>
        </div>

        {/* ── Post SO Mode ──────────────────────────────────────────────── */}
        <Section title="Post SO Mode">
          <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1.25rem" }}>
            Controls how portal orders are pushed to SAP B1 when an admin clicks <strong>Post to SAP</strong>.
          </p>

          {isLoading ? (
            <div style={styles.empty}>Loading...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "520px" }}>
              {/* Draft Order option */}
              <label style={{
                display: "flex", alignItems: "flex-start", gap: "0.75rem",
                padding: "1rem", borderRadius: "var(--radius-lg, 8px)",
                border: `2px solid ${postSoMode === "draft" ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-200, #E2E8F0)"}`,
                background: postSoMode === "draft" ? "rgba(43,188,179,0.05)" : "var(--bg-primary, #fff)",
                cursor: "pointer", transition: "all 0.15s",
              }}>
                <input
                  type="radio"
                  name="postSoMode"
                  value="draft"
                  checked={postSoMode === "draft"}
                  onChange={() => setPostSoMode("draft")}
                  style={{ marginTop: "2px", cursor: "pointer", accentColor: "var(--color-primary, #2BBCB3)" }}
                />
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #0F172A)", marginBottom: "0.25rem" }}>
                    📋 Draft Order
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                    Pushes the portal order to SAP B1 as a <strong>Draft</strong>. A SAP user must then manually approve
                    the draft in SAP to convert it into a confirmed Sales Order. <em>(Current default behaviour.)</em>
                  </div>
                </div>
              </label>

              {/* Sales Order option */}
              <label style={{
                display: "flex", alignItems: "flex-start", gap: "0.75rem",
                padding: "1rem", borderRadius: "var(--radius-lg, 8px)",
                border: `2px solid ${postSoMode === "sales_order" ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-200, #E2E8F0)"}`,
                background: postSoMode === "sales_order" ? "rgba(43,188,179,0.05)" : "var(--bg-primary, #fff)",
                cursor: "pointer", transition: "all 0.15s",
              }}>
                <input
                  type="radio"
                  name="postSoMode"
                  value="sales_order"
                  checked={postSoMode === "sales_order"}
                  onChange={() => setPostSoMode("sales_order")}
                  style={{ marginTop: "2px", cursor: "pointer", accentColor: "var(--color-primary, #2BBCB3)" }}
                />
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #0F172A)", marginBottom: "0.25rem" }}>
                    ✅ Sales Order
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                    Pushes the portal order directly to SAP B1 as a confirmed <strong>Sales Order</strong> — no manual
                    approval step required. The order status in the portal will be set to <em>Approved</em> immediately.
                  </div>
                </div>
              </label>

              {/* SO approval is SAP's own Approval Procedure — information only, nothing to switch */}
              <div style={{
                padding: "1rem", borderRadius: "var(--radius-lg, 8px)", border: "1px dashed var(--color-gray-200, #E2E8F0)",
                opacity: postSoMode === "sales_order" ? 1 : 0.5,
              }}>
                <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #0F172A)", marginBottom: "0.25rem" }}>
                  💳 Accountant approval (AR / Credit Control) — follows SAP
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                  Every pushed Sales Order is created with <strong>U_DataStatus = I</strong> and then updated to <strong>C</strong>.
                  When an SAP Approval Template applies, SAP keeps it at I and opens an approval request; the stage&apos;s
                  authorizers (Accountants, by their SAP user) approve it in SO Approval (/account) or in SAP&apos;s Approval
                  Status Report, and SAP then applies C. Admin / Sales users push as their own SAP user (My Profile → SAP account, e.g. sa01),
                  which must be an originator of the templates; Super Admin pushes as the portal&apos;s integration user.
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.875rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary, #0F172A)" }}>📅 Approve SO from date</span>
                  <input type="date" value={soApprovalFromDate} onChange={(e) => setSoApprovalFromDate(e.target.value)}
                    style={{ padding: "0.4rem 0.6rem", border: "1px solid var(--color-gray-200, #E2E8F0)", borderRadius: 6, fontSize: "0.8125rem" }} />
                  {soApprovalFromDate && (
                    <button type="button" onClick={() => setSoApprovalFromDate("")}
                      style={{ border: "none", background: "none", color: "var(--color-primary, #2BBCB3)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700 }}>
                      Clear
                    </button>
                  )}
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #64748B)" }}>
                    SO Approval lists only Sales Orders with DocDate on or after this date{soApprovalFromDate ? "" : " (empty = all)"}. Saved with the settings below.
                  </span>
                </label>
              </div>

              <div style={{ paddingTop: "0.5rem" }}>
                <button onClick={save} disabled={isSaving} style={btn("primary", isSaving)}>
                  {isSaving ? "Saving..." : "Save"}
                </button>
                {message && (
                  <span style={{ marginLeft: "1rem", fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                    {message}
                  </span>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* ── SAP Sync Schedule ──────────────────────────────────────────── */}
        <Section title="SAP Sync Schedule">
          <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
            One combined run covers: Customer Group, Item Group, SAP Customers, Items, Warehouse, Price List, Channel
            Price List (every price list), Period Discount (every price list), Contract Discount, Promotion Discount,
            and SAP Order Status. Inventory Stock has its own schedule below.
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
                      {new Date(schedule.last_run_at).toLocaleString(undefined, { timeZone: VN_TIME_ZONE })} — {schedule.last_run_status}
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

        {/* ── Inventory Stock: how the storefront gets Available qty ─────── */}
        <Section title="Inventory Stock Sync Schedule">
          <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
            How the customer storefront gets <strong>Available quantity</strong> (it hides out-of-stock items and
            shows the available qty). Separate from the schedule above.
          </p>

          {isLoading ? (
            <div style={styles.empty}>Loading...</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "640px", marginBottom: "1.25rem" }}>
                {([
                  ["sync", "Option 1 — Scheduled sync", "Copies stock from SAP into the portal on the time windows below (e.g. every 10 / 30 minutes). Fastest for customers; stock is as fresh as the last run."],
                  ["live", "Option 2 — Real-time from SAP", "Reads stock from SAP when customers browse, with the same query as Admin → Inventory (committed = open SO + transfer requests + production orders). One SAP read is shared by all customers for the cache time below; nothing is read while nobody browses. The scheduled stock sync is disabled."],
                ] as const).map(([value, title, desc]) => (
                  <label key={value} style={{
                    display: "flex", alignItems: "flex-start", gap: "0.75rem", padding: "0.875rem 1rem",
                    borderRadius: "var(--radius-lg, 8px)", cursor: "pointer",
                    border: `2px solid ${stockSource === value ? "var(--color-primary, #2BBCB3)" : "var(--color-gray-200, #E2E8F0)"}`,
                    background: stockSource === value ? "rgba(43,188,179,0.05)" : "var(--bg-primary, #fff)",
                  }}>
                    <input
                      type="radio"
                      name="stockSource"
                      value={value}
                      checked={stockSource === value}
                      onChange={() => setStockSource(value)}
                      style={{ marginTop: "2px", cursor: "pointer", accentColor: "var(--color-primary, #2BBCB3)" }}
                    />
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #0F172A)", marginBottom: "0.25rem" }}>{title}</div>
                      <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Option 2 settings */}
              {stockSource === "live" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "640px", marginBottom: "1.25rem" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem", fontSize: "0.8125rem" }}>
                    Share one SAP read for (seconds, {LIVE_CACHE_MIN_SECONDS}–{LIVE_CACHE_MAX_SECONDS})
                    <input
                      type="number"
                      min={LIVE_CACHE_MIN_SECONDS}
                      max={LIVE_CACHE_MAX_SECONDS}
                      value={liveCacheSeconds}
                      onChange={(e) => setLiveCacheSeconds(Math.round(Number(e.target.value) || 0))}
                      style={{ ...styles.input, width: "120px" }}
                    />
                  </label>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>
                    Stock is at most this old. Shelf-life % (batch dates) is refreshed in the background every 30 minutes.
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                    Last live read:{" "}
                    {stockSchedule?.stock_live_refreshed_at
                      ? `${new Date(stockSchedule.stock_live_refreshed_at).toLocaleString(undefined, { timeZone: VN_TIME_ZONE })} — ${stockSchedule.stock_live_last_status ?? ""}`
                      : "never"}
                    {stockSchedule?.stock_live_last_summary && (
                      <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>{stockSchedule.stock_live_last_summary}</div>
                    )}
                  </div>
                  <div>
                    <button onClick={refreshLiveNow} disabled={isLiveRefreshing} style={btn("secondary", isLiveRefreshing)}>
                      {isLiveRefreshing ? "Refreshing (up to ~15 s)..." : "Refresh live stock now"}
                    </button>
                  </div>
                </div>
              )}

              {/* Option 1 settings — disabled entirely while option 2 is selected */}
              <fieldset
                disabled={stockSource === "live"}
                style={{ border: "none", padding: 0, margin: 0, opacity: stockSource === "live" ? 0.45 : 1 }}
              >
              <div style={{ fontSize: "0.8125rem", fontWeight: 700, marginBottom: "0.5rem" }}>
                Option 1 — stock-sync schedule{stockSource === "live" ? " (disabled: option 2 is selected)" : ""}
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "0.75rem" }}>
                Time windows are Vietnam time, each with its own interval; <strong>outside every window the stock sync
                does not run</strong>, to keep load off SAP. End is exclusive; use 24:00 for end of day, and an end
                earlier than the start crosses midnight.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "420px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={stockEnabled}
                    onChange={(e) => setStockEnabled(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  Enable automated stock sync
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8125rem" }}>
                  <div style={{ fontWeight: 600 }}>Time windows</div>
                  {stockWindows.length === 0 && (
                    <div style={{ color: "var(--text-tertiary, #94A3B8)" }}>
                      No time window — the stock sync will not run automatically.
                    </div>
                  )}
                  {stockWindows.map((w, i) => {
                    const update = (patch: Partial<StockSyncWindow>) =>
                      setStockWindows((ws) => ws.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="HH:MM"
                          value={w.start}
                          onChange={(e) => update({ start: e.target.value.trim() })}
                          style={{ ...styles.input, width: "80px" }}
                          aria-label={`Window ${i + 1} start`}
                        />
                        <span>to</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="HH:MM"
                          value={w.end}
                          onChange={(e) => update({ end: e.target.value.trim() })}
                          style={{ ...styles.input, width: "80px" }}
                          aria-label={`Window ${i + 1} end (HH:MM, 24:00 = end of day)`}
                        />
                        <span>every</span>
                        <input
                          type="number"
                          min={STOCK_SYNC_MIN_MINUTES}
                          max={STOCK_SYNC_MAX_MINUTES}
                          value={w.intervalMinutes}
                          onChange={(e) => update({ intervalMinutes: Math.round(Number(e.target.value) || 0) })}
                          style={{ ...styles.input, width: "80px" }}
                          aria-label={`Window ${i + 1} interval in minutes`}
                        />
                        <span>min</span>
                        <button
                          type="button"
                          onClick={() => setStockWindows((ws) => ws.filter((_, j) => j !== i))}
                          style={btn("secondary", false)}
                          aria-label={`Remove window ${i + 1}`}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  {stockWindows.length < STOCK_SYNC_MAX_WINDOWS && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setStockWindows((ws) => [...ws, { start: "08:00", end: "17:00", intervalMinutes: 10 }])}
                        style={btn("secondary", false)}
                      >
                        + Add time window
                      </button>
                    </div>
                  )}
                  <div style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: "0.75rem" }}>
                    Interval {STOCK_SYNC_MIN_MINUTES}–{STOCK_SYNC_MAX_MINUTES} minutes. Windows must not overlap.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button onClick={runStockNow} disabled={isStockRunning || stockSource === "live"} style={btn("secondary", isStockRunning || stockSource === "live")}>
                    {isStockRunning ? "Running..." : "Run stock sync now"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)" }}>
                <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.5rem" }}>Last run</h3>
                {stockSchedule?.stock_last_run_at ? (
                  <>
                    <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>
                      {new Date(stockSchedule.stock_last_run_at).toLocaleString(undefined, { timeZone: VN_TIME_ZONE })} — {stockSchedule.stock_last_run_status}
                    </p>
                    <pre style={{
                      marginTop: "0.5rem", padding: "0.75rem", background: "var(--bg-secondary, #F8FAFC)",
                      borderRadius: "var(--radius-lg, 8px)", fontSize: "0.75rem", whiteSpace: "pre-wrap",
                      border: "1px solid var(--color-gray-200, #E2E8F0)",
                    }}>
                      {stockSchedule.stock_last_run_summary}
                    </pre>
                  </>
                ) : (
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)" }}>Never run yet.</p>
                )}
              </div>
              </fieldset>

              {/* One Save for the option choice, option 2's cache time and option 1's schedule. */}
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid var(--color-gray-200, #E2E8F0)" }}>
                <button onClick={saveStock} disabled={isStockSaving} style={btn("primary", isStockSaving)}>
                  {isStockSaving ? "Saving..." : "Save"}
                </button>
                {stockMessage && <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #64748B)" }}>{stockMessage}</span>}
              </div>
            </>
          )}
        </Section>

        {/* ── Auto SO Approval (each Accountant's own) ───────────────────── */}
        <Section title="Auto SO Approval — Accountants">
          <AccountantsAutoApproval />
        </Section>
      </div>
    </div>
  );
}

interface AccountantAutoRow {
  adminUserId: number; userid: string | null; fullName: string | null; isActive: boolean; roleName: string | null;
  sapUserCode: string | null; hasSapPassword: boolean; enabled: boolean; windows: StockSyncWindow[];
  lastRunAt: string | null; lastRunStatus: string | null; lastRunSummary: string | null;
}

/** Every Accountant's Auto SO Approval setting; System Admin can open and change any of them. */
function AccountantsAutoApproval() {
  const [rows, setRows] = useState<AccountantAutoRow[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/settings/auto-approval", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      setLoadError(null);
      setRows(j.accountants ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
      setRows((prev) => prev ?? []);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loadError) {
    return (
      <div style={{ ...styles.empty, color: "var(--color-error, #DC2626)" }}>
        Couldn&apos;t load the Accountants&apos; settings: {loadError}{" "}
        <button type="button" style={btn("secondary", false)} onClick={() => void load()}>Retry</button>
      </div>
    );
  }
  if (!rows) return <div style={styles.empty}>Loading...</div>;
  if (rows.length === 0) return <div style={styles.empty}>No Accountant users (role kind Accountant).</div>;
  return (
    <div>
      <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary, #94A3B8)", marginBottom: "1rem" }}>
        Each Accountant sets their own on Credit Control → Auto SO Approval: on their time windows the SOs waiting for
        their approval whose 6 checks all pass are approved as their SAP user; the rest stay for manual review, with the reason logged.
        You can change anyone&apos;s here — a run still covers only that Accountant&apos;s own queue.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead><tr>
            {["Accountant", "Role", "SAP user", "Auto SO Approval", "Time windows", "Last run", ""].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.adminUserId}>
                <tr style={{ opacity: r.isActive ? 1 : 0.5 }}>
                  <td style={styles.td}><strong>{r.userid}</strong>{r.fullName ? ` — ${r.fullName}` : ""}{!r.isActive && " (inactive)"}</td>
                  <td style={styles.td}>{r.roleName}</td>
                  <td style={styles.td}>{r.sapUserCode ?? "—"}{r.sapUserCode && !r.hasSapPassword && <span style={{ color: "#B45309" }}> (no password)</span>}</td>
                  <td style={styles.td}><Badge label={r.enabled ? "On" : "Off"} tone={r.enabled ? "success" : "neutral"} /></td>
                  <td style={{ ...styles.td, whiteSpace: "normal" }}>
                    {r.windows.length ? r.windows.map((w) => `${w.start}–${w.end} every ${w.intervalMinutes} min`).join(" · ") : "—"}
                  </td>
                  <td style={{ ...styles.td, whiteSpace: "normal", minWidth: 200 }}>
                    {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString(undefined, { timeZone: VN_TIME_ZONE }) : "never"}
                    {r.lastRunStatus && <> · {r.lastRunStatus}</>}
                    {r.lastRunSummary && <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #94A3B8)" }}>{r.lastRunSummary}</div>}
                  </td>
                  <td style={styles.td}>
                    <button style={btn("secondary", false)} onClick={() => { if (openId === r.adminUserId) void load(); setOpenId(openId === r.adminUserId ? null : r.adminUserId); }}>
                      {openId === r.adminUserId ? "Close" : "Manage"}
                    </button>
                  </td>
                </tr>
                {openId === r.adminUserId && (
                  <tr>
                    <td colSpan={7} style={{ ...styles.td, whiteSpace: "normal", background: "var(--bg-secondary, #F8FAFC)", padding: "1rem" }}>
                      <AutoApprovalPanel apiUrl={`/api/admin/settings/auto-approval/${r.adminUserId}`} who={r.userid ?? `user ${r.adminUserId}`} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
