/**
 * Runs once when a new server instance starts (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 * Replaces scripts/daily-sync.mjs's role (an external script registered in
 * Windows Task Scheduler that logs in over HTTP) with an in-process poller:
 * every minute, check each SAP sync group's schedule (sync_group_schedule —
 * Master Data, Price List, Discount, Promotion, SO status; edited on the Admin
 * Settings page, root-only) and run the groups that are enabled and due.
 *
 * A SECOND, independent poller runs the Inventory Stock sync on its own
 * schedule: root-set time windows (Vietnam time), each with its own
 * interval in minutes; outside every window it doesn't run at all
 * (stock_sync_* columns, same root-only settings page) — see runScheduledStockSync. It has its own `running` flag, so a
 * long full sync never delays a stock refresh (and vice versa); concurrent
 * writes to item_warehouse_stock are serialized by syncInventoryStock's own
 * table lock.
 *
 * A THIRD poller runs Auto SO Approval: each Accountant who enabled it has
 * their own time windows + intervals (so_auto_approval_settings, set on
 * Credit Control → Auto SO Approval or by System Admin on Settings); due
 * ones run one after another — see pollAutoApprovals. Own `running` flag.
 *
 * A FOURTH poller notifies Accountants of SAP approval requests raised in
 * the SAP client (pollSapApprovalRequests — staff inbox bell).
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
      // Each sync group (Master Data / Price List / Discount / Promotion / SO status)
      // has its own interval — run the ones that are due, one after another.
      const { dueSyncGroups, runScheduledSync } = await import("@/lib/sap-b1/scheduledSync");
      const due = await dueSyncGroups();
      if (!due.length) return;

      console.log(`[Scheduler] Running scheduled SAP sync: ${due.join(", ")}...`);
      const result = await runScheduledSync(due);
      console.log(`[Scheduler] Scheduled SAP sync (${due.join(", ")}) finished: ${result.status}`);
    } catch (error) {
      console.error("[Scheduler] Scheduled sync poll failed:", error);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);

  let stockRunning = false;
  setInterval(async () => {
    if (stockRunning) return;
    stockRunning = true;
    try {
      const { queryOne } = await import("@/lib/db/connection");
      const { getCompanyId } = await import("@/lib/config");
      const { parseStockSyncWindows, findActiveStockSyncWindow, vnMinuteOfDay } = await import("@/lib/stockSyncWindows");
      const row = await queryOne<{
        stock_sync_enabled: number;
        stock_sync_windows: unknown;
        stock_last_run_at: string | null;
        stock_source: string | null;
      }>(
        "SELECT stock_sync_enabled, stock_sync_windows, stock_last_run_at, stock_source FROM sync_schedule_settings WHERE company_id = ?",
        [getCompanyId()]
      );

      // Option 2 (live from SAP) replaces the scheduled stock sync entirely.
      if (!row || !row.stock_sync_enabled || row.stock_source === "live") return;

      // Outside every configured window (or none configured) = don't run.
      const active = findActiveStockSyncWindow(parseStockSyncWindows(row.stock_sync_windows), vnMinuteOfDay());
      if (!active) return;

      const dueAt = row.stock_last_run_at
        ? new Date(row.stock_last_run_at).getTime() + active.intervalMinutes * 60 * 1000
        : 0;
      // 30s slack: the poll fires every 60s, so without it a 10-minute
      // interval would drift to ~11 minutes between runs.
      if (Date.now() < dueAt - 30 * 1000) return;

      const { runScheduledStockSync } = await import("@/lib/sap-b1/stockSyncSchedule");
      const result = await runScheduledStockSync();
      if (result.status !== "success") console.error(`[Scheduler] Stock sync failed: ${result.summary}`);
    } catch (error) {
      console.error("[Scheduler] Stock sync poll failed:", error);
    } finally {
      stockRunning = false;
    }
  }, POLL_INTERVAL_MS);

  // SAP approval requests raised in the SAP client → notify their approvers (staff inbox).
  let notifPollRunning = false;
  let lastToDoSyncAll = 0;
  setInterval(async () => {
    if (notifPollRunning) return;
    notifPollRunning = true;
    try {
      const { pollSapApprovalRequests } = await import("@/lib/staffNotifications");
      await pollSapApprovalRequests();
      // AR Invoice approval requests raised in the SAP client → AR Invoice list (+ bell), from Settings → "Sync SO AR from".
      const { importSapArRequests } = await import("@/lib/arInvoice/sapImport");
      await importSapArRequests({ limit: 30 }).catch((e) => console.error("[Scheduler] SAP AR request import failed:", e));
      // Every 5 minutes: each Accountant's "to approve" on the bell = their live Pending queue.
      if (Date.now() - lastToDoSyncAll >= 5 * 60 * 1000) {
        lastToDoSyncAll = Date.now();
        const { syncAllApprovalToDo } = await import("@/lib/soApproval/service");
        await syncAllApprovalToDo();
      }
    } catch (error) {
      console.error("[Scheduler] SAP approval request notification poll failed:", error);
    } finally {
      notifPollRunning = false;
    }
  }, POLL_INTERVAL_MS);

  let autoApprovalRunning = false;
  setInterval(async () => {
    if (autoApprovalRunning) return;
    autoApprovalRunning = true;
    try {
      const { pollAutoApprovals } = await import("@/lib/soApproval/autoApproval");
      await pollAutoApprovals();
    } catch (error) {
      console.error("[Scheduler] Auto SO Approval poll failed:", error);
    } finally {
      autoApprovalRunning = false;
    }
  }, POLL_INTERVAL_MS);
}
