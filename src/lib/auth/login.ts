import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { isHttpsRequest } from "@/lib/auth/cookies";
import { signStaffToken, homePathForKind, type RoleKind } from "@/lib/auth/adminSession";
import { logAuditEvent } from "@/lib/auditLog";

const JWT_SECRET = process.env.JWT_SECRET || "order-portal-secret-key-change-in-production";

export interface LoginUserRow {
  id: number;
  userid: string | null;
  email: string | null;
  phone: string | null;
  full_name: string;
  mst_code: string | null;
  sap_card_code: string | null;
  sap_card_name: string | null;
  password_hash: string;
  language: "vi" | "en";
  is_active: number;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  must_change_password: number;
  /** null for an account with no role yet (treated as a customer). */
  kind: RoleKind | null;
}

/**
 * Find the account an identifier belongs to: userid or email (everyone), or
 * phone / tax code (customers). Exact userid/email matches win over phone/tax
 * code, so a staff userid can't be shadowed by a customer's phone number.
 */
export async function findUserByIdentifier(identifier: string): Promise<LoginUserRow | null> {
  const value = identifier.trim();
  const lower = value.toLowerCase();
  const phone = value.replace(/[+\-\s()]/g, "");
  return queryOne<LoginUserRow>(
    `SELECT u.id, u.userid, u.email, u.phone, u.full_name, u.mst_code, u.sap_card_code, u.sap_card_name, u.password_hash,
            u.language, u.is_active, u.approval_status, u.rejection_reason, u.must_change_password, r.kind
       FROM users u
       LEFT JOIN admin_roles r ON r.id = u.role_id
      WHERE u.company_id = ?
        AND (LOWER(u.userid) = ? OR LOWER(u.email) = ? OR u.phone = ? OR u.mst_code = ?)
      ORDER BY (LOWER(u.userid) = ?) DESC, (LOWER(u.email) = ?) DESC, u.id
      LIMIT 1`,
    [getCompanyId(), lower, lower, phone, value, lower, lower]
  );
}

/**
 * The one login for everyone (POST /api/auth/login; /api/admin/login is an
 * alias). Detects the account's role and signs it in accordingly:
 *  - Super Admin / Admin / Sales → staff session (admin-token cookie, 8h),
 *    lands on /admin or /sales;
 *  - Customer → storefront session (auth-token cookie, 30 days with "remember
 *    me"), lands on /customer — after the approval / SAP-block checks.
 * With "change password at next login" set, `redirect` points at the change
 * password page instead. The response also returns `kind`.
 */
export async function loginResponse(
  request: NextRequest,
  identifier: unknown,
  password: unknown,
  rememberMe: boolean
): Promise<NextResponse> {
  if (typeof identifier !== "string" || !identifier.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Identifier and password are required" }, { status: 400 });
  }
  const value = identifier.trim();
  const user = await findUserByIdentifier(value);
  const kind: RoleKind = user?.kind ?? "customer";
  const actorType = kind === "customer" ? "customer" : "admin";
  const label = user?.email || user?.userid || value;

  if (!user) {
    await logAuditEvent({ actorType: "customer", actorLabel: value, action: "login_failed", details: { reason: "no_such_account" }, request });
    return NextResponse.json({ error: "Sai tên hoặc mật khẩu!" }, { status: 401 });
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    await logAuditEvent({ actorType, actorId: user.id, actorLabel: label, action: "login_failed", details: { reason: "bad_password" }, request });
    return NextResponse.json({ error: "Sai tên hoặc mật khẩu!" }, { status: 401 });
  }
  if (!user.is_active) {
    await logAuditEvent({ actorType, actorId: user.id, actorLabel: label, action: "login_failed", details: { reason: "inactive" }, request });
    return NextResponse.json({ error: "Account is disabled" }, { status: 403 });
  }

  if (kind === "customer") {
    if (user.approval_status === "pending") {
      await logAuditEvent({ actorType, actorId: user.id, actorLabel: label, action: "login_failed", details: { reason: "pending_approval" }, request });
      return NextResponse.json({ error: "pending_approval", message: "Account is pending admin approval" }, { status: 403 });
    }
    if (user.approval_status === "rejected") {
      await logAuditEvent({ actorType, actorId: user.id, actorLabel: label, action: "login_failed", details: { reason: "account_rejected" }, request });
      return NextResponse.json(
        { error: "account_rejected", message: "Account registration was rejected", reason: user.rejection_reason || "" },
        { status: 403 }
      );
    }
    if (user.sap_card_code) {
      const customer = await queryOne<{ is_enabled: number }>(
        "SELECT is_enabled FROM customers WHERE company_id = ? AND sap_card_code = ? LIMIT 1",
        [getCompanyId(), user.sap_card_code]
      );
      if (customer && !customer.is_enabled) {
        await logAuditEvent({ actorType, actorId: user.id, actorLabel: label, action: "login_failed", details: { reason: "sap_customer_blocked" }, request });
        return NextResponse.json(
          { error: "This account was blocked, please contact Admin 0908404678 to enable account again." },
          { status: 403 }
        );
      }
    }
  }

  const home = homePathForKind(kind);
  const mustChangePassword = !!user.must_change_password;
  const redirect = mustChangePassword ? (kind === "customer" ? "/change-password?forced=1" : `${home}/change-password`) : home;
  const response = NextResponse.json({
    success: true,
    kind,
    redirect,
    mustChangePassword,
    user: {
      id: user.id, userid: user.userid, email: user.email, phone: user.phone, fullName: user.full_name,
      sapCardCode: user.sap_card_code, sapCardName: user.sap_card_name, language: user.language, approvalStatus: user.approval_status,
    },
  });

  const secure = isHttpsRequest(request);
  if (kind === "customer") {
    // 30-day token either way; "remember me" only decides whether the cookie outlives the browser.
    const token = jwt.sign({ userId: user.id, email: user.email, fullName: user.full_name }, JWT_SECRET, { expiresIn: "30d" });
    response.cookies.set("auth-token", token, { httpOnly: true, secure, sameSite: "lax", ...(rememberMe ? { maxAge: 30 * 24 * 60 * 60 } : {}), path: "/" });
  } else {
    response.cookies.set("admin-token", signStaffToken(user.id), { httpOnly: true, secure, sameSite: "lax", maxAge: 8 * 60 * 60, path: "/" });
  }

  await logAuditEvent({ actorType, actorId: user.id, actorLabel: label, action: "login_success", details: { kind }, request });
  return response;
}
