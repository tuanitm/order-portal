import { getPool } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { computeBatchShelfLifePct } from "@/lib/sap-b1/sync";
import type { SapBatchStockRow } from "@/lib/sap-b1/client";

/**
 * item_batch_shelf_stock = on-hand qty per item × warehouse × batch shelf-life %.
 * The storefront and Admin Create/Edit order count only the batches that
 * meet the customer's required shelf life (see productPricing's
 * usableQtySqlFor), the same rule as the Admin order review
 * (lib/orderStock.ts): Avail = min(OnHand − Committed, qty of the batches
 * inside the required range).
 *
 * Batches with the same % are summed into one row. `warehouseCode` set =
 * replace only that warehouse's rows (🔄 refresh); otherwise every row of
 * this company (full stock sync / live shelf-life refresh).
 */
export async function replaceBatchStock(batches: SapBatchStockRow[], warehouseCode?: string): Promise<number> {
  const companyId = getCompanyId();
  const grouped = new Map<string, Map<string, number>>(); // item|whs → pct key → qty
  for (const b of batches) {
    if (warehouseCode && b.warehouse_code !== warehouseCode) continue;
    const raw = computeBatchShelfLifePct(b.mnf_date, b.exp_date);
    const pctKey = raw === null ? "" : (Math.round(raw * 100) / 100).toFixed(2);
    const key = `${b.item_code}|${b.warehouse_code}`;
    const m = grouped.get(key) ?? new Map<string, number>();
    m.set(pctKey, (m.get(pctKey) ?? 0) + Number(b.qty));
    grouped.set(key, m);
  }
  const now = new Date();
  const values: unknown[][] = [];
  for (const [key, m] of grouped) {
    const [code, whs] = key.split("|");
    let seq = 0;
    for (const [pct, qty] of m) values.push([companyId, code, whs, ++seq, pct === "" ? null : Number(pct), qty, now]);
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (warehouseCode) await conn.query(`DELETE FROM item_batch_shelf_stock WHERE company_id = ? AND warehouse_code = ?`, [companyId, warehouseCode]);
    else await conn.query(`DELETE FROM item_batch_shelf_stock WHERE company_id = ?`, [companyId]);
    const CHUNK = 1000;
    for (let i = 0; i < values.length; i += CHUNK) {
      await conn.query(
        `INSERT INTO item_batch_shelf_stock (company_id, sap_item_code, warehouse_code, seq, shelf_life_pct, qty, refreshed_at) VALUES ?`,
        [values.slice(i, i + CHUNK)]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return values.length;
}
