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
 * Permissions no role can ever grant — only a user whose role is of kind
 * "super_admin" (isSuperAdmin in the session) may have them, regardless of
 * what a role's own `permissions` JSON contains. Managing users and the roles
 * that define everyone else's access is itself the thing access control
 * protects; a role-scoped admin who could grant themselves (or any role)
 * "admin-users"/"admin-roles" could escalate to full control, so these are
 * checked by role kind (isSuperAdmin), not the permission list — see hasPermission.
 */
export const ROOT_ONLY_PERMISSIONS: AdminPermission[] = ["admin-users", "admin-roles", "settings", "id-reset", "audit-logs"];

/** ALL_ADMIN_PERMISSIONS minus ROOT_ONLY_PERMISSIONS — what a role can actually be given (see the Admin Roles page). */
export const ASSIGNABLE_ADMIN_PERMISSIONS = ALL_ADMIN_PERMISSIONS.filter(
  (p) => !ROOT_ONLY_PERMISSIONS.includes(p)
) as AdminPermission[];

/** Role kinds (admin_roles.kind). Every user has exactly one role. */
export type RoleKind = "super_admin" | "admin" | "sales" | "customer";
export type StaffKind = Exclude<RoleKind, "customer">;

/**
 * A role's data permissions — code lists, inherited by every user of the
 * role. Brands = items.brand_code (SAP U_ProdBrand, e.g. D1, N1); Channels =
 * level-1 customer groups (CusGrp01, e.g. GT, MT); Customer Groups / Product
 * (item) Groups = codes at any level (their sub-groups are included);
 * Warehouses = SAP warehouse codes. Ignored for Super Admin (sees everything).
 */
export interface RoleScope {
  brands: string[];
  channels: string[];
  customerGroups: string[];
  itemGroups: string[];
  warehouses: string[];
}

export interface AdminSession {
  email: string;
  fullName: string;
  /** Role kind "super_admin" — every function, no data limits. */
  isSuperAdmin: boolean;
  /** admin_users.id of the signed-in staff member (staff live in admin_users, customers in users). */
  adminId: number | null;
  userid: string | null;
  kind: StaffKind;
  roleId: number;
  roleName: string;
  permissions: AdminPermission[];
  scope: RoleScope;
  /** Set by an admin ("change password at next login") — every staff API refuses until it's changed. */
  mustChangePassword: boolean;
}

/**
 * Staff token (admin-token cookie). `staffId` is admin_users.id. Older tokens
 * (`userId` = a users.id from when staff lived in users) carry no staffId and
 * are rejected — those staff simply sign in again.
 */
interface StaffTokenPayload {
  staffId: number;
  staff: true;
}

interface StaffUserRow {
  id: number;
  userid: string | null;
  email: string | null;
  full_name: string;
  is_active: number;
  must_change_password: number;
  role_id: number;
  role_name: string;
  kind: RoleKind;
  permissions: string | AdminPermission[] | null;
  brands: string | string[] | null;
  channels: string | string[] | null;
  customer_groups: string | string[] | null;
  item_groups: string | string[] | null;
  warehouses: string | string[] | null;
}

/** mysql2 auto-parses JSON columns to arrays; a raw string or null is handled too. */
export function jsonCodeList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Resolve the signed-in staff member (Super Admin / Admin / Sales) from the
 * `admin-token` cookie (a signed JWT). Re-checked against the DB on every
 * request — user, role and data permissions — so deactivating an account or
 * changing a role takes effect immediately. Customers never get a staff
 * session (their role kind is "customer"). Returns null if there is none.
 */
export async function getAdminSession(request: NextRequest): Promise<AdminSession | null> {
  const token = request.cookies.get("admin-token")?.value;
  if (!token) return null;

  let decoded: Partial<StaffTokenPayload>;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as Partial<StaffTokenPayload>;
  } catch {
    return null;
  }
  if (!decoded.staff || !decoded.staffId) return null;

  const row = await queryOne<StaffUserRow>(
    `SELECT a.id, a.userid, a.email, a.full_name, a.is_active, a.must_change_password,
            r.id AS role_id, r.name AS role_name, r.kind, r.permissions,
            r.brands, r.channels, r.customer_groups, r.item_groups, r.warehouses
     FROM admin_users a
     JOIN admin_roles r ON r.id = a.role_id AND r.company_id = a.company_id
     WHERE a.company_id = ? AND a.id = ?`,
    [getCompanyId(), decoded.staffId]
  );
  if (!row || !row.is_active || row.kind === "customer") return null;

  const isSuperAdmin = row.kind === "super_admin";
  const permissions = isSuperAdmin
    ? [...ALL_ADMIN_PERMISSIONS]
    : (jsonCodeList(row.permissions).filter((p) => (ALL_ADMIN_PERMISSIONS as readonly string[]).includes(p)) as AdminPermission[]);

  return {
    email: row.email || row.userid || "",
    fullName: row.full_name || row.email || row.userid || "",
    isSuperAdmin,
    adminId: row.id,
    userid: row.userid,
    kind: row.kind,
    roleId: row.role_id,
    roleName: row.role_name,
    permissions,
    scope: {
      brands: jsonCodeList(row.brands),
      channels: jsonCodeList(row.channels),
      customerGroups: jsonCodeList(row.customer_groups),
      itemGroups: jsonCodeList(row.item_groups),
      warehouses: jsonCodeList(row.warehouses),
    },
    mustChangePassword: !!row.must_change_password,
  };
}

export function signStaffToken(staffId: number): string {
  const payload: StaffTokenPayload = { staffId, staff: true };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

/** Where a role kind lands after login. */
export function homePathForKind(kind: RoleKind): "/admin" | "/sales" | "/customer" {
  return kind === "customer" ? "/customer" : kind === "sales" ? "/sales" : "/admin";
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
  if (session.mustChangePassword) {
    return {
      session: null,
      response: NextResponse.json({ error: "must_change_password", message: "Please change your password first" }, { status: 403 }),
    };
  }
  if (!hasPermission(session, permission)) {
    return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, response: null };
}
