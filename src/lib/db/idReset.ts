import type { PoolConnection } from "mysql2/promise";
import { getPool } from "@/lib/db/connection";
import { withTableLocks, busyTables } from "@/lib/db/tableLock";

/**
 * "Reset the Id" (Admin → Settings, root only): renumbers a table's `id`
 * column back to 1..N, keeping every declared foreign key pointing at the
 * same parent row.
 *
 * Only these tables may be reset. Every one is either a copy of SAP/HANA
 * data that syncs rewrite wholesale (that's what pushes their ids up — about
 * 720k ids per promotion sync) or a group table whose ids are only ever
 * referenced through declared foreign keys. Users, admin users, orders and
 * their children, and audit logs are deliberately left out: their ids also
 * live outside the database (login tokens, order links in emails and push
 * notifications, audit_logs.entity_id as text), where a renumbering can't
 * follow them and would make them point at a different row. They are tiny
 * anyway.
 */
export const RESETTABLE_TABLES = [
  "promotion_discount",
  "item_channel_prices",
  "item_warehouse_stock",
  "period_discount",
  "contract_discount",
  "customer_groups",
  "item_groups",
] as const;
export type ResettableTable = (typeof RESETTABLE_TABLES)[number];

export function isResettableTable(table: string): table is ResettableTable {
  return (RESETTABLE_TABLES as readonly string[]).includes(table);
}

const INT_MAX: Record<string, number> = {
  int: 2147483647,
  "int unsigned": 4294967295,
  bigint: 9223372036854775807,
  "bigint unsigned": 18446744073709551615,
};

interface ChildFk { table: string; column: string }

export interface IdResetPreview {
  table: ResettableTable;
  rows: number;
  maxId: number;
  nextAutoIncrement: number | null;
  idType: string;
  /** How far the next id is into the id column's range, in percent. */
  rangeUsedPct: number;
  method: "swap" | "in_place";
  children: { table: string; column: string; rows: number }[];
  busy: boolean;
}

export interface IdResetResult {
  table: ResettableTable;
  method: "swap" | "in_place";
  rows: number;
  oldMaxId: number;
  newMaxId: number;
  childrenUpdated: { table: string; column: string; rows: number }[];
  ms: number;
}

function ident(name: string): string {
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unsafe table/column name: ${name}`);
  return `\`${name}\``;
}

async function childForeignKeys(conn: PoolConnection, table: string): Promise<ChildFk[]> {
  const [rows] = await conn.query(
    `SELECT table_name AS t, column_name AS c FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND referenced_table_name = ? AND referenced_column_name = 'id'
      ORDER BY table_name, column_name`,
    [table]
  );
  return (rows as { t: string; c: string }[]).map((r) => ({ table: r.t, column: r.c }));
}

async function hasOutgoingForeignKeys(conn: PoolConnection, table: string): Promise<boolean> {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name = ? AND referenced_table_name IS NOT NULL LIMIT 1`,
    [table]
  );
  return (rows as unknown[]).length > 0;
}

/** Every column except `id` (and generated columns, which can't be inserted into). */
async function copyableColumns(conn: PoolConnection, table: string): Promise<string[]> {
  const [rows] = await conn.query(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name <> 'id' AND extra NOT LIKE '%GENERATED%'
      ORDER BY ordinal_position`,
    [table]
  );
  return (rows as { c: string }[]).map((r) => r.c);
}

/**
 * Builds a fresh, empty copy of `table` (same columns and indexes, ids
 * starting at 1), lets `fill` load it, then swaps it in with one atomic
 * RENAME TABLE — readers see either the old table or the new one, never a
 * half-loaded one. Only for tables no foreign key points into or out of
 * (CREATE TABLE ... LIKE copies indexes but not foreign keys). The caller
 * must hold this table's lock (withTableLocks) so nothing writes to the old
 * table while the new one is being filled.
 */
export async function swapInFreshTable(
  table: string,
  fill: (conn: PoolConnection, freshTable: string) => Promise<void>
): Promise<void> {
  const fresh = `${table}__fresh`;
  const old = `${table}__old`;
  const conn = await getPool().getConnection();
  try {
    if ((await childForeignKeys(conn, table)).length > 0 || (await hasOutgoingForeignKeys(conn, table))) {
      throw new Error(`${table} has foreign keys — it can't be rebuilt by swapping`);
    }
    // Leftovers from a run that died half-way (we hold the lock, so they're ours).
    await conn.query(`DROP TABLE IF EXISTS ${ident(fresh)}, ${ident(old)}`);
    await conn.query(`CREATE TABLE ${ident(fresh)} LIKE ${ident(table)}`);
    try {
      await fill(conn, fresh);
      await conn.query(`RENAME TABLE ${ident(table)} TO ${ident(old)}, ${ident(fresh)} TO ${ident(table)}`);
    } catch (error) {
      await conn.query(`DROP TABLE IF EXISTS ${ident(fresh)}`).catch(() => undefined);
      throw error;
    }
    await conn.query(`DROP TABLE IF EXISTS ${ident(old)}`);
  } finally {
    conn.release();
  }
}

async function countAndMax(conn: PoolConnection, table: string): Promise<{ rows: number; maxId: number }> {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM ${ident(table)}`);
  const r = (rows as { n: number; m: number | string }[])[0];
  return { rows: Number(r.n), maxId: Number(r.m) };
}

async function orphanCount(conn: PoolConnection, parent: string, child: ChildFk): Promise<number> {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM ${ident(child.table)} c LEFT JOIN ${ident(parent)} p ON p.id = c.${ident(child.column)}
      WHERE c.${ident(child.column)} IS NOT NULL AND p.id IS NULL`
  );
  return Number((rows as { n: number }[])[0].n);
}

export async function previewIdReset(): Promise<IdResetPreview[]> {
  const conn = await getPool().getConnection();
  try {
    // information_schema.tables caches AUTO_INCREMENT for a day by default.
    await conn.query("SET SESSION information_schema_stats_expiry = 0");
    const busy = new Set(await busyTables([...RESETTABLE_TABLES]));
    const out: IdResetPreview[] = [];
    for (const table of RESETTABLE_TABLES) {
      const { rows, maxId } = await countAndMax(conn, table);
      const [meta] = await conn.query(
        `SELECT t.auto_increment AS ai, c.column_type AS type FROM information_schema.tables t
           JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'id'
          WHERE t.table_schema = DATABASE() AND t.table_name = ?`,
        [table]
      );
      const m = (meta as { ai: number | null; type: string }[])[0];
      const idType = (m?.type ?? "int").replace(/\(\d+\)/, "");
      const next = m?.ai != null ? Number(m.ai) : maxId + 1;
      const children = await childForeignKeys(conn, table);
      const childInfo = [];
      for (const c of children) {
        const [r] = await conn.query(`SELECT COUNT(*) AS n FROM ${ident(c.table)}`);
        childInfo.push({ ...c, rows: Number((r as { n: number }[])[0].n) });
      }
      out.push({
        table, rows, maxId, nextAutoIncrement: m?.ai != null ? Number(m.ai) : null, idType,
        rangeUsedPct: Math.round((10000 * next) / (INT_MAX[idType] ?? INT_MAX.int)) / 100,
        method: children.length > 0 ? "in_place" : "swap",
        children: childInfo,
        busy: busy.has(table),
      });
    }
    return out;
  } finally {
    conn.release();
  }
}

/**
 * Renumbers `table`.id to 1..N in the current id order. Fails immediately
 * (TableLockBusyError) if a sync or another reset is working on the table.
 */
export async function resetTableIds(table: ResettableTable): Promise<IdResetResult> {
  if (!isResettableTable(table)) throw new Error(`${table} can't be reset`);
  return withTableLocks([table], async () => {
    const started = performance.now();
    const conn = await getPool().getConnection();
    let children: ChildFk[];
    let before: { rows: number; maxId: number };
    try {
      children = await childForeignKeys(conn, table);
      before = await countAndMax(conn, table);
    } finally {
      conn.release();
    }

    let childrenUpdated: IdResetResult["childrenUpdated"] = [];
    if (children.length === 0) {
      await swapInFreshTable(table, async (c, fresh) => {
        const cols = (await copyableColumns(c, table)).map(ident).join(", ");
        await c.query(`INSERT INTO ${ident(fresh)} (${cols}) SELECT ${cols} FROM ${ident(table)} ORDER BY id`);
      });
    } else {
      childrenUpdated = await renumberInPlace(table, children, before.maxId);
    }

    const check = await getPool().getConnection();
    try {
      const after = await countAndMax(check, table);
      if (after.rows !== before.rows) {
        throw new Error(`Row count changed during reset of ${table}: ${before.rows} -> ${after.rows}`);
      }
      // InnoDB never sets AUTO_INCREMENT below MAX(id) + 1, so this is safe.
      await check.query(`ALTER TABLE ${ident(table)} AUTO_INCREMENT = ${after.maxId + 1}`);
      return {
        table, method: children.length > 0 ? "in_place" : "swap", rows: after.rows,
        oldMaxId: before.maxId, newMaxId: after.maxId, childrenUpdated,
        ms: Math.round(performance.now() - started),
      };
    } finally {
      check.release();
    }
  }, { waitSeconds: 0 });
}

/**
 * Parent and child ids are rewritten in one transaction with foreign key
 * checks off for this connection only, through an old -> new id map. Each
 * column is moved in two steps — first to new id + offset (above every
 * current id), then down to the new id — so no UPDATE ever produces a value
 * another row still holds, which would trip the primary key or a child's
 * unique key. Orphans are counted before and after; any new orphan rolls the
 * whole thing back.
 */
async function renumberInPlace(table: string, children: ChildFk[], maxId: number): Promise<IdResetResult["childrenUpdated"]> {
  const conn = await getPool().getConnection();
  const offset = maxId + 1;
  const updated: IdResetResult["childrenUpdated"] = [];
  try {
    const orphansBefore = await Promise.all(children.map((c) => orphanCount(conn, table, c)));
    await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
    await conn.query("DROP TEMPORARY TABLE IF EXISTS id_reset_map");
    await conn.query("CREATE TEMPORARY TABLE id_reset_map (old_id BIGINT PRIMARY KEY, new_id BIGINT NOT NULL, UNIQUE KEY (new_id))");
    await conn.beginTransaction();
    try {
      // Lock every parent row for the rest of the transaction, then map them.
      await conn.query(`SELECT id FROM ${ident(table)} FOR UPDATE`);
      await conn.query(`INSERT INTO id_reset_map SELECT id, ROW_NUMBER() OVER (ORDER BY id) FROM ${ident(table)}`);

      const move = async (tbl: string, col: string): Promise<number> => {
        const [up] = await conn.query(
          `UPDATE ${ident(tbl)} x JOIN id_reset_map m ON x.${ident(col)} = m.old_id
              SET x.${ident(col)} = m.new_id + ${offset} WHERE m.old_id <> m.new_id`
        );
        await conn.query(
          `UPDATE ${ident(tbl)} x JOIN id_reset_map m ON x.${ident(col)} = m.new_id + ${offset}
              SET x.${ident(col)} = m.new_id WHERE m.old_id <> m.new_id`
        );
        return (up as { affectedRows: number }).affectedRows;
      };

      for (const c of children) updated.push({ ...c, rows: await move(c.table, c.column) });
      await move(table, "id");

      const orphansAfter = await Promise.all(children.map((c) => orphanCount(conn, table, c)));
      children.forEach((c, i) => {
        if (orphansAfter[i] > orphansBefore[i]) {
          throw new Error(`${c.table}.${c.column} would lose its parent row (${orphansAfter[i] - orphansBefore[i]} rows)`);
        }
      });
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    }
    return updated;
  } finally {
    await conn.query("DROP TEMPORARY TABLE IF EXISTS id_reset_map").catch(() => undefined);
    await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
    conn.release();
  }
}
