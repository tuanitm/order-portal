import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission, type RoleKind } from "@/lib/auth/adminSession";
import { audited, logAuditEvent } from "@/lib/auditLog";
import { USERID_PATTERN, findClash, getRoleKind, getSapCustomer, otherActiveSuperAdmins } from "@/lib/userAdmin";
import { checkCustomerFitsRole } from "@/lib/customerRoleScope";

interface TargetRow { id: number; userid: string | null; email: string | null; role_id: number | null; kind: RoleKind | null; sap_card_code: string | null }

async function loadTarget(id: number) {
  return queryOne<TargetRow>(
    `SELECT u.id, u.userid, u.email, u.role_id, r.kind, u.sap_card_code FROM users u LEFT JOIN admin_roles r ON r.id = u.role_id
      WHERE u.company_id = ? AND u.id = ?`,
    [getCompanyId(), id]
  );
}

/**
 * PATCH /api/admin/users/[id] — Body: any of { userid, email, fullName, phone, roleId, sapCardCode,
 * isActive, mustChangePassword, password, departmentCode, ownerCode }.
 * Rules as in POST; there must always be one active Super Admin left.
 */
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  const target = await loadTarget(userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = await request.json();
  const updates: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  const changed: string[] = [];
  const set = (col: string, v: string | number | boolean | null, label: string) => { updates.push(`${col} = ?`); values.push(v); changed.push(label); };

  // Role first — it decides what the rest of the account must have.
  let kind = target.kind ?? "customer";
  if (body.roleId !== undefined && Number(body.roleId) !== undefined) {
    const newKind = await getRoleKind(Number(body.roleId));
    if (!newKind) return NextResponse.json({ error: "Role not found" }, { status: 400 });
    if (target.kind === "super_admin" && newKind !== "super_admin" && (await otherActiveSuperAdmins(userId)) === 0) {
      return NextResponse.json({ error: "This is the last active Super Admin — its role can't change" }, { status: 400 });
    }
    kind = newKind;
    set("role_id", Number(body.roleId), "role");
  }

  // A Customer's User ID is always its SAP customer code — set below, never typed.
  if (kind !== "customer" && typeof body.userid === "string") {
    const userid = body.userid.trim();
    if (userid && !USERID_PATTERN.test(userid)) return NextResponse.json({ error: "User ID: 3–50 letters, digits, dot, dash or underscore" }, { status: 400 });
    if (userid && (await findClash("userid", userid, userId))) return NextResponse.json({ error: `User ID "${userid}" is already used` }, { status: 409 });
    // Empty is rejected just below (userid is NOT NULL, required for staff).
    if (userid) set("userid", userid, "userid");
  }
  const finalUserid = typeof body.userid === "string" ? body.userid.trim() : target.userid;
  if (kind !== "customer" && !finalUserid) return NextResponse.json({ error: "User ID is required for staff" }, { status: 400 });

  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Email is not valid" }, { status: 400 });
    if (email && (await findClash("email", email, userId))) return NextResponse.json({ error: `Email "${email}" is already used` }, { status: 409 });
    set("email", email || null, "email");
  }
  if (typeof body.fullName === "string" && body.fullName.trim()) set("full_name", body.fullName.trim(), "fullName");
  if (typeof body.phone === "string") set("phone", body.phone.trim() || null, "phone");

  if (kind === "customer") {
    const cardCode = typeof body.sapCardCode === "string" ? body.sapCardCode.trim() : target.sap_card_code;
    if (!cardCode) return NextResponse.json({ error: "SAP customer code is required for a Customer role" }, { status: 400 });
    let codeForUserid = cardCode;
    if (cardCode !== target.sap_card_code || body.roleId !== undefined) {
      const c = await getSapCustomer(cardCode);
      if (!c) return NextResponse.json({ error: `SAP customer ${cardCode} not found (SAP Customers)` }, { status: 400 });
      const roleId = body.roleId !== undefined ? Number(body.roleId) : target.role_id;
      const misfit = roleId ? await checkCustomerFitsRole(roleId, c) : null;
      if (misfit) return NextResponse.json({ error: misfit }, { status: 400 });
      set("sap_card_code", c.sap_card_code, "sapCardCode");
      codeForUserid = c.sap_card_code;
      set("sap_card_name", c.card_name, "sapCardName");
      set("sap_price_list_num", c.price_list_num, "priceList");
      set("sap_cus_grp01", c.cus_grp01, "cusGrp01");
      set("sap_cus_grp02", c.cus_grp02, "cusGrp02");
      set("sap_cus_grp03", c.cus_grp03, "cusGrp03");
    }
    if (target.userid !== codeForUserid) {
      if (await findClash("userid", codeForUserid, userId)) {
        return NextResponse.json({ error: `User ID "${codeForUserid}" is already used` }, { status: 409 });
      }
      set("userid", codeForUserid, "userid");
    }
  } else if (target.sap_card_code && body.roleId !== undefined) {
    // Now staff: no longer tied to a SAP customer.
    set("sap_card_code", null, "sapCardCode");
  }

  if (typeof body.isActive === "boolean") {
    if (!body.isActive && kind === "super_admin" && (await otherActiveSuperAdmins(userId)) === 0) {
      return NextResponse.json({ error: "Cannot deactivate the last active Super Admin" }, { status: 400 });
    }
    if (!body.isActive && userId === guard.session.adminId) return NextResponse.json({ error: "You can't deactivate yourself" }, { status: 400 });
    set("is_active", body.isActive, body.isActive ? "activated" : "deactivated");
  }
  if (typeof body.mustChangePassword === "boolean") set("must_change_password", body.mustChangePassword, "mustChangePassword");
  if (typeof body.departmentCode === "string") set("department_code", body.departmentCode.trim() || null, "departmentCode");
  if (typeof body.ownerCode === "string") {
    if (body.ownerCode.trim().length > 50) return NextResponse.json({ error: "Owner code must be 50 characters or fewer" }, { status: 400 });
    set("owner_code", body.ownerCode.trim() || null, "ownerCode");
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    set("password_hash", await bcrypt.hash(body.password, 12), "password");
  }

  if (updates.length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  try {
    await query(`UPDATE users SET ${updates.join(", ")} WHERE company_id = ? AND id = ?`, [...values, getCompanyId(), userId]);
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return NextResponse.json({ error: "User ID or email already in use" }, { status: 409 });
    console.error("[Admin] Update user failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_update", entityType: "user", entityId: userId,
    details: { target: target.userid || target.email, changed }, request,
  });
  return NextResponse.json({ success: true });
}

/** DELETE /api/admin/users/[id] — not yourself, not the last Super Admin, not a user with orders (deactivate instead). */
async function DELETEHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  const target = await loadTarget(userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (userId === guard.session.adminId) return NextResponse.json({ error: "You can't delete yourself" }, { status: 400 });
  if (target.kind === "super_admin" && (await otherActiveSuperAdmins(userId)) === 0) {
    return NextResponse.json({ error: "Cannot delete the last active Super Admin" }, { status: 400 });
  }
  const orders = await queryOne<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM orders WHERE company_id = ? AND user_id = ?`, [getCompanyId(), userId]);
  if (orders && orders.cnt > 0) {
    return NextResponse.json({ error: `This user has ${orders.cnt} order(s) — deactivate it instead` }, { status: 409 });
  }

  await query(`DELETE FROM users WHERE company_id = ? AND id = ?`, [getCompanyId(), userId]);
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_delete", entityType: "user", entityId: userId,
    details: { target: target.userid || target.email }, request,
  });
  return NextResponse.json({ success: true });
}

// Failed calls are written to the audit log too (successes log their own detailed entry above).
export const PATCH = audited({ action: "admin_user_update", entityType: "user", entityParam: "id", failuresOnly: true }, PATCHHandler);
export const DELETE = audited({ action: "admin_user_delete", entityType: "user", entityParam: "id", failuresOnly: true }, DELETEHandler);
