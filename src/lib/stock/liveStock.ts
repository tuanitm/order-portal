import { getPool, query, queryOne } from "@/lib/db/connection";
import { getCompanyId, loadConfig } from "@/lib/config";
import { queryHanaInventoryByWarehouse, configWarehouseCodes } from "@/lib/hana/inventoryQuery";
import { getSapClient } from "@/lib/sap-b1/client";
import { computeBatchShelfLifePct } from "@/lib/sap-b1/sync";

/**
 * Where the storefront reads stock from (Admin → SAP Sync Config →
 * Inventory Stock, root-only):
 *
 *  - "sync" (option 1): `item_warehouse_stock`, filled by the scheduled
 *    stock sync (time windows, e.g. every 10/30 minutes).
 *  - "live" (option 2): `item_warehouse_stock_live`, refreshed ON DEMAND from
 *    HANA with the same "QRM_Inventory by Warehouse" query as Admin →
 *    Inventory (committed = open SO + Transfer Requests + Production Order
 *    components). One refresh (~0.3–0.5 s) is shared by every customer for
 *    `stock_live_cache_seconds` (default 30 s), so SAP sees at most one stock
 *    query per window however many customers browse — and none at all while
 *    nobody does. The scheduled stock sync does not run in this mode.
 *
 * Both tables have the same columns, so every storefront query works
 * unchanged on either — only the table name differs (see
 * getStorefrontStockTable / productPricing's buildStockGateClause).
 *
 * Shelf life: batch dates come from the Service Layer (the read-only HANA
 * user has no grant on the batch tables), which takes 5–15 s for the whole
 * catalog — too slow for a page load, and batch dates rarely change. So in
 * live mode the worst-batch shelf-life % is refreshed in the BACKGROUND every
 * SHELF_LIFE_REFRESH_MINUTES and carried onto the live rows; a page never
 * waits for it.
 */
export type StockSource = "sync" | "live";
export type StockTable = "item_warehouse_stock" | "item_warehouse_stock_live";

export const LIVE_CACHE_MIN_SECONDS = 5;
export const LIVE_CACHE_MAX_SECONDS = 300;
const SHELF_LIFE_REFRESH_MINUTES = 30;
/** How long a page waits for a due live refresh before serving the previous stock instead. */
const MAX_WAIT_MS = 4000;
/** Settings are re-read at most this often (one tiny query; saves a round trip per request). */
const SETTINGS_TTL_MS = 5000;

interface StockSettings {
  source: StockSource;
  liveCacheSeconds: number;
}

interface LiveState {
  settings: StockSettings | null;
  settingsReadAt: number;
  /** ms epoch of the last successful live stock refresh (null = unknown → read from DB). */
  refreshedAt: number | null;
  lastAttemptAt: number;
  inflight: Promise<void> | null;
  shelfRefreshedAt: number | null;
  /** ms epoch of the last shelf-life attempt, success or not — throttles retries after a failure. */
  shelfLastAttemptAt: number;
  shelfInflight: Promise<void> | null;
  /** Latest worst-batch shelf-life % per "item|warehouse", applied to new live rows. */
  shelfLife: Map<string, number>;
}

const g = globalThis as typeof globalThis & { __liveStockState?: LiveState };
function state(): LiveState {
  if (!g.__liveStockState) {
    g.__liveStockState = {
      settings: null, settingsReadAt: 0, refreshedAt: null, lastAttemptAt: 0, inflight: null,
      shelfRefreshedAt: null, shelfLastAttemptAt: 0, shelfInflight: null, shelfLife: new Map(),
    };
  }
  return g.__liveStockState;
}

/** Drop the cached settings (call after root saves the Inventory Stock settings). */
export function invalidateStockSettings(): void {
  state().settingsReadAt = 0;
}

export async function getStockSettings(): Promise<StockSettings> {
  const s = state();
  if (s.settings && Date.now() - s.settingsReadAt < SETTINGS_TTL_MS) return s.settings;
  const row = await queryOne<{ stock_source: string | null; stock_live_cache_seconds: number | null }>(
    "SELECT stock_source, stock_live_cache_seconds FROM sync_schedule_settings WHERE company_id = ?",
    [getCompanyId()]
  );
  s.settings = {
    source: row?.stock_source === "live" ? "live" : "sync",
    liveCacheSeconds: Math.min(LIVE_CACHE_MAX_SECONDS, Math.max(LIVE_CACHE_MIN_SECONDS, row?.stock_live_cache_seconds ?? 30)),
  };
  s.settingsReadAt = Date.now();
  return s.settings;
}

/**
 * The stock table the storefront should read right now. In live mode this
 * also makes sure the live rows are fresh (refreshing from HANA when older
 * than the cache window — waiting at most MAX_WAIT_MS, otherwise serving the
 * previous stock while the refresh finishes in the background).
 */
export async function getStorefrontStockTable(): Promise<StockTable> {
  const settings = await getStockSettings();
  if (settings.source !== "live") return "item_warehouse_stock";
  await ensureLiveStockFresh(settings.liveCacheSeconds);
  // Until the live table has been filled successfully at least once (first
  // switch to option 2, SAP slow or failing), it may be empty — which would
  // hide every product. Keep serving the scheduled-sync stock until then.
  if (!state().refreshedAt) return "item_warehouse_stock";
  return "item_warehouse_stock_live";
}

async function ensureLiveStockFresh(cacheSeconds: number): Promise<void> {
  const s = state();
  const ttlMs = cacheSeconds * 1000;

  if (s.refreshedAt === null || s.shelfRefreshedAt === null) {
    // First call since the server started — pick up the persisted timestamps.
    const row = await queryOne<{ r: Date | string | null; sh: Date | string | null }>(
      "SELECT stock_live_refreshed_at AS r, stock_live_shelf_refreshed_at AS sh FROM sync_schedule_settings WHERE company_id = ?",
      [getCompanyId()]
    );
    if (s.refreshedAt === null) s.refreshedAt = row?.r ? new Date(row.r).getTime() : 0;
    // The in-memory shelf-life map is empty after a restart, so refresh it right away.
    if (s.shelfRefreshedAt === null) s.shelfRefreshedAt = 0;
  }

  // Shelf life: background only, never awaited by a page. A failed attempt
  // (e.g. Service Layer down) is not retried until the next window either,
  // so SAP doesn't get a 5–15 s batch query on every page load.
  const shelfWindowMs = SHELF_LIFE_REFRESH_MINUTES * 60 * 1000;
  if (
    !s.shelfInflight &&
    Date.now() - s.shelfRefreshedAt! > shelfWindowMs &&
    Date.now() - s.shelfLastAttemptAt > shelfWindowMs
  ) {
    s.shelfLastAttemptAt = Date.now();
    s.shelfInflight = refreshLiveShelfLife()
      .catch((e) => console.error("[LiveStock] Shelf-life refresh failed:", e))
      .finally(() => { s.shelfInflight = null; });
  }

  const now = Date.now();
  if (now - s.refreshedAt! < ttlMs) return;
  // A failed attempt isn't retried until the next cache window (SAP down ≠ every page waiting on it).
  if (!s.inflight && now - s.lastAttemptAt < ttlMs) return;

  if (!s.inflight) {
    s.lastAttemptAt = now;
    s.inflight = refreshLiveStock()
      .then(() => undefined)
      .catch((e) => console.error("[LiveStock] Refresh failed — serving previous stock:", e))
      .finally(() => { s.inflight = null; });
  }
  // Serve fresh stock when SAP answers quickly; otherwise the previous stock.
  await Promise.race([s.inflight, new Promise((r) => setTimeout(r, MAX_WAIT_MS))]);
}

async function recordStatus(status: "success" | "failed", summary: string, refreshedAt: Date | null): Promise<void> {
  await query(
    `INSERT INTO sync_schedule_settings (company_id, stock_live_last_status, stock_live_last_summary, stock_live_refreshed_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stock_live_last_status = VALUES(stock_live_last_status),
       stock_live_last_summary = VALUES(stock_live_last_summary),
       stock_live_refreshed_at = COALESCE(VALUES(stock_live_refreshed_at), stock_live_refreshed_at)`,
    [getCompanyId(), status, summary, refreshedAt]
  );
}

/**
 * Pull live stock for every configured warehouse (config.json
 * masterdata.wareHouse) from HANA and replace this company's live rows in one
 * transaction: upsert what SAP returned, delete what it no longer returns.
 * The table has no auto-increment id, so frequent refreshes never grow one.
 */
export async function refreshLiveStock(): Promise<{ rows: number; ms: number }> {
  const s = state();
  const started = Date.now();
  const companyId = getCompanyId();
  const warehouses = configWarehouseCodes();

  try {
    const rows = await queryHanaInventoryByWarehouse(warehouses);
    const stamp = new Date(Math.floor(started / 1000) * 1000);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const values = rows.slice(i, i + CHUNK).map((r) => [
          companyId, r.item_code, r.whs_code, Number(r.on_hand), Number(r.committed),
          s.shelfLife.get(`${r.item_code}|${r.whs_code}`) ?? null, stamp,
        ]);
        // Shelf life is only filled in on NEW rows here; existing rows keep
        // theirs until the next shelf-life refresh rewrites it.
        await conn.query(
          `INSERT INTO item_warehouse_stock_live (company_id, sap_item_code, warehouse_code, in_stock, committed, shelf_life_pct, refreshed_at)
           VALUES ?
           ON DUPLICATE KEY UPDATE in_stock = VALUES(in_stock), committed = VALUES(committed), refreshed_at = VALUES(refreshed_at)`,
          [values]
        );
      }
      await conn.query(`DELETE FROM item_warehouse_stock_live WHERE company_id = ? AND refreshed_at <> ?`, [companyId, stamp]);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    s.refreshedAt = started;
    const ms = Date.now() - started;
    await recordStatus("success", `✓ Live stock: ${rows.length} item × warehouse rows from SAP in ${ms} ms`, stamp);
    return { rows: rows.length, ms };
  } catch (error) {
    await recordStatus("failed", `✗ Live stock: ${error instanceof Error ? error.message : String(error)}`, null).catch(() => undefined);
    throw error;
  }
}

/** Worst-batch remaining shelf-life % per item × warehouse (same rule as the scheduled stock sync). */
export async function refreshLiveShelfLife(): Promise<void> {
  const s = state();
  const started = Date.now();
  const masterdata = loadConfig().masterdata;
  // Its own saved SQLQuery, so it never overwrites the scheduled sync's.
  const batches = await getSapClient().getBatchStock(masterdata.itemGroup, masterdata.wareHouse, "BatchStockLive");
  const map = new Map<string, number>();
  for (const b of batches) {
    const pct = computeBatchShelfLifePct(b.mnf_date, b.exp_date);
    if (pct === null) continue;
    const key = `${b.item_code}|${b.warehouse_code}`;
    const existing = map.get(key);
    if (existing === undefined || pct < existing) map.set(key, pct);
  }
  s.shelfLife = map;

  const companyId = getCompanyId();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE item_warehouse_stock_live SET shelf_life_pct = NULL WHERE company_id = ?`, [companyId]);
    const entries = [...map.entries()].map(([k, pct]) => { const [code, whs] = k.split("|"); return [code, whs, pct]; });
    const CHUNK = 500;
    for (let i = 0; i < entries.length; i += CHUNK) {
      await conn.query(
        `UPDATE item_warehouse_stock_live l
           JOIN JSON_TABLE(?, '$[*]' COLUMNS (
             code VARCHAR(50) PATH '$[0]', whs VARCHAR(20) PATH '$[1]', pct DECIMAL(6,2) PATH '$[2]'
           )) j ON j.code COLLATE utf8mb4_unicode_ci = l.sap_item_code
               AND j.whs COLLATE utf8mb4_unicode_ci = l.warehouse_code
            SET l.shelf_life_pct = j.pct
          WHERE l.company_id = ?`,
        [JSON.stringify(entries.slice(i, i + CHUNK)), companyId]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  s.shelfRefreshedAt = started;
  await query(
    `UPDATE sync_schedule_settings SET stock_live_shelf_refreshed_at = ? WHERE company_id = ?`,
    [new Date(started), companyId]
  );
}
