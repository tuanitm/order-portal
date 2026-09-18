import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getPool } from "@/lib/db/connection";

export interface ImportWarning {
  index: number;
  message: string;
}

export interface ImportResult {
  rowsRead: number;
  levelsImported: number;
  warnings: ImportWarning[];
}

/**
 * Import item_groups codes/names from `SAP_Item_Group.xlsx` at the project
 * root — the ItemCat01-06 master tables aren't reachable via SAP Service
 * Layer, so this Excel file is the authoritative source for names.
 * Falls back to the legacy `itemgroup.json` if the xlsx is not present.
 */
export async function importItemCategoriesFromFile(): Promise<ImportResult> {
  const xlsxPath = join(process.cwd(), "SAP_Item_Group.xlsx");

  if (existsSync(xlsxPath)) {
    return importFromXlsx(xlsxPath);
  }

  // Legacy fallback: itemgroup.json via the generic hierarchy importer
  const { importHierarchyFromFile } = await import("@/lib/hierarchyImport");
  return importHierarchyFromFile({
    fileName: "itemgroup.json",
    listKey: "itemGrpList",
    fieldPrefix: "itemgrp",
    tableName: "item_groups",
    maxLevels: 6,
  });
}

/**
 * Read SAP_Item_Group.xlsx and upsert into item_groups.
 * Expected columns: ITEMGRPCODE1..6, ITEMGRPNAME1..6
 */
async function importFromXlsx(filePath: string): Promise<ImportResult> {
  // require() instead of dynamic import — xlsx is a CJS module and
  // `await import("xlsx")` can lose exports under Next.js bundling.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, string | number | undefined>[] = XLSX.utils.sheet_to_json(sheet);

  const warnings: ImportWarning[] = [];
  let levelsImported = 0;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const levels: { code?: string | number; name?: string | number }[] = [];
      for (let i = 1; i <= 6; i++) {
        levels.push({ code: row[`ITEMGRPCODE${i}`], name: row[`ITEMGRPNAME${i}`] });
      }

      let parent: string | null = null;
      let sawGap = false;

      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        const level = i + 1;

        if (!lvl.code) {
          if (levels.slice(i + 1).some((l) => l.code)) {
            warnings.push({
              index,
              message: `Row ${index}: level ${level} code is missing but a deeper level is present — chain broken from here`,
            });
          }
          sawGap = true;
          continue;
        }
        if (sawGap) continue;

        if (!lvl.name) {
          warnings.push({ index, message: `Row ${index}: level ${level} code "${lvl.code}" has no name` });
        }

        await conn.execute(
          `INSERT INTO item_groups (level, code, parent_code, name) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE parent_code = VALUES(parent_code), name = VALUES(name)`,
          [level, String(lvl.code).trim(), parent, lvl.name ? String(lvl.name).trim() : null]
        );
        levelsImported++;
        parent = String(lvl.code).trim();
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  return { rowsRead: rows.length, levelsImported, warnings };
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
  return query<ItemGroupRow[]>(`SELECT id, level, code, parent_code, name, is_active FROM item_groups`);
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
    `UPDATE item_groups SET is_active = FALSE WHERE id IN (${descendantIds.map(() => "?").join(",")})`,
    descendantIds
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
      `UPDATE item_groups SET is_active = FALSE WHERE id IN (${toFix.map(() => "?").join(",")})`,
      toFix.map((r) => r.id)
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

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const c of changes) {
      await conn.execute(`UPDATE item_groups SET is_active = ? WHERE id = ?`, [c.isActive, c.id]);
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

/**
 * The exact (level-1, level-2) code pairs from SAP_Item_Group.xlsx —
 * legacy fallback for sync scope. Prefer getItemCategoryPairsFromDB().
 */
export function getItemCategoryPairsFromFile(): ItemCategoryPair[] {
  const xlsxPath = join(process.cwd(), "SAP_Item_Group.xlsx");

  if (existsSync(xlsxPath)) {
    return getItemCategoryPairsFromXlsx(xlsxPath);
  }

  // Legacy fallback: itemgroup.json
  return getItemCategoryPairsFromJson();
}

function getItemCategoryPairsFromXlsx(filePath: string): ItemCategoryPair[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, string | number | undefined>[] = XLSX.utils.sheet_to_json(sheet);

  const pairs = new Map<string, ItemCategoryPair>();
  for (const row of rows) {
    const cat1 = row.ITEMGRPCODE1;
    const cat2 = row.ITEMGRPCODE2;
    if (cat1 && cat2) {
      pairs.set(`${cat1}|${cat2}`, { cat1: String(cat1).trim(), cat2: String(cat2).trim() });
    }
  }
  return [...pairs.values()];
}

function getItemCategoryPairsFromJson(): ItemCategoryPair[] {
  const filePath = join(process.cwd(), "itemgroup.json");
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf-8");
  let data: { itemGrpList?: Record<string, string | undefined>[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data.itemGrpList)) return [];

  const pairs = new Map<string, ItemCategoryPair>();
  for (const entry of data.itemGrpList) {
    const cat1 = entry.itemgrpcode1;
    const cat2 = entry.itemgrpcode2;
    if (cat1 && cat2) pairs.set(`${cat1}|${cat2}`, { cat1, cat2 });
  }
  return [...pairs.values()];
}

