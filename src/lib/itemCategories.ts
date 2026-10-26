import { getPool } from "@/lib/db/connection";
import { loadConfig, getCompanyId } from "@/lib/config";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { withTableLocks } from "@/lib/db/tableLock";

interface HanaItemGroupRow {
  ItemGrpCode1: string;
  ItemGrpName1: string | null;
  ItemGrpCode2: string;
  ItemGrpName2: string | null;
  ItemGrpCode3: string;
  ItemGrpName3: string | null;
  ItemGrpCode4: string;
  ItemGrpName4: string | null;
  ItemGrpCode5: string;
  ItemGrpName5: string | null;
  ItemGrpCode6: string;
  ItemGrpName6: string | null;
}

/**
 * Pull the ItemCat01->02->03->04->05->06 name hierarchy straight from SAP
 * HANA (the @AMDM_ID_ITEMCAT01..06 UDTs — Master-Data-type UDOs, same as
 * the Promotion and Customer Group tables, so SAP B1's own Query Generator
 * Authorization blocks them via Service Layer SQLQueries regardless of
 * grants; confirmed empirically, error 702 "not accessible") and upsert
 * into `item_groups` — the only sync path for this table (the
 * SAP_Item_Group.xlsx/itemgroup.json manual import that used to stand in
 * for this before HANA access was available has been removed).
 *
 * Upserts (ON DUPLICATE KEY UPDATE parent_code/name only) rather than a
 * full replace: `is_active` toggles
 * made on the admin page, and any group added manually there, must survive
 * a re-sync untouched.
 *
 * Scoped by config.json's masterdata.itemGroup (a ready-made SQL IN-list
 * literal, e.g. "'D1','L1'") — only level-1/2 groups matching it are
 * pulled. Every level is INNER-joined all the way to 6, same as the
 * source query — safe here because every item in this app's data has all
 * 6 category levels populated (verified against the live `items` table).
 */
export async function syncItemGroupsFromHana(): Promise<{ rowsRead: number; levelsImported: number }> {
  // Waits for an id reset of the same table to finish (see tableLock.ts).
  return withTableLocks(["item_groups"], () => syncItemGroupsFromHanaUnlocked());
}

async function syncItemGroupsFromHanaUnlocked(): Promise<{ rowsRead: number; levelsImported: number }> {
  const schema = getHanaSchema();
  const itemGroupFilter = loadConfig().masterdata.itemGroup;

  const sqlText = `SELECT
    T1."Code" "ItemGrpCode1", T1."Name" "ItemGrpName1",
    T2."Code" "ItemGrpCode2", T2."Name" "ItemGrpName2",
    T3."Code" "ItemGrpCode3", T3."Name" "ItemGrpName3",
    T4."Code" "ItemGrpCode4", T4."Name" "ItemGrpName4",
    T5."Code" "ItemGrpCode5", T5."Name" "ItemGrpName5",
    T6."Code" "ItemGrpCode6", T6."Name" "ItemGrpName6"
    FROM "${schema}"."@AMDM_ID_ITEMCAT06" T6
    INNER JOIN "${schema}"."@AMDM_ID_ITEMCAT05" T5 ON T6."U_ItemCat05"=T5."Code"
    INNER JOIN "${schema}"."@AMDM_ID_ITEMCAT04" T4 ON T5."U_ItemCat04"=T4."Code"
    INNER JOIN "${schema}"."@AMDM_ID_ITEMCAT03" T3 ON T4."U_ItemCat03"=T3."Code"
    INNER JOIN "${schema}"."@AMDM_ID_ITEMCAT02" T2 ON T3."U_ItemCat02"=T2."Code"
    INNER JOIN "${schema}"."@AMDM_ID_ITEMCAT01" T1 ON T2."U_ItemCat01"=T1."Code"
    WHERE T1."Code" IN (${itemGroupFilter}) OR T2."Code" IN (${itemGroupFilter})
    ORDER BY T1."Code",T2."Code",T3."Code",T4."Code",T5."Code",T6."Code"`;

  const rows = await queryHana<HanaItemGroupRow>(sqlText);

  let levelsImported = 0;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const row of rows) {
      // Every level is guaranteed present — INNER JOINs all the way down
      // mean a row without a complete 1->6 chain is never returned.
      const levels = [
        { code: row.ItemGrpCode1, name: row.ItemGrpName1 },
        { code: row.ItemGrpCode2, name: row.ItemGrpName2 },
        { code: row.ItemGrpCode3, name: row.ItemGrpName3 },
        { code: row.ItemGrpCode4, name: row.ItemGrpName4 },
        { code: row.ItemGrpCode5, name: row.ItemGrpName5 },
        { code: row.ItemGrpCode6, name: row.ItemGrpName6 },
      ];

      let parent: string | null = null;
      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        await conn.execute(
          `INSERT INTO item_groups (company_id, level, code, parent_code, name) VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE parent_code = VALUES(parent_code), name = VALUES(name)`,
          [getCompanyId(), i + 1, lvl.code.trim(), parent, lvl.name ? lvl.name.trim() : null]
        );
        levelsImported++;
        parent = lvl.code.trim();
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  return { rowsRead: rows.length, levelsImported };
}

export interface ItemCategoryPair {
  cat1: string;
  cat2: string;
}

interface ItemGroupRow {
  id: number;
  level: number;
  code: string;
  parent_code: string | null;
  name: string | null;
  is_active: number | boolean;
}

async function loadAllItemGroups(): Promise<ItemGroupRow[]> {
  const { query } = await import("@/lib/db/connection");
  return query<ItemGroupRow[]>(`SELECT id, level, code, parent_code, name, is_active FROM item_groups WHERE company_id = ?`, [getCompanyId()]);
}

/**
 * A group is only EFFECTIVELY active if it, and every one of its ancestors
 * up to level 1, is individually marked active — turning a parent group off
 * cascades "inactive" down to all of its descendants regardless of their
 * own is_active flag. Returns a Map keyed by "level:code" (levels can reuse
 * codes, so level is part of the key).
 */
function computeEffectiveActiveMap(rows: ItemGroupRow[]): Map<string, boolean> {
  const byKey = new Map(rows.map((r) => [`${r.level}:${r.code}`, r]));
  const cache = new Map<string, boolean>();

  function resolve(key: string): boolean {
    if (cache.has(key)) return cache.get(key)!;
    cache.set(key, true); // break cycles defensively; overwritten below
    const node = byKey.get(key);
    if (!node) return true;
    let result = !!node.is_active;
    if (result && node.parent_code) {
      result = resolve(`${node.level - 1}:${node.parent_code}`);
    }
    cache.set(key, result);
    return result;
  }

  const effective = new Map<string, boolean>();
  for (const r of rows) {
    const key = `${r.level}:${r.code}`;
    effective.set(key, resolve(key));
  }
  return effective;
}

/**
 * Every item_groups row annotated with:
 * - `effective_active`: its own is_active AND every ancestor's is_active.
 * - `ancestor_active`: whether its PARENT CHAIN (excluding itself) is active
 *   — used by the admin UI to label a group "(parent off)" even after its
 *   own toggle has been cascade-unticked (see cascadeDeactivateDescendants),
 *   so the reason it's off stays visible.
 */
export async function getItemGroupsWithEffectiveActive(): Promise<
  (ItemGroupRow & { effective_active: boolean; ancestor_active: boolean })[]
> {
  const rows = await loadAllItemGroups();
  const effective = computeEffectiveActiveMap(rows);
  return rows.map((r) => ({
    ...r,
    effective_active: effective.get(`${r.level}:${r.code}`) ?? true,
    ancestor_active: r.parent_code ? effective.get(`${r.level - 1}:${r.parent_code}`) ?? true : true,
  }));
}

/**
 * Recursively unticks (is_active = FALSE) every descendant of the given
 * item_groups row, at every level below it. Called whenever a group is
 * switched off, so children visibly reflect "inactive" too instead of
 * only being inactive by inheritance (see effective_active above).
 */
export async function cascadeDeactivateDescendants(rootId: number): Promise<void> {
  const rows = await loadAllItemGroups();
  const root = rows.find((r) => r.id === rootId);
  if (!root) return;

  const childrenByParentKey = new Map<string, ItemGroupRow[]>();
  for (const r of rows) {
    if (!r.parent_code) continue;
    const key = `${r.level - 1}:${r.parent_code}`;
    if (!childrenByParentKey.has(key)) childrenByParentKey.set(key, []);
    childrenByParentKey.get(key)!.push(r);
  }

  const descendantIds: number[] = [];
  const stack = [`${root.level}:${root.code}`];
  while (stack.length > 0) {
    const key = stack.pop()!;
    for (const child of childrenByParentKey.get(key) || []) {
      descendantIds.push(child.id);
      stack.push(`${child.level}:${child.code}`);
    }
  }

  if (descendantIds.length === 0) return;
  const { query } = await import("@/lib/db/connection");
  await query(
    `UPDATE item_groups SET is_active = FALSE WHERE company_id = ? AND id IN (${descendantIds.map(() => "?").join(",")})`,
    [getCompanyId(), ...descendantIds]
  );
}

export interface ItemGroupScanResult {
  checked: number;
  fixed: number;
  fixedGroups: { level: number; code: string; name: string | null }[];
}

/**
 * Enforce the parent/child Active rule across the whole item_groups table:
 * if a parent is inactive, every descendant MUST be inactive too (a child
 * under an ACTIVE parent may still be either active or inactive — that's
 * an independent admin choice, left untouched). This is a one-shot repair
 * for rows whose own is_active flag drifted out of sync with their parent
 * chain — e.g. data edited directly, imported before this rule existed, or
 * a parent that was toggled off before cascadeDeactivateDescendants existed.
 * Going forward, toggling a group off via the PATCH endpoint already keeps
 * this invariant live; this is for fixing up whatever predates that.
 */
export async function scanAndFixItemGroupActiveStatus(): Promise<ItemGroupScanResult> {
  const rows = await loadAllItemGroups();
  const effective = computeEffectiveActiveMap(rows);

  const toFix = rows.filter((r) => !!r.is_active && !effective.get(`${r.level}:${r.code}`));

  if (toFix.length > 0) {
    const { query } = await import("@/lib/db/connection");
    await query(
      `UPDATE item_groups SET is_active = FALSE WHERE company_id = ? AND id IN (${toFix.map(() => "?").join(",")})`,
      [getCompanyId(), ...toFix.map((r) => r.id)]
    );
  }

  return {
    checked: rows.length,
    fixed: toFix.length,
    fixedGroups: toFix.map((r) => ({ level: r.level, code: r.code, name: r.name })),
  };
}

/**
 * Apply many Active toggles in one go (the admin UI's "select several rows,
 * then Save once" flow, instead of one PATCH + page reload per row). Writes
 * every requested is_active value first, then runs the same parent/child
 * reconciliation as scanAndFixItemGroupActiveStatus() once at the end — so
 * regardless of what order the batch lists a parent and its children in,
 * the result always respects "parent inactive => every descendant inactive".
 */
export async function bulkSetItemGroupActive(
  changes: { id: number; isActive: boolean }[]
): Promise<{ applied: number; fixed: number }> {
  if (changes.length === 0) return { applied: 0, fixed: 0 };

  const companyId = getCompanyId();
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const c of changes) {
      // company_id in the WHERE isn't just consistency here — `id`s come
      // straight from the admin client's request body, so without it a
      // crafted id belonging to another company's row would be writable.
      await conn.execute(`UPDATE item_groups SET is_active = ? WHERE company_id = ? AND id = ?`, [c.isActive, companyId, c.id]);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  const scanResult = await scanAndFixItemGroupActiveStatus();
  return { applied: changes.length, fixed: scanResult.fixed };
}

/**
 * Get the (level-1, level-2) item group code pairs from the MySQL
 * `item_groups` table. This is the primary sync scope: only items whose
 * (U_ItemCat01, U_ItemCat02) matches one of these pairs get pulled from
 * SAP during item sync.
 *
 * Pairs are built by joining level-2 groups to their level-1 parents via
 * parent_code. A pair is dropped if either row — or any ancestor of
 * either row — is switched off (is_active = FALSE); that's how turning a
 * group off in the admin UI, at any level, stops new/updated master data
 * being synced for items under it.
 */
export async function getItemCategoryPairsFromDB(): Promise<ItemCategoryPair[]> {
  const rows = await loadAllItemGroups();
  const effective = computeEffectiveActiveMap(rows);
  const pairs: ItemCategoryPair[] = [];
  for (const r of rows) {
    if (r.level === 2 && r.parent_code && effective.get(`2:${r.code}`)) {
      pairs.push({ cat1: r.parent_code, cat2: r.code });
    }
  }
  return pairs;
}

/**
 * Codes of every EFFECTIVELY inactive item group, grouped by level (1-6) —
 * a group switched off directly, or one whose parent chain is switched off.
 * Used by syncItems() to also gate on levels 3-6 — which aren't part of the
 * SAP query scope (only level 1+2 are, via getItemCategoryPairsFromDB) — by
 * skipping/deactivating an item whose deeper category still points at a
 * group that's inactive, directly or via inheritance.
 */
export async function getInactiveItemGroupCodesByLevel(): Promise<Map<number, Set<string>>> {
  const rows = await loadAllItemGroups();
  const effective = computeEffectiveActiveMap(rows);
  const byLevel = new Map<number, Set<string>>();
  for (const r of rows) {
    if (!effective.get(`${r.level}:${r.code}`)) {
      if (!byLevel.has(r.level)) byLevel.set(r.level, new Set());
      byLevel.get(r.level)!.add(r.code);
    }
  }
  return byLevel;
}


