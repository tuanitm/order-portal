import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { jsonCodeList } from "@/lib/auth/adminSession";
import { expandToDescendantCodes, type GroupRow } from "@/lib/adminScope";

/**
 * Data permissions of a Customer role. Unlike Admin / Sales roles, an empty
 * list here means "no restriction" — a Customer role works with none set.
 *  - brands, itemGroups: which products the storefront lists and prices;
 *  - warehouses: the stock warehouses for availability (replaces the
 *    customer group's warehouse mapping when set);
 *  - channels: which SAP customers may be assigned to users of this role
 *    (checked when a user is saved).
 * (No Customer Groups: a Customer role's user is a single SAP customer.)
 */
export interface CustomerRoleScope {
  brands: string[];
  channels: string[];
  customerGroups: string[];
  itemGroups: string[];
  warehouses: string[];
}

const EMPTY: CustomerRoleScope = { brands: [], channels: [], customerGroups: [], itemGroups: [], warehouses: [] };

type ScopeRow = { brands: unknown; channels: unknown; customer_groups: unknown; item_groups: unknown; warehouses: unknown };
const toScope = (r: ScopeRow | null): CustomerRoleScope =>
  r
    ? {
        brands: jsonCodeList(r.brands), channels: jsonCodeList(r.channels), customerGroups: jsonCodeList(r.customer_groups),
        itemGroups: jsonCodeList(r.item_groups), warehouses: jsonCodeList(r.warehouses),
      }
    : EMPTY;

/** The data permissions of a storefront user's Customer role (empty when none / no role). */
export async function getCustomerRoleScope(userId: number | null | undefined): Promise<CustomerRoleScope> {
  if (!userId) return EMPTY;
  return toScope(
    await queryOne<ScopeRow>(
      `SELECT r.brands, r.channels, r.customer_groups, r.item_groups, r.warehouses
         FROM users u JOIN admin_roles r ON r.id = u.role_id AND r.kind = 'customer'
        WHERE u.company_id = ? AND u.id = ?`,
      [getCompanyId(), userId]
    )
  );
}

async function expandGroups(table: "item_groups" | "customer_groups", codes: string[]): Promise<Set<string>> {
  const rows = await query<GroupRow[]>(`SELECT id, level, code, parent_code FROM ${table} WHERE company_id = ?`, [getCompanyId()]);
  return expandToDescendantCodes(rows, new Set(rows.filter((r) => codes.includes(r.code)).map((r) => r.id)));
}

/**
 * Item filter for the storefront (alias `i` = items): the role's Brands and
 * Product Groups (a group includes its sub-groups). No clauses when unset.
 */
export async function customerItemScopeClauses(scope: CustomerRoleScope): Promise<{ clauses: string[]; params: string[] }> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope.brands.length) {
    clauses.push(`i.brand_code IN (${scope.brands.map(() => "?").join(",")})`);
    params.push(...scope.brands);
  }
  if (scope.itemGroups.length) {
    const codes = [...(await expandGroups("item_groups", scope.itemGroups))];
    if (codes.length === 0) {
      clauses.push("1=0");
    } else {
      const ph = codes.map(() => "?").join(",");
      const cols = ["i.item_cat01", "i.item_cat02", "i.item_cat03", "i.item_cat04", "i.item_cat05", "i.item_cat06"];
      clauses.push(`(${cols.map((c) => `${c} IN (${ph})`).join(" OR ")})`);
      cols.forEach(() => params.push(...codes));
    }
  }
  return { clauses, params };
}

/** Stock warehouses for a customer: the role's Warehouses when set, else the customer group's. */
export function customerStockWarehouses(scope: CustomerRoleScope, groupWarehouseCodes: string[]): string[] {
  return scope.warehouses.length ? scope.warehouses : groupWarehouseCodes;
}

/**
 * Whether a SAP customer (its cus_grp01) fits a Customer role's Channels. Returns an error message, or null when it fits.
 */
export async function checkCustomerFitsRole(
  roleId: number,
  customer: { sap_card_code: string; cus_grp01: string | null; cus_grp02: string | null; cus_grp03: string | null }
): Promise<string | null> {
  const scope = toScope(
    await queryOne<ScopeRow>(
      `SELECT brands, channels, customer_groups, item_groups, warehouses FROM admin_roles WHERE company_id = ? AND id = ? AND kind = 'customer'`,
      [getCompanyId(), roleId]
    )
  );
  if (scope.channels.length && !(customer.cus_grp01 && scope.channels.includes(customer.cus_grp01))) {
    return `SAP customer ${customer.sap_card_code} (channel ${customer.cus_grp01 || "none"}) is outside this role's Channels: ${scope.channels.join(", ")}`;
  }
  return null;
}
