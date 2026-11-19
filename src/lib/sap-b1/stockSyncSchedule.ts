import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { syncInventoryStock } from "@/lib/sap-b1/sync";

export interface StockSyncScheduleRow {
  stock_sync_enabled: number;
  /** JSON list of time windows — see src/lib/stockSyncWindows.ts. Outside every window the stock sync doesn't run. */
  stock_sync_windows: unknown;
  stock_last_run_at: string | null;
  stock_last_run_status: "success" | "failed" | null;
  stock_last_run_summary: string | null;
}

/**
 * Inventory Stock sync on its OWN schedule, separate from the combined SAP
 * sync (runScheduledSync). It only refreshes `item_warehouse_stock` (the
 * storefront's stock gate + "available" qty), a single light SAP query, so it
 * can run every few minutes without re-running the heavy full sync. The
 * storefront keeps reading from MySQL, so product loading speed is unaffected.
 *
 * Run by the in-process poller in src/instrumentation.ts (time windows +
 * per-window interval set by root on the SAP Sync Config page) or by POST
 * /api/admin/settings/stock-sync-schedule/run-now.
 */
export async function runScheduledStockSync(): Promise<{ status: "success" | "failed"; summary: string }> {
  const companyId = getCompanyId();
  let status: "success" | "failed";
  let summary: string;
  try {
    const result = await syncInventoryStock();
    status = "success";
    summary = `✓ Inventory Stock: ${JSON.stringify(result)}`;
  } catch (error) {
    status = "failed";
    summary = `✗ Inventory Stock: ${error instanceof Error ? error.message : String(error)}`;
  }

  // Same per-company upsert as runScheduledSync — this company's row may not exist yet.
  await query(
    `INSERT INTO sync_schedule_settings (company_id, stock_last_run_at, stock_last_run_status, stock_last_run_summary)
     VALUES (?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE stock_last_run_at = NOW(), stock_last_run_status = VALUES(stock_last_run_status),
       stock_last_run_summary = VALUES(stock_last_run_summary)`,
    [companyId, status, summary]
  );

  return { status, summary };
}
