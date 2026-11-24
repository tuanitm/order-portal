import { query, queryOne } from "@/lib/db/connection";
import { loadConfig, getCompanyId } from "@/lib/config";
import type { AdminSession } from "@/lib/auth/adminSession";

/**
 * Data permissions — which Customer Groups / Item Groups / Brands a staff
 * member may see and manage, inherited from their ROLE (Roles page → Data
 * permissions; see RoleScope in adminSession.ts). Super Admin is always
 * unrestricted. Default-deny: a role with nothing configured sees nothing.
 * Used on Customer Groups, Item Groups, Items, Customer Approval, SAP
 * Customers, Orders and the Self create dialog.
 *
 * For Orders:
 * - Superadmin sees all orders under config.json's `masterdata.customerGroup` (and descendants).
 * - Scoped (non-root) admin only sees orders under their assigned customer groups (and descendants).
 */

export type AllowedCodes = Set<string> | null; // null = unrestricted (root)

export interface GroupRow {
  id: number;
  level: number;
  code: string;
  parent_code: string | null;
}

/** Expand a set of assigned group ids to themselves + every descendant's code, via the level/parent_code hierarchy. */
export function expandToDescendantCodes(allRows: GroupRow[], assignedIds: Set<number>): Set<string> {
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
  if (session.isSuperAdmin) return null;
  const { channels, customerGroups } = session.scope;
  if (channels.length === 0 && customerGroups.length === 0) return new Set();

  const allRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM customer_groups WHERE company_id = ?`, [getCompanyId()]);
  const expand = (codes: string[]) => expandToDescendantCodes(allRows, new Set(allRows.filter((r) => codes.includes(r.code)).map((r) => r.id)));
  // Channels (level 1) and Customer Groups together: the groups, limited to those channels.
  if (channels.length === 0) return expand(customerGroups);
  if (customerGroups.length === 0) return expand(channels);
  const underChannels = expand(channels);
  return new Set([...expand(customerGroups)].filter((c) => underChannels.has(c)));
}

/** Same as getAllowedCustomerGroupCodes, for item_groups (levels 1-6) — the role's Product Groups. */
export async function getAllowedItemGroupCodes(session: AdminSession): Promise<AllowedCodes> {
  if (session.isSuperAdmin) return null;
  const codes = session.scope.itemGroups;
  if (codes.length === 0) return new Set();
  const allRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM item_groups WHERE company_id = ?`, [getCompanyId()]);
  return expandToDescendantCodes(allRows, new Set(allRows.filter((r) => codes.includes(r.code)).map((r) => r.id)));
}

/**
 * The portal's brands: config.json masterdata.brandList — SAP "Product Brand"
 * cost centers (OOCR / cost_centers dimension 1). null = not configured (no limit).
 */
export function getConfigBrandCodes(): string[] | null {
  const raw = loadConfig().masterdata.brandList;
  if (!raw || !raw.trim()) return null;
  const codes = raw.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
  return codes.length ? codes : null;
}

/**
 * The brands this user works with (items.brand_code / U_ProdBrand / OcrCode):
 * the role's Brands within config's brandList. System Admin = the whole
 * brandList (null = unrestricted only when no brandList is configured); empty = none.
 */
export function getAllowedBrandCodes(session: AdminSession): AllowedCodes {
  const portal = getConfigBrandCodes();
  if (session.isSuperAdmin) return portal ? new Set(portal) : null;
  return new Set(session.scope.brands.filter((c) => !portal || portal.includes(c)));
}

/**
 * Brand choices for filters / pickers: SAP Product Brand cost centers
 * (dimension 1) in brandList, in brandList order — narrowed to the user's
 * brands when a session is given. Names from SAP (e.g. D1 → PIGEON).
 */
export async function getBrandOptions(session?: AdminSession): Promise<{ code: string; name: string | null }[]> {
  const rows = await query<{ code: string; name: string | null; active: number }[]>(
    `SELECT ocr_code AS code, ocr_name AS name, is_active AS active FROM cost_centers WHERE company_id = ? AND dimension = 1 ORDER BY ocr_code`,
    [getCompanyId()]
  );
  const portal = getConfigBrandCodes();
  const allowed = session ? getAllowedBrandCodes(session) : null;
  const list = portal
    ? portal.map((code) => ({ code, name: rows.find((r) => r.code === code)?.name ?? null }))
    : rows.filter((r) => r.active).map((r) => ({ code: r.code, name: r.name }));
  return list.filter((b) => !allowed || allowed.has(b.code));
}

/** SQL for "this items row's brand is allowed" — `col` is the brand_code column (e.g. "i.brand_code"). */
export function brandScopeClause(codes: AllowedCodes, col: string): { sql: string; params: string[] } {
  if (codes === null) return { sql: "TRUE", params: [] };
  if (codes.size === 0) return { sql: "1=0", params: [] };
  return { sql: `${col} IN (${[...codes].map(() => "?").join(",")})`, params: [...codes] };
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

/**
 * Scoping for Orders:
 * - Superadmin sees all orders under config.json's `masterdata.customerGroup` (and all its descendants).
 * - Everyone else: orders under their role's Channels / Customer Groups (and descendants).
 * Returns a Set of allowed customer group codes, or an empty Set if no access.
 */
/** config.json masterdata.customerGroup (e.g. 'GT','MT') and every group under them — the company's channels. */
export async function getConfigCustomerGroupCodes(): Promise<Set<string>> {
  const { masterdata } = loadConfig();
  const configCodes = (masterdata.customerGroup || "").split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
  if (configCodes.length === 0) return new Set();
  const allRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM customer_groups WHERE company_id = ?`, [getCompanyId()]);
  return expandToDescendantCodes(allRows, new Set(allRows.filter((r) => configCodes.includes(r.code)).map((r) => r.id)));
}

/** config.json masterdata.itemGroup (e.g. 'D1','L1','A1','A2') — the company's level-1 product groups (brands). */
export function getConfigItemGroupCodes(): string[] {
  return (loadConfig().masterdata.itemGroup || "").split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
}

export async function getOrderAllowedCustomerGroupCodes(session: AdminSession): Promise<Set<string>> {
  const companyId = getCompanyId();
  const allRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM customer_groups WHERE company_id = ?`, [companyId]);

  if (session.isSuperAdmin) {
    const { masterdata } = loadConfig();
    const configCodes = (masterdata.customerGroup || "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);

    if (configCodes.length === 0) return new Set();

    const matchingIds = new Set(
      allRows.filter((r) => configCodes.includes(r.code)).map((r) => r.id)
    );
    return expandToDescendantCodes(allRows, matchingIds);
  }

  // Everyone else: their role's Channels / Customer Groups.
  return (await getAllowedCustomerGroupCodes(session)) ?? new Set();
}

/**
 * SQL clause for filtering orders by customer groups (checks COALESCE(c.cus_grp0X, u.sap_cus_grp0X)).
 */
export function orderGroupScopeClause(codes: Set<string>): { sql: string; params: string[] } {
  return groupScopeClause(codes, [
    "COALESCE(c.cus_grp01, u.sap_cus_grp01)",
    "COALESCE(c.cus_grp02, u.sap_cus_grp02)",
    "COALESCE(c.cus_grp03, u.sap_cus_grp03)",
  ]);
}

/**
 * Checks whether an existing order is within the admin's customer group scope.
 */
export async function isOrderInAdminScope(session: AdminSession, orderId: number): Promise<boolean> {
  const allowed = await getOrderAllowedCustomerGroupCodes(session);
  if (allowed.size === 0) return false;

  const companyId = getCompanyId();
  const order = await queryOne<{ grp01: string | null; grp02: string | null; grp03: string | null }>(
    `SELECT COALESCE(c.cus_grp01, u.sap_cus_grp01) AS grp01,
            COALESCE(c.cus_grp02, u.sap_cus_grp02) AS grp02,
            COALESCE(c.cus_grp03, u.sap_cus_grp03) AS grp03
     FROM orders o
     LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id
     LEFT JOIN customers c ON c.company_id = o.company_id AND c.sap_card_code = COALESCE(o.sap_card_code, u.sap_card_code)
     WHERE o.company_id = ? AND o.id = ?`,
    [companyId, orderId]
  );
  if (!order) return false;

  return inScope(allowed, [order.grp01, order.grp02, order.grp03]);
}

/**
 * Scoping for Customer Approval:
 * - Superadmin sees and approves customer requests from config.json's `masterdata.customerGroup` (and descendants).
 * - Scoped (non-root) admin only sees and approves requests from their assigned customer groups (and descendants).
 * Returns a Set of allowed customer group codes, or an empty Set if no access.
 */
export async function getCustomerApprovalAllowedGroupCodes(session: AdminSession): Promise<Set<string>> {
  return getOrderAllowedCustomerGroupCodes(session);
}

/**
 * Checks whether a customer registration request is within the admin's customer group scope for approval/rejection.
 *
 * A brand-new-company registration (see POST /api/admin/customers/[id]/create-bp)
 * has no REAL group signal at all until an admin assigns one — there's no
 * `sap_card_code` to prefix-match and no cus_grp0X anywhere, so the normal
 * group-based scoping has nothing to go on. Root always sees these. A
 * non-root admin sees one only if its `declared_region_code` — the
 * customer's own unverified self-declared region, collected at signup —
 * falls within their assigned scope; this is a routing HINT, not a
 * security boundary (the customer could have picked wrong), so root
 * remains the fallback for anything mis-routed. Once a group is assigned
 * on approval, the row falls under the normal scoping like any other
 * customer.
 */
export async function isCustomerInApprovalScope(
  session: AdminSession,
  customer: {
    sap_cus_grp01?: string | null;
    sap_cus_grp02?: string | null;
    sap_cus_grp03?: string | null;
    cus_grp01?: string | null;
    cus_grp02?: string | null;
    cus_grp03?: string | null;
    sap_card_code?: string | null;
    declared_region_code?: string | null;
  }
): Promise<boolean> {
  const candidateCodes = [
    customer.sap_cus_grp01,
    customer.sap_cus_grp02,
    customer.sap_cus_grp03,
    customer.cus_grp01,
    customer.cus_grp02,
    customer.cus_grp03,
  ].filter(Boolean);

  if (candidateCodes.length === 0 && !customer.sap_card_code) {
    if (session.isSuperAdmin) return true;
    if (!customer.declared_region_code) return false;
    const allowed = await getCustomerApprovalAllowedGroupCodes(session);
    return allowed.has(customer.declared_region_code);
  }

  const allowed = await getCustomerApprovalAllowedGroupCodes(session);
  if (allowed.size === 0) return false;

  if (candidateCodes.some((c) => c && allowed.has(c))) {
    return true;
  }

  if (customer.sap_card_code) {
    for (const code of allowed) {
      if (customer.sap_card_code.startsWith(code)) return true;
    }
  }

  return false;
}

/**
 * Resolves allowed customer groups and item groups for Promotion Discounts.
 * - Non-root admin: strictly scoped to assigned Customer Groups and Item Groups.
 * - Superadmin: scoped to config.json's masterdata.customerGroup and masterdata.itemGroup (if set).
 */
export async function getPromotionAllowedGroups(session: AdminSession): Promise<{
  customerGroupCodes: Set<string> | null;
  itemGroupCodes: Set<string> | null;
}> {
  if (session.isSuperAdmin) {
    const { masterdata } = loadConfig();
    const companyId = getCompanyId();
    let customerGroupCodes: Set<string> | null = null;
    let itemGroupCodes: Set<string> | null = null;

    if (masterdata.customerGroup) {
      const configCodes = masterdata.customerGroup
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .filter(Boolean);
      if (configCodes.length > 0) {
        const allCustRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM customer_groups WHERE company_id = ?`, [companyId]);
        const matchingIds = new Set(allCustRows.filter((r) => configCodes.includes(r.code)).map((r) => r.id));
        customerGroupCodes = expandToDescendantCodes(allCustRows, matchingIds);
        for (const c of configCodes) customerGroupCodes.add(c);
      }
    }

    if (masterdata.itemGroup) {
      const configItemCodes = masterdata.itemGroup
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, "").replace(/^"|"$/g, ""))
        .filter(Boolean);
      if (configItemCodes.length > 0) {
        const allItemRows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM item_groups WHERE company_id = ?`, [companyId]);
        const matchingIds = new Set(allItemRows.filter((r) => configItemCodes.includes(r.code)).map((r) => r.id));
        itemGroupCodes = expandToDescendantCodes(allItemRows, matchingIds);
        for (const c of configItemCodes) itemGroupCodes.add(c);
      }
    }

    return { customerGroupCodes, itemGroupCodes };
  }

  // Non-root admin user: strictly scoped by their assignments
  const customerGroupCodes = await getAllowedCustomerGroupCodes(session);
  const itemGroupCodes = await getAllowedItemGroupCodes(session);
  return { customerGroupCodes, itemGroupCodes };
}

/**
 * Builds the WHERE condition for matching promotion_discount rows against
 * allowed customer groups and item groups.
 */
export async function buildPromotionScopeFilter(
  customerGroupCodes: Set<string> | null,
  itemGroupCodes: Set<string> | null
): Promise<{ sql: string; params: (string | number)[] }> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const companyId = getCompanyId();

  // Customer Group filter
  if (customerGroupCodes !== null) {
    if (customerGroupCodes.size === 0) {
      return { sql: "1=0", params: [] };
    }
    const custCodes = [...customerGroupCodes];

    // Find all customers in MySQL belonging to these groups
    const custPlaceholders = custCodes.map(() => "?").join(",");
    const custRows = await query<{ sap_card_code: string }[]>(
      `SELECT sap_card_code FROM customers
       WHERE company_id = ?
         AND (cus_grp01 IN (${custPlaceholders})
          OR cus_grp02 IN (${custPlaceholders})
          OR cus_grp03 IN (${custPlaceholders}))`,
      [companyId, ...custCodes, ...custCodes, ...custCodes]
    );

    const bpCodes = new Set<string>([...custCodes, ...custRows.map((r) => r.sap_card_code)]);
    const bpList = [...bpCodes];
    const bpPlaceholders = bpList.map(() => "?").join(",");

    // Use minimal root prefixes to keep the query fast (e.g. 'GTNO%')
    const rootCustPrefixes = custCodes.filter(
      (c) => !custCodes.some((other) => other !== c && c.startsWith(other))
    );
    const prefixClauses = rootCustPrefixes.map(() => "bp_code LIKE ?").join(" OR ");
    const prefixParams = rootCustPrefixes.map((c) => `${c}%`);

    clauses.push(`(bp_code IS NULL OR bp_code IN (${bpPlaceholders}) OR ${prefixClauses})`);
    params.push(...bpList, ...prefixParams);
  }

  // Item Group filter
  if (itemGroupCodes !== null) {
    if (itemGroupCodes.size === 0) {
      return { sql: "1=0", params: [] };
    }
    const itemCodes = [...itemGroupCodes];

    // Find all items in MySQL belonging to these groups
    const itemPlaceholders = itemCodes.map(() => "?").join(",");
    const itemRows = await query<{ sap_item_code: string }[]>(
      `SELECT sap_item_code FROM items
       WHERE company_id = ?
         AND (item_cat01 IN (${itemPlaceholders})
          OR item_cat02 IN (${itemPlaceholders})
          OR item_cat03 IN (${itemPlaceholders})
          OR item_cat04 IN (${itemPlaceholders})
          OR item_cat05 IN (${itemPlaceholders})
          OR item_cat06 IN (${itemPlaceholders}))`,
      [companyId, ...itemCodes, ...itemCodes, ...itemCodes, ...itemCodes, ...itemCodes, ...itemCodes]
    );

    const validItemCodes = new Set<string>([...itemCodes, ...itemRows.map((r) => r.sap_item_code)]);
    const validItemList = [...validItemCodes];
    const validItemPlaceholders = validItemList.map(() => "?").join(",");

    // Group code direct match placeholders
    const groupPlaceholders = itemCodes.map(() => "?").join(",");

    // Use minimal root prefixes to keep the query fast (e.g. 'D1%', 'L1%')
    const rootItemPrefixes = itemCodes.filter(
      (c) => !itemCodes.some((other) => other !== c && c.startsWith(other))
    );
    const itemPrefixClauses = rootItemPrefixes.map(() => "selling_item_code LIKE ?").join(" OR ");
    const itemPrefixParams = rootItemPrefixes.map((c) => `${c}%`);

    clauses.push(
      `(selling_item_code IN (${validItemPlaceholders}) OR selling_grp_code IN (${groupPlaceholders}) OR ${itemPrefixClauses})`
    );
    params.push(...validItemList, ...itemCodes, ...itemPrefixParams);
  }

  if (clauses.length === 0) {
    return { sql: "1=1", params: [] };
  }

  return {
    sql: clauses.join(" AND "),
    params,
  };
}


/**
 * SQL for "this order is in the role's Brands": a sold (non-gift) line whose
 * item brand is allowed — an order is one brand (checkout brand split).
 * `orderAlias` is the orders table alias. null = unrestricted.
 */
export function orderBrandScopeClause(codes: AllowedCodes, orderAlias = "o"): { sql: string; params: string[] } {
  if (codes === null) return { sql: "TRUE", params: [] };
  if (codes.size === 0) return { sql: "1=0", params: [] };
  const list = [...codes];
  return {
    sql: `EXISTS (SELECT 1 FROM order_lines bl JOIN items bi ON bi.company_id = bl.company_id AND bi.sap_item_code = bl.sap_item_code
      WHERE bl.company_id = ${orderAlias}.company_id AND bl.order_id = ${orderAlias}.id AND bl.is_gift_line = 0
        AND bi.brand_code IN (${list.map(() => "?").join(",")}))`,
    params: list,
  };
}

/**
 * SO Approval scope: the order's customer in the role's Channels / Customer
 * Groups (levels 1–3, see isOrderInAdminScope) AND the order's brand in the
 * role's Brands.
 */
export async function isOrderInApprovalScope(session: AdminSession, orderId: number): Promise<boolean> {
  if (!(await isOrderInAdminScope(session, orderId))) return false;
  const brand = orderBrandScopeClause(getAllowedBrandCodes(session));
  if (brand.sql === "TRUE") return true;
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM orders o WHERE o.company_id = ? AND o.id = ? AND ${brand.sql}`,
    [getCompanyId(), orderId, ...brand.params]
  );
  return !!row;
}
