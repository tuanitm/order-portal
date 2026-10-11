import { readFileSync } from "fs";
import { join } from "path";
import { getPool } from "@/lib/db/connection";
import { queryHana, getHanaSchema } from "@/lib/hana/client";

/** One row as returned by promotion_program.sql's final SELECT. */
interface PromotionRow {
  doc_entry: number;
  promotion_code: string | null;
  promotion_name: string | null;
  create_date: string | Date | null;
  update_date: string | Date | null;
  begin_date: string | Date | null;
  end_date: string | Date | null;
  disc_type: string | null;
  bp_grp_code: string | null;
  bp_grp_name: string | null;
  bp_code: string | null;
  bp_name: string | null;
  selling_grp_code: string | null;
  selling_grp_name: string | null;
  selling_item_code: string | null;
  selling_item_name: string | null;
  disc_pct: number | null;
  selling_qty: number | null;
  giving_item_code: string | null;
  giving_item_name: string | null;
  giving_qty: number | null;
}

function toMySQLDate(value: string | Date | null): string | null {
  if (!value) return null;
  const iso = value instanceof Date ? value.toISOString() : value;
  return iso.slice(0, 10);
}

const CHUNK_SIZE = 1000;

/**
 * Pull Promotion Discounts straight from SAP HANA (promotion_program.sql —
 * a CTE query SAP B1's own SQLQueries mechanism can't run anyway, since it
 * doesn't support WITH) and replace the local `promotion_discount` cache.
 * Supersedes the GT_Promotion_Detail.xlsx import as the primary source;
 * that importer still exists as a manual fallback if HANA access ever
 * breaks again.
 *
 * The query's own BP_EXPANDED/ITEM_EXPANDED CTEs already resolve a BP-group
 * or item-group promotion down to each individual member BP/item (via a
 * live join against OCRD/OITM at query time) — unlike the SAP-Service-Layer
 * sourced data elsewhere in this app (contract_discount, and the Excel
 * import this replaces), which keeps group-level rows and lets the app's
 * own matching SQL expand them at request time. That means:
 *   - bp_code/selling_item_code here are always a concrete CardCode/ItemCode
 *     once present (never a group code) — so bp_type/it_type are set to the
 *     "exact code" values ('2'/'4') for every row that has one, not a CG/IC
 *     group level.
 *   - group membership changes in SAP only take effect on the NEXT sync
 *     (the Service-Layer-sourced tables resolve group membership live, on
 *     every request instead) — an acceptable trade-off for a scheduled
 *     sync, just worth knowing.
 * A row with selling_item_code NULL is dropped, not synced as "applies to
 * all items" — the query's own ITEM_EXPANDED only covers item categories
 * D1/L1/A1/A2 (see promotion_program.sql), so NULL there means "excluded by
 * that filter", not "no item restriction". bp_code NULL IS kept as-is
 * (bp_type NULL too) — that matches this app's own established convention
 * elsewhere for "applies to every customer" (see promotionMatchSql in
 * src/app/api/products/route.ts).
 */
export async function syncPromotionDiscountsFromHana(): Promise<{ rowsSynced: number; rowsSkipped: number }> {
  const schema = getHanaSchema();
  const sqlPath = join(/*turbopackIgnore: true*/ process.cwd(), "promotion_program.sql");
  const sqlText = readFileSync(sqlPath, "utf-8").replace(
    /"@PM_HEADER"|"PM_APPLYBP"|"PM_SELLING_ITEMS"|"@PM_GRP_BP"|"PM_GRP_BP_DETAILS"|"@PM_GRP_ITEM"|"PM_GRP_ITEM_DETAILS"|"OCRD"|"OITM"/g,
    (m) => `"${schema}".${m}`
  );

  const rows = await queryHana<PromotionRow>(sqlText);

  const values: unknown[][] = [];
  let rowsSkipped = 0;
  const now = new Date();

  for (const r of rows) {
    if (!r.selling_item_code) {
      rowsSkipped++;
      continue;
    }
    if (r.disc_pct === null && !r.giving_item_code) {
      rowsSkipped++;
      continue;
    }

    values.push([
      r.doc_entry,
      r.promotion_code,
      r.promotion_name,
      toMySQLDate(r.create_date),
      toMySQLDate(r.update_date),
      toMySQLDate(r.begin_date),
      toMySQLDate(r.end_date),
      r.bp_grp_code,
      r.bp_grp_name,
      r.bp_code ? "2" : null, // see doc comment: always an exact CardCode once present, never a group
      r.bp_code,
      r.bp_name,
      r.selling_grp_code,
      r.selling_grp_name,
      "4", // always an exact ItemCode — rows with no item were already skipped above
      r.selling_item_code,
      r.selling_item_name,
      r.disc_pct,
      r.selling_qty,
      r.giving_item_code,
      r.giving_item_name,
      r.giving_qty,
      now,
    ]);
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM promotion_discount`);

    for (let i = 0; i < values.length; i += CHUNK_SIZE) {
      const chunk = values.slice(i, i + CHUNK_SIZE);
      await conn.query(
        `INSERT INTO promotion_discount (
           doc_entry, promotion_code, promotion_name, create_date, update_date, begin_date, end_date,
           bp_grp_code, bp_grp_name, bp_type, bp_code, bp_name,
           selling_grp_code, selling_grp_name, it_type, selling_item_code, selling_item_name,
           disc_pct, selling_qty, giving_item_code, giving_item_name, giving_qty, last_synced)
         VALUES ?`,
        [chunk]
      );
    }

    await conn.commit();
    return { rowsSynced: values.length, rowsSkipped };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
