import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { queryOne } from "@/lib/db/connection";

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
  "contract-discounts",
  "promotions",
  "orders",
  "admin-users",
  "admin-roles",
] as const;

export type AdminPermission = (typeof ALL_ADMIN_PERMISSIONS)[number];

export interface AdminSession {
  email: string;
  isSuperAdmin: boolean;
  adminId: number | null;
  permissions: AdminPermission[];
}

interface AdminTokenPayload {
  email: string;
  isSuperAdmin: boolean;
  adminId?: number;
}

interface AdminUserRow {
  id: number;
  email: string;
  full_name: string;
  is_active: number;
  permissions: string | AdminPermission[]; // JSON column — mysql2 usually auto-parses to an array
}

/**
 * Resolve the currently logged-in admin from the `admin-token` cookie (a
 * signed JWT, not the raw email string the old implementation stored).
 * Returns null if there is no valid session.
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

  if (decoded.isSuperAdmin) {
    return {
      email: decoded.email,
      isSuperAdmin: true,
      adminId: null,
      permissions: [...ALL_ADMIN_PERMISSIONS],
    };
  }

  if (!decoded.adminId) return null;

  const row = await queryOne<AdminUserRow>(
    `SELECT au.id, au.email, au.full_name, au.is_active, ar.permissions
     FROM admin_users au
     JOIN admin_roles ar ON ar.id = au.role_id
     WHERE au.id = ?`,
    [decoded.adminId]
  );
  if (!row || !row.is_active) return null;

  // mysql2 auto-deserializes JSON columns, so row.permissions may already be
  // an array (typical) or, depending on driver config, a raw string.
  let permissions: AdminPermission[] = [];
  try {
    permissions = Array.isArray(row.permissions) ? row.permissions : JSON.parse(row.permissions);
  } catch {
    permissions = [];
  }

  return {
    email: row.email,
    isSuperAdmin: false,
    adminId: row.id,
    permissions,
  };
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function hasPermission(session: AdminSession, permission: AdminPermission): boolean {
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
