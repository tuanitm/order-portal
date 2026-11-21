import { NextRequest, NextResponse } from "next/server";
import { hasSapAccountKind } from "@/lib/sap-b1/userCredentials";
import { isSingleEmail } from "@/lib/emailFormat";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission, type RoleKind } from "@/lib/auth/adminSession";
import { audited, logAuditEvent } from "@/lib/auditLog";
import {
  USERID_PATTERN, findClash, getRoleKind, getSapCustomer, otherActiveSuperAdmins,
  accountTableForKind, type AccountTable,
} from "@/lib/userAdmin";
import { checkCustomerFitsRole } from "@/lib/customerRoleScope";
import { logoutUserSapSession } from "@/lib/sap-b1/userSession";

interface TargetRow { id: number; userid: string | null; email: string | null; role_id: number | null; kind: RoleKind | null; sap_card_code: string | null }

/**
 * Staff live in admin_users, customers in users — ids can repeat between the
 * two, so every call names the table: ?account=staff | customer (default customer).
 */
function accountOf(request: NextRequest): AccountTable {
  return request.nextUrl.searchParams.get("account") === "staff" ? "staff" : "customer";
}

async function loadTarget(account: AccountTable, id: number) {
  if (account === "staff") {
    return queryOne<TargetRow>(
      `SELECT a.id, a.userid, a.email, a.role_id, r.kind, NULL AS sap_card_code
         FROM admin_users a LEFT JOIN admin_roles r ON r.id = a.role_id
        WHERE a.company_id = ? AND a.id = ?`,
      [getCompanyId(), id]
    );
  }
  return queryOne<TargetRow>(
    `SELECT u.id, u.userid, u.email, u.role_id, COALESCE(r.kind, 'customer') AS kind, u.sap_card_code
       FROM users u LEFT JOIN admin_roles r ON r.id = u.role_id
      WHERE u.company_id = ? AND u.id = ?`,
    [getCompanyId(), id]
  );
}

/**
 * PATCH /api/admin/users/[id]?account=staff|customer — Body: any of { userid, email, fullName, phone,
 * roleId, sapCardCode, isActive, mustChangePassword, password, departmentCode, ownerCode }.
 * Rules as in POST; there must always be one active Super Admin left. A role
 * change can't move an account between staff and customer (different tables).
 */
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const account = accountOf(request);
  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  const target = await loadTarget(account, userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const self = { table: account, id: userId };
  const isMe = account === "staff" && userId === guard.session.adminId;

  const body = await request.json();
  const updates: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  const changed: string[] = [];
  const set = (col: string, v: string | number | boolean | null, label: string) => { updates.push(`${col} = ?`); values.push(v); changed.push(label); };

  // Role first — it decides what the rest of the account must have.
  let kind: RoleKind = target.kind ?? "customer";
  if (body.roleId !== undefined && body.roleId !== null && body.roleId !== "") {
    const newKind = await getRoleKind(Number(body.roleId));
    if (!newKind) return NextResponse.json({ error: "Role not found" }, { status: 400 });
    if (accountTableForKind(newKind) !== account) {
      return NextResponse.json(
        { error: "Staff and customer accounts are stored separately — create a new account instead of changing between them" },
        { status: 400 }
      );
    }
    if (target.kind === "super_admin" && newKind !== "super_admin" && (await otherActiveSuperAdmins(userId)) === 0) {
      return NextResponse.json({ error: "This is the last active Super Admin — its role can't change" }, { status: 400 });
    }
    kind = newKind;
    if (Number(body.roleId) !== target.role_id) set("role_id", Number(body.roleId), "role");
  }

  // A Customer's User ID is always its SAP customer code — set below, never typed.
  if (account === "staff" && typeof body.userid === "string") {
    const userid = body.userid.trim();
    if (!userid) return NextResponse.json({ error: "User ID is required for staff" }, { status: 400 });
    if (!USERID_PATTERN.test(userid)) return NextResponse.json({ error: "User ID: 3–50 letters, digits, dot, dash or underscore" }, { status: 400 });
    if (await findClash("userid", userid, self)) return NextResponse.json({ error: `User ID "${userid}" is already used` }, { status: 409 });
    if (userid !== target.userid) set("userid", userid, "userid");
  }

  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!email && account === "staff") return NextResponse.json({ error: "Email is required for staff" }, { status: 400 });
    if (email && !isSingleEmail(email)) return NextResponse.json({ error: "Email: enter one valid address (used to sign in)" }, { status: 400 });
    if (email && (await findClash("email", email, self))) return NextResponse.json({ error: `Email "${email}" is already used` }, { status: 409 });
    set("email", email || null, "email");
  }
  if (typeof body.fullName === "string" && body.fullName.trim()) set("full_name", body.fullName.trim(), "fullName");
  if (typeof body.phone === "string") set("phone", body.phone.trim() || null, "phone");

  if (account === "customer") {
    const cardCode = typeof body.sapCardCode === "string" ? body.sapCardCode.trim() : target.sap_card_code;
    if (!cardCode) return NextResponse.json({ error: "SAP customer code is required for a Customer role" }, { status: 400 });
    let codeForUserid = cardCode;
    if (cardCode !== target.sap_card_code || body.roleId !== undefined) {
      const c = await getSapCustomer(cardCode);
      if (!c) return NextResponse.json({ error: `SAP customer ${cardCode} not found (SAP Customers)` }, { status: 400 });
      const roleId = body.roleId !== undefined ? Number(body.roleId) : target.role_id;
      const misfit = roleId ? await checkCustomerFitsRole(roleId, c) : null;
      if (misfit) return NextResponse.json({ error: misfit }, { status: 400 });
      // UNIQUE (company_id, sap_card_code): one portal account per SAP customer.
      if (await findClash("sap_card_code", c.sap_card_code, self)) {
        return NextResponse.json({ error: `SAP customer ${c.sap_card_code} already has a portal account` }, { status: 409 });
      }
      set("sap_card_code", c.sap_card_code, "sapCardCode");
      codeForUserid = c.sap_card_code;
      set("sap_card_name", c.card_name, "sapCardName");
      set("sap_price_list_num", c.price_list_num, "priceList");
      set("sap_cus_grp01", c.cus_grp01, "cusGrp01");
      set("sap_cus_grp02", c.cus_grp02, "cusGrp02");
      set("sap_cus_grp03", c.cus_grp03, "cusGrp03");
    }
    if (target.userid !== codeForUserid) {
      if (await findClash("userid", codeForUserid, self)) {
        return NextResponse.json({ error: `User ID "${codeForUserid}" is already used` }, { status: 409 });
      }
      set("userid", codeForUserid, "userid");
    }
  }

  if (typeof body.isActive === "boolean") {
    if (!body.isActive && kind === "super_admin" && (await otherActiveSuperAdmins(userId)) === 0) {
      return NextResponse.json({ error: "Cannot deactivate the last active Super Admin" }, { status: 400 });
    }
    if (!body.isActive && isMe) return NextResponse.json({ error: "You can't deactivate yourself" }, { status: 400 });
    set("is_active", body.isActive, body.isActive ? "activated" : "deactivated");
  }
  if (typeof body.mustChangePassword === "boolean") set("must_change_password", body.mustChangePassword, "mustChangePassword");
  // SO Department (OcrCode2) and SAP Owner are staff-only.
  if (account === "staff" && typeof body.departmentCode === "string") set("department_code", body.departmentCode.trim() || null, "departmentCode");
  // The SAP B1 user an Accountant approves Sales Orders as. Its password is set
  // separately (PUT ./sap-account, verified by SAP); changing the user forgets it.
  // Only Super Admin, and only for an Accountant (it decides whose SO approvals they see and make).
  let sapLoginChanged = false;
  if (account === "staff" && typeof body.sapUserCode === "string" && guard.session.isSuperAdmin && hasSapAccountKind(kind)) {
    const code = body.sapUserCode.trim();
    if (code.length > 50) return NextResponse.json({ error: "SAP user code must be 50 characters or fewer" }, { status: 400 });
    const cur = await queryOne<{ sap_user_code: string | null }>(`SELECT sap_user_code FROM admin_users WHERE company_id = ? AND id = ?`, [getCompanyId(), userId]);
    if ((cur?.sap_user_code ?? "").toLowerCase() !== code.toLowerCase()) {
      if (code) {
        const clash = await queryOne<{ id: number }>(`SELECT id FROM admin_users WHERE company_id = ? AND LOWER(sap_user_code) = LOWER(?) AND id <> ?`, [getCompanyId(), code, userId]);
        if (clash) return NextResponse.json({ error: `SAP user ${code} is already linked to another portal user` }, { status: 409 });
      }
      set("sap_user_code", code || null, "sapUserCode");
      set("sap_password_enc", null, "sapPasswordCleared");
      set("sap_password_updated_at", null, "sapPasswordUpdatedAt");
      sapLoginChanged = true;
    }
  }
  if (account === "staff" && typeof body.ownerCode === "string") {
    if (body.ownerCode.trim().length > 50) return NextResponse.json({ error: "Owner code must be 50 characters or fewer" }, { status: 400 });
    set("owner_code", body.ownerCode.trim() || null, "ownerCode");
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    set("password_hash", await bcrypt.hash(body.password, 12), "password");
  }

  if (updates.length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  const table = account === "staff" ? "admin_users" : "users";
  try {
    await query(`UPDATE ${table} SET ${updates.join(", ")} WHERE company_id = ? AND id = ?`, [...values, getCompanyId(), userId]);
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return NextResponse.json({ error: "User ID, email or SAP customer already in use" }, { status: 409 });
    console.error("[Admin] Update user failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // The user's live SAP session (SO Approval) must not outlive a change of SAP user, deactivation or a role change.
  if (account === "staff" && (sapLoginChanged || body.isActive === false || (body.roleId !== undefined && Number(body.roleId) !== target.role_id))) {
    await logoutUserSapSession(userId).catch(() => undefined);
  }
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_update", entityType: account === "staff" ? "staff" : "user", entityId: userId,
    details: { account, target: target.userid || target.email, changed }, request,
  });
  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/users/[id]?account=staff|customer — not yourself, not the
 * last Super Admin, not a customer with orders (deactivate instead).
 */
async function DELETEHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const account = accountOf(request);
  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  const target = await loadTarget(account, userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (account === "staff") {
    if (userId === guard.session.adminId) return NextResponse.json({ error: "You can't delete yourself" }, { status: 400 });
    if (target.kind === "super_admin" && (await otherActiveSuperAdmins(userId)) === 0) {
      return NextResponse.json({ error: "Cannot delete the last active Super Admin" }, { status: 400 });
    }
    await query(`DELETE FROM admin_users WHERE company_id = ? AND id = ?`, [getCompanyId(), userId]);
    await logoutUserSapSession(userId).catch(() => undefined);
  } else {
    const orders = await queryOne<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM orders WHERE company_id = ? AND user_id = ?`, [getCompanyId(), userId]);
    if (orders && orders.cnt > 0) {
      return NextResponse.json({ error: `This user has ${orders.cnt} order(s) — deactivate it instead` }, { status: 409 });
    }
    await query(`DELETE FROM users WHERE company_id = ? AND id = ?`, [getCompanyId(), userId]);
  }
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_delete", entityType: account === "staff" ? "staff" : "user", entityId: userId,
    details: { account, target: target.userid || target.email }, request,
  });
  return NextResponse.json({ success: true });
}

// Failed calls are written to the audit log too (successes log their own detailed entry above).
export const PATCH = audited({ action: "admin_user_update", entityType: "user", entityParam: "id", failuresOnly: true }, PATCHHandler);
export const DELETE = audited({ action: "admin_user_delete", entityType: "user", entityParam: "id", failuresOnly: true }, DELETEHandler);
