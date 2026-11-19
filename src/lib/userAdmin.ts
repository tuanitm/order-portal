import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import type { RoleKind } from "@/lib/auth/adminSession";

/**
 * Shared rules of the Users page (POST/PATCH /api/admin/users): one user =
 * one role; data permissions come from the role.
 *
 * Two tables: STAFF (Super Admin / Admin / Sales) live in `admin_users`,
 * CUSTOMERS in `users`. userid and email are each unique per company across
 * BOTH tables (case-insensitive) — the one login screen finds an account by
 * them. A Customer-role user must be linked to a SAP customer (sap_card_code)
 * — that's whose storefront prices they see and whose orders they place.
 * Staff need a userid.
 */
export type AccountTable = "staff" | "customer";

/** Which table an account of this role kind lives in. */
export function accountTableForKind(kind: RoleKind): AccountTable {
  return kind === "customer" ? "customer" : "staff";
}

export const USERID_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;

export async function getRoleKind(roleId: number): Promise<RoleKind | null> {
  const row = await queryOne<{ kind: RoleKind }>(`SELECT kind FROM admin_roles WHERE company_id = ? AND id = ?`, [getCompanyId(), roleId]);
  return row?.kind ?? null;
}

/**
 * Another account already using this userid / email (checked in BOTH tables)
 * or SAP customer code (customers only)? Case-insensitive. `except` is the
 * account being edited, so it doesn't clash with itself.
 */
export async function findClash(
  field: "userid" | "email" | "sap_card_code",
  value: string,
  except: { table: AccountTable; id: number } | null
): Promise<boolean> {
  const companyId = getCompanyId();
  const skip = (table: AccountTable) => (except && except.table === table ? except.id : 0);
  const customer = await queryOne<{ id: number }>(
    `SELECT u.id FROM users u LEFT JOIN admin_roles r ON r.id = u.role_id
      WHERE u.company_id = ? AND LOWER(u.${field}) = LOWER(?) AND u.id <> ? AND (u.role_id IS NULL OR r.kind = 'customer') LIMIT 1`,
    [companyId, value, skip("customer")]
  );
  if (customer) return true;
  if (field === "sap_card_code") return false;
  const staff = await queryOne<{ id: number }>(
    `SELECT id FROM admin_users WHERE company_id = ? AND LOWER(${field}) = LOWER(?) AND id <> ? LIMIT 1`,
    [companyId, value, skip("staff")]
  );
  return !!staff;
}

/** The SAP customer a Customer-role user is linked to — its pricing fields are copied onto the user. */
export async function getSapCustomer(cardCode: string) {
  return queryOne<{
    sap_card_code: string; card_name: string | null; mst_code: string | null; price_list_num: number | null;
    cus_grp01: string | null; cus_grp02: string | null; cus_grp03: string | null; is_enabled: number;
  }>(
    `SELECT sap_card_code, card_name, mst_code, price_list_num, cus_grp01, cus_grp02, cus_grp03, is_enabled
       FROM customers WHERE company_id = ? AND sap_card_code = ?`,
    [getCompanyId(), cardCode]
  );
}

/** Active Super Admins (admin_users) other than staff #`exceptId` — there must always be at least one. */
export async function otherActiveSuperAdmins(exceptId: number): Promise<number> {
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM admin_users a JOIN admin_roles r ON r.id = a.role_id
      WHERE a.company_id = ? AND r.kind = 'super_admin' AND a.is_active = TRUE AND a.id <> ?`,
    [getCompanyId(), exceptId]
  );
  return Number(row?.cnt ?? 0);
}
