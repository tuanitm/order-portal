import { getPool } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { queryHanaInventoryByWarehouse } from "@/lib/hana/inventoryQuery";
import { withTableLocks } from "@/lib/db/tableLock";
import { resetIdsAfterSync } from "@/lib/db/idReset";

/**
 * Refresh ONE warehouse's stock from SAP (HANA, the same query as the
 * scheduled Inventory Stock sync) — the 🔄 button next to Warehouse in
 * Create sales order / Edit order. Both stock tables get that warehouse's
 * rows: the scheduled-sync table (item_warehouse_stock, option 1) and the
 * live table (item_warehouse_stock_live, option 2), so Avail Qty is current
 * whichever Inventory Stock option is on. Other warehouses are untouched;
 * shelf life stays as the last full sync computed it (new rows: none yet).
 */
const lastRun = new Map<string, number>();
const MIN_INTERVAL_MS = 10_000;

export async function refreshWarehouseStock(warehouseCode: string): Promise<{ rows: number; ms: number; refreshedAt: string; cached: boolean }> {
  const wh = warehouseCode.trim();
  const prev = lastRun.get(wh);
  if (prev && Date.now() - prev < MIN_INTERVAL_MS) {
    // Pressed again within seconds — the stock was just refreshed.
    return { rows: 0, ms: 0, refreshedAt: new Date(prev).toISOString(), cached: true };
  }
  const started = Date.now();
  const companyId = getCompanyId();
  const rows = await queryHanaInventoryByWarehouse([wh], undefined, { includeOnOrderOnly: true });
  const stamp = new Date(Math.floor(started / 1000) * 1000);
  const CHUNK = 500;

  await withTableLocks(["item_warehouse_stock"], async () => {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < rows.length; i += CHUNK) {
        const values = rows.slice(i, i + CHUNK).map((r) => [companyId, r.item_code, r.whs_code, Number(r.on_hand), Number(r.committed), Number(r.ordered), stamp]);
        await conn.query(
          `INSERT INTO item_warehouse_stock (company_id, sap_item_code, warehouse_code, in_stock, committed, ordered, last_synced) VALUES ?
           ON DUPLICATE KEY UPDATE in_stock = VALUES(in_stock), committed = VALUES(committed), ordered = VALUES(ordered), last_synced = VALUES(last_synced)`,
          [values]
        );
      }
      // Gone from SAP for this warehouse (no stock, nothing on order any more).
      await conn.query(`DELETE FROM item_warehouse_stock WHERE company_id = ? AND warehouse_code = ? AND last_synced < ?`, [companyId, wh, stamp]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  });
  // Upserts use up auto-increment ids — renumber like every stock sync does.
  await resetIdsAfterSync("item_warehouse_stock").catch(() => undefined);

  const live = rows.filter((r) => Number(r.on_hand) !== 0 || Number(r.committed) !== 0);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < live.length; i += CHUNK) {
      const values = live.slice(i, i + CHUNK).map((r) => [companyId, r.item_code, r.whs_code, Number(r.on_hand), Number(r.committed), stamp]);
      await conn.query(
        `INSERT INTO item_warehouse_stock_live (company_id, sap_item_code, warehouse_code, in_stock, committed, refreshed_at) VALUES ?
         ON DUPLICATE KEY UPDATE in_stock = VALUES(in_stock), committed = VALUES(committed), refreshed_at = VALUES(refreshed_at)`,
        [values]
      );
    }
    await conn.query(`DELETE FROM item_warehouse_stock_live WHERE company_id = ? AND warehouse_code = ? AND refreshed_at < ?`, [companyId, wh, stamp]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    // The live table is optional (option 2) — the sync table above is already current.
    console.warn("[Stock] live table refresh for warehouse", wh, "failed:", e instanceof Error ? e.message : e);
  } finally {
    conn.release();
  }

  lastRun.set(wh, started);
  return { rows: rows.length, ms: Date.now() - started, refreshedAt: stamp.toISOString(), cached: false };
}
