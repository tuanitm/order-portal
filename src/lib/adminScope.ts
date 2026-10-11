import { query } from "@/lib/db/connection";
import type { AdminSession } from "@/lib/auth/adminSession";

/**
 * Per-admin data scoping — which Customer Groups / Item Groups a non-root
 * admin (an `admin_users` row; a root row — is_root=TRUE —
 * is always unrestricted) may see and manage, on the pages that deal in
 * that data directly: Customer Groups, Item Groups, Items, Customers
 * Approval, SAP Customers. See admin_user_customer_groups/
 * admin_user_item_groups in schema.sql for the assignment table and the
 * default-deny rule (no rows assigned = sees nothing, not "sees everything").
 *
 * Not yet applied to: Orders, Contract Discounts, Promotion Discounts,
 * Catalog Visibility, Price Lists, Warehouses — those either aren't scoped
 * by a single group field the same direct way, or weren't part of what was
 * asked for. A scoped admin currently sees those pages unrestricted (if
 * their role has the permission at all).
 */

export type AllowedCodes = Set<string> | null; // null = unrestricted (root)

interface GroupRow {
  id: number;
  level: number;
  code: string;
  parent_code: string | null;
}

/** Expand a set of assigned group ids to themselves + every descendant's code, via the level/parent_code hierarchy. */
function expandToDescendantCodes(allRows: GroupRow[], assignedIds: Set<number>): Set<string> {
  const byId = new Map(allRows.map((r) => [r.id, r]));
  const childrenByParentKey = new Map<string, GroupRow[]>(); // `${parentLevel}:${parentCode}` -> children
  for (const r of allRows) {
    if (!r.parent_code) continue;
    const key = `${r.level - 1}:${r.parent_code}`;
    if (!childrenByParentKey.has(key)) childrenByParentKey.set(key, []);
    childrenByParentKey.get(key)!.push(r);
  }

  const codes = new Set<string>();
  const queue: GroupRow[] = [];
  for (const id of assignedIds) {
    const row = byId.get(id);
    if (row) queue.push(row);
  }
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (codes.has(row.code)) continue; // already visited (codes aren't unique across levels, but fine to skip by code+level in practice — item/customer group codes are effectively unique per tree)
    codes.add(row.code);
    const children = childrenByParentKey.get(`${row.level}:${row.code}`) || [];
    queue.push(...children);
  }
  return codes;
}

/**
 * The set of customer_groups.code values a session may see/manage — every
 * level, since a customer's cus_grp01/02/03 can land on any of them.
 * null = unrestricted (root). Empty set = assigned nothing yet (sees/manages
 * no customers at all, by design — see the table's default-deny comment).
 */
export async function getAllowedCustomerGroupCodes(session: AdminSession): Promise<AllowedCodes> {
  if (session.isSuperAdmin || !session.adminId) return null;

  const assigned = await query<{ customer_group_id: number }[]>(
    `SELECT customer_group_id FROM admin_user_customer_groups WHERE admin_user_id = ?`,
    [session.adminId]
  );
  if (assigned.length === 0) return new Set();

  const allRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM customer_groups`);
  return expandToDescendantCodes(allRows, new Set(assigned.map((a) => a.customer_group_id)));
}

/** Same as getAllowedCustomerGroupCodes, for item_groups (levels 1-6). */
export async function getAllowedItemGroupCodes(session: AdminSession): Promise<AllowedCodes> {
  if (session.isSuperAdmin || !session.adminId) return null;

  const assigned = await query<{ item_group_id: number }[]>(
    `SELECT item_group_id FROM admin_user_item_groups WHERE admin_user_id = ?`,
    [session.adminId]
  );
  if (assigned.length === 0) return new Set();

  const allRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM item_groups`);
  return expandToDescendantCodes(allRows, new Set(assigned.map((a) => a.item_group_id)));
}

/**
 * SQL for "does this row's customer-group columns fall inside `codes`" —
 * `cols` are the row's own cus_grp01/02/03-style column names (qualify with
 * a table alias as needed). Returns `{ sql: "TRUE", params: [] }` when
 * `codes` is null (unrestricted) so callers can always just AND it in.
 * An empty Set correctly produces a clause that matches no row at all
 * (`1=0`), not "ignore this filter".
 */
export function groupScopeClause(codes: AllowedCodes, cols: string[]): { sql: string; params: string[] } {
  if (codes === null) return { sql: "TRUE", params: [] };
  if (codes.size === 0) return { sql: "1=0", params: [] };
  const list = [...codes];
  const placeholders = list.map(() => "?").join(",");
  const perCol = cols.map((c) => `${c} IN (${placeholders})`).join(" OR ");
  return { sql: `(${perCol})`, params: cols.flatMap(() => list) };
}

/**
 * True if any of a set of group codes (e.g. a customer's cus_grp01/02/03,
 * nulls ignored) falls in `codes`. null = unrestricted (root).
 */
export function inScope(codes: AllowedCodes, candidateCodes: (string | null | undefined)[]): boolean {
  if (codes === null) return true;
  return candidateCodes.some((c) => c && codes.has(c));
}
