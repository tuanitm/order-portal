import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { ASSIGNABLE_ADMIN_PERMISSIONS, jsonCodeList, type RoleKind } from "@/lib/auth/adminSession";
import { masterdataWarehouseCodes } from "@/lib/adminWarehouses";
import { getBrandOptions } from "@/lib/adminScope";

export const ROLE_KINDS: RoleKind[] = ["super_admin", "admin", "sales", "account", "customer"];

/** The data-permission fields of a role, in DB column order. */
export const SCOPE_FIELDS = ["brands", "channels", "customer_groups", "item_groups", "warehouses"] as const;
type ScopeField = (typeof SCOPE_FIELDS)[number];
export type RoleScopeInput = Record<ScopeField, string[]>;

/** Must be filled for Admin and Sales roles (Super Admin sees everything; Customer has no data permissions). */
const REQUIRED_FOR_STAFF: ScopeField[] = ["brands", "channels", "customer_groups", "item_groups"];
const LABEL: Record<ScopeField, string> = {
  brands: "Brands", channels: "Channels", customer_groups: "Customer Groups", item_groups: "Product Groups", warehouses: "Warehouses",
};

/** What a role may be given: functions, and the codes each data permission accepts. */
export async function getRoleOptions() {
  const companyId = getCompanyId();
  const [brands, channels, customerGroups, itemGroups] = await Promise.all([
    // SAP Product Brand cost centers (dimension 1) within config's brandList.
    getBrandOptions(),
    query<{ code: string; name: string | null }[]>(`SELECT code, name FROM customer_groups WHERE company_id = ? AND level = 1 ORDER BY code`, [companyId]),
    query<{ code: string; name: string | null; level: number }[]>(`SELECT code, name, level FROM customer_groups WHERE company_id = ? ORDER BY level, code`, [companyId]),
    query<{ code: string; name: string | null; level: number }[]>(`SELECT code, name, level FROM item_groups WHERE company_id = ? ORDER BY level, code`, [companyId]),
  ]);
  return {
    permissions: ASSIGNABLE_ADMIN_PERMISSIONS,
    brands, channels, customerGroups, itemGroups,
    warehouses: masterdataWarehouseCodes(),
  };
}

function codes(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
}

/**
 * Validates and normalises a role's kind, functions and data permissions.
 * Super Admin: functions and data permissions are not stored (it has all).
 * Customer: no functions; data permissions optional. Admin / Sales:
 * functions from the assignable list; Brands, Channels, Customer Groups and
 * Product Groups required; every code must exist.
 */
export async function parseRoleDefinition(body: Record<string, unknown>): Promise<
  { ok: true; kind: RoleKind; permissions: string[]; scope: RoleScopeInput } | { ok: false; error: string }
> {
  const kind = String(body.kind ?? "") as RoleKind;
  if (!ROLE_KINDS.includes(kind)) return { ok: false, error: "kind must be one of super_admin, admin, sales, account, customer" };
  const empty: RoleScopeInput = { brands: [], channels: [], customer_groups: [], item_groups: [], warehouses: [] };
  if (kind === "super_admin") return { ok: true, kind, permissions: [], scope: empty };
  const isAccount = kind === "account";

  // Customer: no functions; data permissions optional (empty = no restriction — see customerRoleScope.ts).
  // Accountant: any assignable functions, and SO Approval always.
  const picked = kind === "customer" ? [] : codes(body.permissions).filter((p) => (ASSIGNABLE_ADMIN_PERMISSIONS as readonly string[]).includes(p));
  const permissions = isAccount && !picked.includes("so-approval") ? ["so-approval", ...picked] : picked;
  const raw = (body.scope ?? {}) as Record<string, unknown>;
  const scope = Object.fromEntries(SCOPE_FIELDS.map((f) => [f, codes(raw[f])])) as RoleScopeInput;
  // A Customer role's user is one SAP customer — no Customer Groups for it.
  if (kind === "customer") scope.customer_groups = [];

  // Accountant: Channels + Brands required — whose orders it approves and whose
  // AR it sees (SO Approval, AR Aging); Customer Groups (levels 1–3) optional
  // to narrow further. The rest only matter for the extra functions it's given.
  const required: ScopeField[] = kind === "customer" ? [] : isAccount ? ["channels", "brands"] : REQUIRED_FOR_STAFF;
  const missing = required.filter((f) => scope[f].length === 0);
  if (missing.length) return { ok: false, error: `${missing.map((f) => LABEL[f]).join(", ")} must be configured for ${kind === "sales" ? "a Sales" : isAccount ? "an Accountant" : "an Admin"} role` };

  const opts = await getRoleOptions();
  const known: Record<ScopeField, Set<string>> = {
    brands: new Set(opts.brands.map((b) => b.code)),
    channels: new Set(opts.channels.map((c) => c.code)),
    customer_groups: new Set(opts.customerGroups.map((c) => c.code)),
    item_groups: new Set(opts.itemGroups.map((c) => c.code)),
    warehouses: new Set(opts.warehouses),
  };
  for (const f of SCOPE_FIELDS) {
    const unknown = scope[f].filter((c) => !known[f].has(c));
    if (unknown.length) return { ok: false, error: `Unknown ${LABEL[f]}: ${unknown.join(", ")}` };
  }
  return { ok: true, kind, permissions, scope };
}

export interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  kind: RoleKind;
  permissions: string[];
  scope: RoleScopeInput;
  user_count: number;
  created_at: string;
}

export async function listRoles(): Promise<RoleRow[]> {
  const rows = await query<Record<string, unknown>[]>(
    `SELECT r.id, r.name, r.description, r.kind, r.permissions, r.brands, r.channels, r.customer_groups, r.item_groups, r.warehouses, r.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = r.company_id AND u.role_id = r.id)
              + (SELECT COUNT(*) FROM admin_users a WHERE a.company_id = r.company_id AND a.role_id = r.id) AS user_count
       FROM admin_roles r WHERE r.company_id = ?
      ORDER BY FIELD(r.kind, 'super_admin', 'admin', 'sales', 'account', 'customer'), r.name`,
    [getCompanyId()]
  );
  return rows.map((r) => ({
    id: Number(r.id), name: String(r.name), description: (r.description as string) ?? null, kind: r.kind as RoleKind,
    permissions: jsonCodeList(r.permissions),
    scope: Object.fromEntries(SCOPE_FIELDS.map((f) => [f, jsonCodeList(r[f])])) as RoleScopeInput,
    user_count: Number(r.user_count), created_at: String(r.created_at),
  }));
}
