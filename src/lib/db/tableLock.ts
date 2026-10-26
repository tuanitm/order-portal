import { AsyncLocalStorage } from "async_hooks";
import { getPool } from "@/lib/db/connection";

/**
 * Server-wide "someone is rewriting this table" locks, built on MySQL named
 * locks (GET_LOCK) rather than an in-process flag: the IMV and ADS portals
 * share one database, so a lock must be visible to every app instance.
 *
 * Taken by every SAP/HANA sync that rewrites one of the id-resettable tables
 * (see RESETTABLE_TABLES in idReset.ts) and by the id reset itself, so a sync
 * can never insert rows into a table while its ids are being renumbered.
 *
 * A named lock belongs to the MySQL connection that took it, so the lock is
 * held on its own pooled connection for the whole of `fn`. Locks already held
 * further up the same async call chain are re-used, never re-acquired — a
 * second GET_LOCK from a different pooled connection would wait on itself.
 */
const heldLocks = new AsyncLocalStorage<Set<string>>();

export class TableLockBusyError extends Error {
  constructor(public readonly tables: string[]) {
    super(`Another sync or id reset is already working on: ${tables.join(", ")}`);
    this.name = "TableLockBusyError";
  }
}

function lockName(table: string): string {
  // MySQL caps lock names at 64 characters.
  return `order_portal:table:${table}`.slice(0, 64);
}

/**
 * Runs `fn` while holding the lock for every table in `tables`. Waits up to
 * `waitSeconds` for each lock (0 = fail immediately if busy) and throws
 * TableLockBusyError when one can't be had. Tables are locked in sorted order
 * so two callers wanting overlapping sets can't deadlock each other.
 */
export async function withTableLocks<T>(
  tables: string[],
  fn: () => Promise<T>,
  { waitSeconds = 600 }: { waitSeconds?: number } = {}
): Promise<T> {
  const alreadyHeld = heldLocks.getStore() ?? new Set<string>();
  const needed = [...new Set(tables)].filter((t) => !alreadyHeld.has(t)).sort();
  if (needed.length === 0) return fn();

  const conn = await getPool().getConnection();
  const acquired: string[] = [];
  try {
    for (const table of needed) {
      const [rows] = await conn.query("SELECT GET_LOCK(?, ?) AS ok", [lockName(table), waitSeconds]);
      if ((rows as { ok: number | null }[])[0]?.ok !== 1) throw new TableLockBusyError([table]);
      acquired.push(table);
    }
    return await heldLocks.run(new Set([...alreadyHeld, ...acquired]), fn);
  } finally {
    for (const table of acquired) {
      await conn.query("SELECT RELEASE_LOCK(?)", [lockName(table)]).catch(() => undefined);
    }
    conn.release();
  }
}

/** Tables (from `tables`) whose lock some connection currently holds. */
export async function busyTables(tables: string[]): Promise<string[]> {
  if (tables.length === 0) return [];
  const [rows] = await getPool().query(
    `SELECT ${tables.map(() => "IS_USED_LOCK(?)").join(", ")}`,
    tables.map(lockName)
  );
  const values = Object.values((rows as Record<string, number | null>[])[0]);
  return tables.filter((_, i) => values[i] !== null);
}
