import { getPool } from "@/lib/db/connection";
import { loadConfig, getCompanyId } from "@/lib/config";
import { queryHana, getHanaSchema } from "@/lib/hana/client";

interface HanaCustomerGroupRow {
  CustGrpCode1: string;
  CustGrpName1: string | null;
  CustGrpCode2: string;
  CustGrpName2: string | null;
  CustGrpCode3: string;
  CustGrpName3: string | null;
}

/**
 * Pull the CustGrp01->02->03 name hierarchy straight from SAP HANA (the
 * @AMDM_CD_CUSGRP01/02/03 UDTs — Master-Data-type UDOs, same as the
 * Promotion tables, so SAP B1's own Query Generator Authorization blocks
 * them via Service Layer SQLQueries regardless of grants; confirmed
 * empirically, error 702 "not accessible") and upsert into
 * `customer_groups` — the only sync path for this table (the
 * SAP_Customer_Group.xlsx/custgroup.json manual import that used to stand
 * in for this before HANA access was available has been removed).
 *
 * Upserts (ON DUPLICATE KEY UPDATE parent_code/name only) rather than a
 * full replace: `is_active` toggles
 * made on the admin page, and any group added manually there, must survive
 * a re-sync untouched.
 *
 * Scoped by config.json's masterdata.customerGroup (a ready-made SQL IN-list
 * literal, e.g. "'GT'") — only level-1/2 groups matching it are pulled.
 */
export async function syncCustomerGroupsFromHana(): Promise<{ rowsRead: number; levelsImported: number }> {
  const schema = getHanaSchema();
  const customerGroupFilter = loadConfig().masterdata.customerGroup;

  const sqlText = `SELECT T1."Code" "CustGrpCode1", T1."Name" "CustGrpName1", T2."Code" "CustGrpCode2", T2."Name" "CustGrpName2", T3."Code" "CustGrpCode3", T3."Name" "CustGrpName3" FROM "${schema}"."@AMDM_CD_CUSGRP03" T3 INNER JOIN "${schema}"."@AMDM_CD_CUSGRP02" T2 ON T3."U_CusGrp02"=T2."Code" INNER JOIN "${schema}"."@AMDM_CD_CUSGRP01" T1 ON T2."U_CusGrp01"=T1."Code" WHERE T1."Code" IN (${customerGroupFilter}) OR T2."Code" IN (${customerGroupFilter}) ORDER BY T1."Code",T2."Code",T3."Code"`;

  const rows = await queryHana<HanaCustomerGroupRow>(sqlText);

  let levelsImported = 0;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const row of rows) {
      // Every level is guaranteed present — INNER JOINs all the way down
      // mean a row without a complete 1->2->3 chain is never returned.
      const levels = [
        { code: row.CustGrpCode1, name: row.CustGrpName1 },
        { code: row.CustGrpCode2, name: row.CustGrpName2 },
        { code: row.CustGrpCode3, name: row.CustGrpName3 },
      ];

      let parent: string | null = null;
      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        await conn.execute(
          `INSERT INTO customer_groups (company_id, level, code, parent_code, name) VALUES (?, ?, ?, ?, ?)
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

export interface CustomerGroupPair {
  cat1: string;
  cat2: string;
}

interface CustomerGroupRow {
  id: number;
  level: number;
  code: string;
  parent_code: string | null;
  name: string | null;
  is_active: number | boolean;
}

async function loadAllCustomerGroups(): Promise<CustomerGroupRow[]> {
  const { query } = await import("@/lib/db/connection");
  return query<CustomerGroupRow[]>(`SELECT id, level, code, parent_code, name, is_active FROM customer_groups WHERE company_id = ?`, [getCompanyId()]);
}

/**
 * A group is only EFFECTIVELY active if it, and every one of its ancestors
 * up to level 1, is individually marked active. Returns a Map keyed by
 * "level:code" (levels can reuse codes, so level is part of the key).
 */
function computeEffectiveActiveMap(rows: CustomerGroupRow[]): Map<string, boolean> {
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
 * Every customer_groups row annotated with:
 * - `effective_active`: its own is_active AND every ancestor's is_active.
 * - `ancestor_active`: whether its parent chain (excluding itself) is active
 *   — used by the admin UI to label a group "(parent off)".
 */
export async function getCustomerGroupsWithEffectiveActive(): Promise<
  (CustomerGroupRow & { effective_active: boolean; ancestor_active: boolean })[]
> {
  const rows = await loadAllCustomerGroups();
  const effective = computeEffectiveActiveMap(rows);
  return rows.map((r) => ({
    ...r,
    effective_active: effective.get(`${r.level}:${r.code}`) ?? true,
    ancestor_active: r.parent_code ? effective.get(`${r.level - 1}:${r.parent_code}`) ?? true : true,
  }));
}

/**
 * Recursively sets is_active on every descendant of the given customer_groups
 * row to match `isActive` — UNLIKE item_groups' cascade (which only cascades
 * OFF), this cascades in BOTH directions: switching a group active re-ticks
 * all of its children too, and switching it off unticks them, mirroring the
 * parent's state exactly at every level below it.
 */
export async function cascadeSetActiveDescendants(rootId: number, isActive: boolean): Promise<void> {
  const rows = await loadAllCustomerGroups();
  const root = rows.find((r) => r.id === rootId);
  if (!root) return;

  const childrenByParentKey = new Map<string, CustomerGroupRow[]>();
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
    `UPDATE customer_groups SET is_active = ? WHERE company_id = ? AND id IN (${descendantIds.map(() => "?").join(",")})`,
    [isActive, getCompanyId(), ...descendantIds]
  );
}

/**
 * Walks the parent_code chain up from a level-3 customer group code to
 * resolve its level-1/level-2 ancestors — used to derive U_CusGrp01/02 from
 * an admin-picked U_CusGrp03 when creating a new SAP Business Partner (see
 * POST /api/admin/customers/[id]/create-bp). No existing helper does this;
 * getCustomerGroupPairsFromDB only returns (level-1, level-2) pairs.
 */
export async function getCustomerGroupAncestors(
  level3Code: string
): Promise<{ level1Code: string; level2Code: string } | null> {
  const rows = await loadAllCustomerGroups();
  const byKey = new Map(rows.map((r) => [`${r.level}:${r.code}`, r]));
  const level3 = byKey.get(`3:${level3Code}`);
  if (!level3 || !level3.parent_code) return null;
  const level2 = byKey.get(`2:${level3.parent_code}`);
  if (!level2 || !level2.parent_code) return null;
  return { level1Code: level2.parent_code, level2Code: level2.code };
}

/**
 * Get the (level-1, level-2) customer group code pairs from the MySQL
 * `customer_groups` table. This is the primary sync scope: only customers
 * whose (U_CusGrp01, U_CusGrp02) matches one of these pairs get pulled
 * from SAP during customer sync. A pair is dropped if either row — or any
 * ancestor of either row — is switched off (is_active = FALSE).
 */
export async function getCustomerGroupPairsFromDB(): Promise<CustomerGroupPair[]> {
  const rows = await loadAllCustomerGroups();
  const effective = computeEffectiveActiveMap(rows);
  const pairs: CustomerGroupPair[] = [];
  for (const r of rows) {
    if (r.level === 2 && r.parent_code && effective.get(`2:${r.code}`)) {
      pairs.push({ cat1: r.parent_code, cat2: r.code });
    }
  }
  return pairs;
}

