/**
 * Runs once when a new server instance starts (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 * Replaces scripts/daily-sync.mjs's role (an external script registered in
 * Windows Task Scheduler that logs in over HTTP) with an in-process poller:
 * every minute, check sync_schedule_settings (edited on the Admin Settings
 * page, root-only) and run runScheduledSync() if it's enabled and enough
 * time has passed since the last run.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const globalForScheduler = globalThis as typeof globalThis & {
    __syncSchedulerStarted?: boolean;
  };
  if (globalForScheduler.__syncSchedulerStarted) return;
  globalForScheduler.__syncSchedulerStarted = true;

  const POLL_INTERVAL_MS = 60 * 1000;
  let running = false;

  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { queryOne } = await import("@/lib/db/connection");
      const row = await queryOne<{
        is_enabled: number;
        interval_hours: number;
        last_run_at: string | null;
      }>("SELECT is_enabled, interval_hours, last_run_at FROM sync_schedule_settings WHERE id = 1");

      if (!row || !row.is_enabled) return;

      const dueAt = row.last_run_at
        ? new Date(row.last_run_at).getTime() + row.interval_hours * 60 * 60 * 1000
        : 0;
      if (Date.now() < dueAt) return;

      const { runScheduledSync } = await import("@/lib/sap-b1/scheduledSync");
      console.log("[Scheduler] Running scheduled SAP sync...");
      const result = await runScheduledSync();
      console.log(`[Scheduler] Scheduled SAP sync finished: ${result.status}`);
    } catch (error) {
      console.error("[Scheduler] Scheduled sync poll failed:", error);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);
}
