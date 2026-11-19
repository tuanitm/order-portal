import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryOne, query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { audited } from "@/lib/auditLog";
import type { StockSyncScheduleRow } from "@/lib/sap-b1/stockSyncSchedule";
import { validateStockSyncWindows, parseStockSyncWindows, type StockSyncWindow } from "@/lib/stockSyncWindows";
import {
  LIVE_CACHE_MIN_SECONDS, LIVE_CACHE_MAX_SECONDS, invalidateStockSettings, getStockSettings,
  refreshLiveStock, refreshLiveShelfLife,
} from "@/lib/stock/liveStock";

/**
 * GET/PATCH /api/admin/settings/stock-sync-schedule — how the storefront gets
 * Available quantity (Inventory Stock section of SAP Sync Config):
 *   stockSource "sync" (option 1) — scheduled sync, time windows below;
 *   stockSource "live" (option 2) — on demand from SAP (HANA), shared for
 *     liveCacheSeconds; the scheduled stock sync is disabled.
 * Root-only, via the "settings" permission (ROOT_ONLY_PERMISSIONS).
 */
const SELECT_SQL = `SELECT stock_sync_enabled, stock_sync_windows, stock_last_run_at,
  stock_last_run_status, stock_last_run_summary,
  stock_source, stock_live_cache_seconds, stock_live_refreshed_at, stock_live_shelf_refreshed_at,
  stock_live_last_status, stock_live_last_summary
  FROM sync_schedule_settings WHERE company_id = ?`;

async function loadSchedule(companyId: string) {
  const row = await queryOne<StockSyncScheduleRow & Record<string, unknown>>(SELECT_SQL, [companyId]);
  return row
    ? { ...row, stock_source: row.stock_source === "live" ? "live" : "sync", stock_sync_windows: parseStockSyncWindows(row.stock_sync_windows) }
    : null;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  return NextResponse.json({ schedule: await loadSchedule(getCompanyId()) });
}

async function PATCHHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  const { isEnabled, windows, stockSource, liveCacheSeconds } = await request.json();
  if (typeof isEnabled !== "boolean") {
    return NextResponse.json({ error: "isEnabled (boolean) is required" }, { status: 400 });
  }
  if (stockSource !== "sync" && stockSource !== "live") {
    return NextResponse.json({ error: 'stockSource must be "sync" or "live"' }, { status: 400 });
  }
  if (
    !Number.isInteger(liveCacheSeconds) ||
    liveCacheSeconds < LIVE_CACHE_MIN_SECONDS ||
    liveCacheSeconds > LIVE_CACHE_MAX_SECONDS
  ) {
    return NextResponse.json(
      { error: `Live cache must be a whole number of seconds, ${LIVE_CACHE_MIN_SECONDS}–${LIVE_CACHE_MAX_SECONDS}` },
      { status: 400 }
    );
  }
  // Windows are kept (and validated) in live mode too, so switching back to
  // option 1 restores them — the scheduler just ignores them while live.
  const windowsError = validateStockSyncWindows(windows);
  if (windowsError) return NextResponse.json({ error: windowsError }, { status: 400 });

  // Store only the known fields, sorted by start time for a stable display.
  const clean: StockSyncWindow[] = (windows as StockSyncWindow[])
    .map((w) => ({ start: w.start, end: w.end, intervalMinutes: w.intervalMinutes }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const companyId = getCompanyId();

  // Switching to option 2: read live stock from SAP once BEFORE saving, so
  // the storefront never switches to an empty live table. If SAP can't be
  // read, nothing is saved and the storefront stays on option 1.
  let liveNote = "";
  if (stockSource === "live" && (await getStockSettings()).source !== "live") {
    try {
      const r = await refreshLiveStock();
      liveNote = `First live read: ${r.rows} rows in ${r.ms} ms.`;
      // Shelf life is slow (5–15 s) — fill it in the background.
      refreshLiveShelfLife().catch((e) => console.error("[LiveStock] Shelf-life refresh failed:", e));
    } catch (error) {
      return NextResponse.json(
        {
          error: "Could not read live stock from SAP — still on option 1 (nothing saved)",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 502 }
      );
    }
  }

  await query(
    `INSERT INTO sync_schedule_settings (company_id, stock_sync_enabled, stock_sync_windows, stock_source, stock_live_cache_seconds)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stock_sync_enabled = VALUES(stock_sync_enabled),
       stock_sync_windows = VALUES(stock_sync_windows),
       stock_source = VALUES(stock_source),
       stock_live_cache_seconds = VALUES(stock_live_cache_seconds)`,
    [companyId, isEnabled, JSON.stringify(clean), stockSource, liveCacheSeconds]
  );
  // The storefront picks up the new source on its next request.
  invalidateStockSettings();

  return NextResponse.json({ success: true, note: liveNote || undefined, schedule: await loadSchedule(companyId) });
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const PATCH = audited({ action: "stock_sync_schedule_update", entityType: "setting" }, PATCHHandler);
