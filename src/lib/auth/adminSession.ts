import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

export const ALL_ADMIN_PERMISSIONS = [
  "dashboard",
  "customers",
  "sap-customers",
  "customer-groups",
  "catalog-visibility",
  "items",
  "item-groups",
  "price-lists",
  "warehouses",
  "contract-discounts",
  "promotions",
  "orders",
  "inventory",
  "admin-users",
  "admin-roles",
  "settings",
  "id-reset",
  "audit-logs",
] as const;

export type AdminPermission = (typeof ALL_ADMIN_PERMISSIONS)[number];

/**
 * Permissions no role can ever grant — only an `admin_users` row with
 * `is_root = TRUE` ("root", isSuperAdmin in the session) may have them,
 * regardless of what a role's own `permissions` JSON contains. Managing
 * admin accounts and the roles that define everyone else's access is
 * itself the thing access control protects; a role-scoped admin who could
 * grant themselves (or any role) "admin-users"/"admin-roles" would be able
 * to escalate to full control, so these are checked by identity
 * (isSuperAdmin), not by the role's permission list — see hasPermission.
 */
export const ROOT_ONLY_PERMISSIONS: AdminPermission[] = ["admin-users", "admin-roles", "settings", "id-reset", "audit-logs"];

/** ALL_ADMIN_PERMISSIONS minus ROOT_ONLY_PERMISSIONS — what a role can actually be given (see the Admin Roles page). */
export const ASSIGNABLE_ADMIN_PERMISSIONS = ALL_ADMIN_PERMISSIONS.filter(
  (p) => !ROOT_ONLY_PERMISSIONS.includes(p)
) as AdminPermission[];

export interface AdminSession {
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  adminId: number | null;
  permissions: AdminPermission[];
}

interface AdminTokenPayload {
  email: string;
  isSuperAdmin: boolean;
  adminId: number;
}

interface AdminUserRow {
  id: number;
  email: string;
  full_name: string;
  is_root: number;
  is_active: number;
  permissions: string | AdminPermission[] | null; // JSON column — mysql2 usually auto-parses to an array; null for a root row (LEFT JOIN, no role)
}

/**
 * Resolve the currently logged-in admin from the `admin-token` cookie (a
 * signed JWT). Always re-checked against the DB on every request — root
 * included — rather than trusting the JWT's claims for its whole 8h
 * lifetime, so deactivating an account (root or not) takes effect
 * immediately, not just on next login. Returns null if there is no valid
 * session.
 */
export async function getAdminSession(request: NextRequest): Promise<AdminSession | null> {
  const token = request.cookies.get("admin-token")?.value;
  if (!token) return null;

  let decoded: AdminTokenPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
  } catch {
    return null;
  }

  if (!decoded.adminId) return null;

  const row = await queryOne<AdminUserRow>(
    `SELECT au.id, au.email, au.full_name, au.is_root, au.is_active, ar.permissions
     FROM admin_users au
     LEFT JOIN admin_roles ar ON ar.id = au.role_id
     WHERE au.company_id = ? AND au.id = ?`,
    [getCompanyId(), decoded.adminId]
  );
  if (!row || !row.is_active) return null;

  if (row.is_root) {
    return {
      email: row.email,
      fullName: row.full_name || row.email,
      isSuperAdmin: true,
      adminId: row.id,
      permissions: [...ALL_ADMIN_PERMISSIONS],
    };
  }

  // mysql2 auto-deserializes JSON columns, so row.permissions may already be
  // an array (typical) or, depending on driver config, a raw string.
  let permissions: AdminPermission[] = [];
  try {
    permissions = Array.isArray(row.permissions) ? row.permissions : JSON.parse(row.permissions || "[]");
  } catch {
    permissions = [];
  }

  return {
    email: row.email,
    fullName: row.full_name || row.email,
    isSuperAdmin: false,
    adminId: row.id,
    permissions,
  };
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function hasPermission(session: AdminSession, permission: AdminPermission): boolean {
  if (ROOT_ONLY_PERMISSIONS.includes(permission)) return session.isSuperAdmin;
  return session.isSuperAdmin || session.permissions.includes(permission);
}

/**
 * Route guard: resolves the admin session and checks a permission in one
 * call. Returns the session on success, or a ready-to-return NextResponse
 * (401/403) on failure — callers do `const guard = await requireAdminPermission(...);
 * if (guard.response) return guard.response;` then use `guard.session`.
 */
export async function requireAdminPermission(
  request: NextRequest,
  permission: AdminPermission
): Promise<{ session: AdminSession; response: null } | { session: null; response: NextResponse }> {
  const session = await getAdminSession(request);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!hasPermission(session, permission)) {
    return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, response: null };
}
