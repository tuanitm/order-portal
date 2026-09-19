import { existsSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";
import { getPool } from "@/lib/db/connection";

/**
 * Column → DB field mapping, by header name rather than fixed position — the
 * export's column set has already changed once between sessions (extra
 * classification columns like disc_type/bp_linetype/it_linetype appeared,
 * and the item-group column was renamed selling_grp_code -> selling_itgrp_code).
 * Each DB field lists its acceptable header aliases, tried in order; columns
 * present in the file but not listed here (disc_type, bp_linetype, it_linetype)
 * are simply not imported — the app doesn't use them today, and dropping
 * unknown columns keeps this resilient to the source file gaining more later.
 *
 * bp_type/it_type ARE imported (unlike bp_linetype/it_linetype) — they're the
 * authoritative key for how to read bp_code/selling_item_code: bp_type='2' ->
 * bp_code is an exact BP; bp_type='CG1'/'CG2'/'CG3' -> bp_code is a
 * customer_groups code at that level. it_type='4' -> selling_item_code is an
 * exact item; it_type='IC1'..'IC6' -> selling_item_code is an item_groups
 * code at that level. See src/app/api/products/route.ts for the matching.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  doc_entry: ["doc_entry"],
  promotion_code: ["promotion_code"],
  promotion_name: ["promotion_name"],
  create_date: ["create_date"],
  update_date: ["update_date"],
  begin_date: ["begin_date"],
  end_date: ["end_date"],
  bp_grp_code: ["bp_grp_code"],
  bp_grp_name: ["bp_grp_name"],
  bp_type: ["bp_type"],
  bp_code: ["bp_code"],
  bp_name: ["bp_name"],
  selling_grp_code: ["selling_itgrp_code", "selling_grp_code"],
  selling_grp_name: ["selling_itgrp_name", "selling_grp_name"],
  it_type: ["it_type"],
  selling_item_code: ["selling_item_code"],
  selling_item_name: ["selling_item_name"],
  disc_pct: ["disc_pct"],
  selling_qty: ["selling_qty"],
  giving_item_code: ["giving_item_code"],
  giving_item_name: ["giving_item_name"],
  giving_qty: ["giving_qty"],
};

const CHUNK_SIZE = 1000;

/** Excel's day-1 epoch is 1899-12-30 (accounting for the historical 1900 leap-year bug). */
function excelSerialToDateStr(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const serial = Number(value);
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Load Promotion Discount rows from GT_Promotion_Detail.xlsx (a manual
 * export of the same result set `executePromotionSql` targets in SAP B1 —
 * see sync.ts) into the local `promotion_discount` cache. Used as the
 * primary data source while the SAP API user lacks Query Generator
 * authorization on the promotion UDTs (@PM_HEADER etc. — see the admin
 * promotions page). Full replace, same reasoning as syncPromotionDiscounts:
 * the file is a flat snapshot with no stable key across re-exports.
 */
export async function importPromotionDiscountsFromXlsx(
  fileName = "GT_Promotion_Detail.xlsx"
): Promise<{ rowsImported: number }> {
  const filePath = join(process.cwd(), fileName);
  if (!existsSync(filePath)) {
    throw new Error(`${fileName} not found in project root`);
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  if (rows.length === 0) {
    throw new Error(`${fileName} has no rows`);
  }

  const header = (rows[0] as unknown[]).map((h) => String(h).trim());

  const columnIndex: Record<string, number> = {};
  const missing: string[] = [];
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx === -1) {
      missing.push(field);
    } else {
      columnIndex[field] = idx;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${fileName} is missing expected column(s): ${missing.join(", ")}.\nHeader found: ${header.join(", ")}`
    );
  }

  const dataRows = rows.slice(1);
  const now = new Date();

  const values = dataRows.map((r) => [
    numOrNull(r[columnIndex.doc_entry]),
    strOrNull(r[columnIndex.promotion_code]),
    strOrNull(r[columnIndex.promotion_name]),
    excelSerialToDateStr(r[columnIndex.create_date]),
    excelSerialToDateStr(r[columnIndex.update_date]),
    excelSerialToDateStr(r[columnIndex.begin_date]),
    excelSerialToDateStr(r[columnIndex.end_date]),
    strOrNull(r[columnIndex.bp_grp_code]),
    strOrNull(r[columnIndex.bp_grp_name]),
    strOrNull(r[columnIndex.bp_type]),
    strOrNull(r[columnIndex.bp_code]),
    strOrNull(r[columnIndex.bp_name]),
    strOrNull(r[columnIndex.selling_grp_code]),
    strOrNull(r[columnIndex.selling_grp_name]),
    strOrNull(r[columnIndex.it_type]),
    strOrNull(r[columnIndex.selling_item_code]),
    strOrNull(r[columnIndex.selling_item_name]),
    numOrNull(r[columnIndex.disc_pct]),
    numOrNull(r[columnIndex.selling_qty]),
    strOrNull(r[columnIndex.giving_item_code]),
    strOrNull(r[columnIndex.giving_item_name]),
    numOrNull(r[columnIndex.giving_qty]),
    now,
  ]);

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // Recreate the table if it's missing (matches schema.sql's definition) —
    // makes this importer usable as the table's own bootstrap, not just a refresh.
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS promotion_discount (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doc_entry INT NOT NULL,
        promotion_code VARCHAR(50),
        promotion_name VARCHAR(255),
        create_date DATE,
        update_date DATE,
        begin_date DATE,
        end_date DATE,
        bp_grp_code VARCHAR(50),
        bp_grp_name VARCHAR(255),
        bp_type VARCHAR(10),
        bp_code VARCHAR(50),
        bp_name VARCHAR(255),
        selling_grp_code VARCHAR(50),
        selling_grp_name VARCHAR(255),
        it_type VARCHAR(10),
        selling_item_code VARCHAR(50),
        selling_item_name VARCHAR(255),
        disc_pct DECIMAL(6,2),
        selling_qty DECIMAL(18,2),
        giving_item_code VARCHAR(50),
        giving_item_name VARCHAR(255),
        giving_qty DECIMAL(18,2),
        last_synced TIMESTAMP NULL,
        INDEX idx_bp_code (bp_code),
        INDEX idx_selling_item_code (selling_item_code),
        INDEX idx_active_dates (begin_date, end_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

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
    return { rowsImported: values.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
