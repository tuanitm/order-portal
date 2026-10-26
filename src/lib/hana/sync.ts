import { readFileSync } from "fs";
import { join } from "path";
import { withTableLocks } from "@/lib/db/tableLock";
import { swapInFreshTable } from "@/lib/db/idReset";
import { getCompanyId } from "@/lib/config";
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
  after_cus_disc: string | null;
  after_price_disc: string | null;
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
 * Whether `table` (in `schema`) has a column named `column` — used to
 * detect a company whose Promotion Management add-on install never fully
 * set up group-level promotions: in that case the "@PM_GRP_BP"/
 * "@PM_GRP_ITEM" UDO header table exists but was registered without the
 * usual system columns (no "DocEntry", among others), leaving it with only
 * Code/Name/U_Inactive — confirmed empirically against a real company
 * ("ADS") where "@PM_GRP_ITEM" has just those 3 columns while the sibling
 * "@PM_GRP_BP" has the full ~17-column UDO structure in the SAME schema.
 * Querying SYS.TABLE_COLUMNS (not attempting the join and catching the
 * error) keeps this a cheap, side-effect-free pre-check.
 */
async function hasColumn(schema: string, table: string, column: string): Promise<boolean> {
  const rows = await queryHana<{ cnt: number }>(
    `SELECT COUNT(*) AS "cnt" FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${table.replace(/'/g, "''")}' AND COLUMN_NAME = '${column}'`
  );
  return (rows[0]?.cnt ?? 0) > 0;
}

/**
 * Removes a marked branch of promotion_program.sql — everything from
 * `-- @@${marker}_START` through `-- @@${marker}_END` inclusive, which
 * covers the `UNION ALL` right after the START marker and the whole SELECT
 * branch up to the END marker — leaving the CTE as just its first SELECT
 * branch. Throws if the markers aren't found, rather than silently
 * returning the unmodified (still-broken) SQL text.
 */
function stripBranch(sqlText: string, marker: string): string {
  // \r?\n (not a bare \n) around the markers — promotion_program.sql has CRLF line endings.
  const pattern = new RegExp(`\\r?\\n\\s*-- @@${marker}_START[\\s\\S]*?-- @@${marker}_END\\r?\\n`, "m");
  if (!pattern.test(sqlText)) {
    throw new Error(`[HANA] promotion_program.sql: could not find markers for ${marker} — has the file changed?`);
  }
  return sqlText.replace(pattern, "\n");
}

/**
 * Pull Promotion Discounts straight from SAP HANA (promotion_program.sql —
 * a CTE query SAP B1's own SQLQueries mechanism can't run anyway, since it
 * doesn't support WITH) and replace the local `promotion_discount` cache —
 * the only sync path for this table (the GT_Promotion_Detail.xlsx manual
 * import that used to stand in for this before HANA access was available
 * has been removed).
 *
 * The query's own BP_EXPANDED/ITEM_EXPANDED CTEs already resolve a BP-group
 * or item-group promotion down to each individual member BP/item (via a
 * live join against OCRD/OITM at query time) — unlike the SAP-Service-Layer
 * sourced data elsewhere in this app (contract_discount), which keeps
 * group-level rows and lets the app's own matching SQL expand them at
 * request time. That means:
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
  let sqlText = readFileSync(sqlPath, "utf-8").replace(
    /"@PM_HEADER"|"PM_APPLYBP"|"PM_SELLING_ITEMS"|"@PM_GRP_BP"|"PM_GRP_BP_DETAILS"|"@PM_GRP_ITEM"|"PM_GRP_ITEM_DETAILS"|"OCRD"|"OITM"/g,
    (m) => `"${schema}".${m}`
  );

  // Degrade gracefully for a company whose "@PM_GRP_BP"/"@PM_GRP_ITEM" UDO
  // was never fully set up (missing DocEntry — see hasColumn's own
  // comment): drop that group-level branch from the CTE entirely rather
  // than let the whole sync fail to even compile. Single-BP/single-item
  // promotions (the other branch of each CTE) are unaffected either way.
  const [hasBpGroupDocEntry, hasItemGroupDocEntry] = await Promise.all([
    hasColumn(schema, "@PM_GRP_BP", "DocEntry"),
    hasColumn(schema, "@PM_GRP_ITEM", "DocEntry"),
  ]);
  if (!hasBpGroupDocEntry) {
    console.warn(`[HANA] "${schema}"."@PM_GRP_BP" has no DocEntry column — skipping BP-group-level promotions for this sync`);
    sqlText = stripBranch(sqlText, "BP_GROUP_BRANCH");
  }
  if (!hasItemGroupDocEntry) {
    console.warn(`[HANA] "${schema}"."@PM_GRP_ITEM" has no DocEntry column — skipping item-group-level promotions for this sync`);
    sqlText = stripBranch(sqlText, "ITEM_GROUP_BRANCH");
  }

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
      getCompanyId(),
      r.doc_entry,
      r.promotion_code,
      r.promotion_name,
      toMySQLDate(r.create_date),
      toMySQLDate(r.update_date),
      toMySQLDate(r.begin_date),
      toMySQLDate(r.end_date),
      r.after_cus_disc ?? null,
      r.after_price_disc ?? null,
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

  // Loaded into a fresh copy of the table and swapped in atomically, instead
  // of DELETE + INSERT in place: every sync replaces ~720k rows, and in-place
  // inserts burned that many ids each time (12M+ after a few weeks, on an
  // INT column). A fresh table numbers from 1 again on every sync. Other
  // companies sharing this database keep their rows (copied across as-is).
  const columns = `company_id, doc_entry, promotion_code, promotion_name, create_date, update_date, begin_date, end_date,
           after_cus_disc, after_price_disc,
           bp_grp_code, bp_grp_name, bp_type, bp_code, bp_name,
           selling_grp_code, selling_grp_name, it_type, selling_item_code, selling_item_name,
           disc_pct, selling_qty, giving_item_code, giving_item_name, giving_qty, last_synced`;
  await withTableLocks(["promotion_discount"], () =>
    swapInFreshTable("promotion_discount", async (conn, fresh) => {
      await conn.query(
        `INSERT INTO \`${fresh}\` (${columns}) SELECT ${columns} FROM promotion_discount WHERE company_id <> ? ORDER BY id`,
        [getCompanyId()]
      );
      for (let i = 0; i < values.length; i += CHUNK_SIZE) {
        await conn.query(`INSERT INTO \`${fresh}\` (${columns}) VALUES ?`, [values.slice(i, i + CHUNK_SIZE)]);
      }
    })
  );
  return { rowsSynced: values.length, rowsSkipped };
}
