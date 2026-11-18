import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import type { RoleKind } from "@/lib/auth/adminSession";

/**
 * Shared rules of the Users page (POST/PATCH /api/admin/users): one user =
 * one role; data permissions come from the role. userid and email are each
 * unique (per company, case-insensitive). A Customer-role user must be linked
 * to a SAP customer (sap_card_code) — that's whose storefront prices they see
 * and whose orders they place. Staff (Super Admin / Admin / Sales) need a userid.
 */

export const USERID_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;

export async function getRoleKind(roleId: number): Promise<RoleKind | null> {
  const row = await queryOne<{ kind: RoleKind }>(`SELECT kind FROM admin_roles WHERE company_id = ? AND id = ?`, [getCompanyId(), roleId]);
  return row?.kind ?? null;
}

/** Another user (not `exceptId`) already using this userid / email? Case-insensitive. */
export async function findClash(field: "userid" | "email", value: string, exceptId: number | null): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE company_id = ? AND LOWER(${field}) = LOWER(?) ${exceptId ? "AND id <> ?" : ""} LIMIT 1`,
    exceptId ? [getCompanyId(), value, exceptId] : [getCompanyId(), value]
  );
  return !!row;
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

/** Active Super Admins other than `exceptId` — there must always be at least one. */
export async function otherActiveSuperAdmins(exceptId: number): Promise<number> {
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM users u JOIN admin_roles r ON r.id = u.role_id
      WHERE u.company_id = ? AND r.kind = 'super_admin' AND u.is_active = TRUE AND u.id <> ?`,
    [getCompanyId(), exceptId]
  );
  return Number(row?.cnt ?? 0);
}
