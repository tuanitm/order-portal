import { NextRequest, NextResponse } from "next/server";
import { hasSapAccountKind, sapUserCodeClash, adoptSharedSapPassword } from "@/lib/sap-b1/userCredentials";
import { isSingleEmail } from "@/lib/emailFormat";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited, logAuditEvent } from "@/lib/auditLog";
import { USERID_PATTERN, findClash, getRoleKind, getSapCustomer, accountTableForKind } from "@/lib/userAdmin";
import { checkCustomerFitsRole } from "@/lib/customerRoleScope";

/**
 * GET /api/admin/users?kind=staff|customer|<role kind>&search= — every user,
 * with their role and `account`: "staff" rows come from admin_users, "customer"
 * rows from users (ids can repeat between the two — edit/delete pass
 * ?account=). Super Admin only ("admin-users").
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") || "";
  const search = (sp.get("search") || "").trim();
  const companyId = getCompanyId();
  const like = `%${search}%`;
  const staffKind = ["super_admin", "admin", "sales", "account"].includes(kind) ? kind : null;
  const wantStaff = kind === "" || kind === "staff" || staffKind !== null;
  const wantCustomers = kind === "" || kind === "customer";

  const staff = wantStaff
    ? await query<Record<string, unknown>[]>(
        `SELECT 'staff' AS account, a.id, a.userid, a.email, a.phone, a.full_name, NULL AS sap_card_code, NULL AS sap_card_name,
                a.is_active, a.must_change_password, 'approved' AS approval_status, a.department_code, a.owner_code, a.sap_user_code, a.sap_password_updated_at, a.created_at,
                r.id AS role_id, r.name AS role_name, r.kind AS role_kind, 0 AS order_count
           FROM admin_users a
           JOIN admin_roles r ON r.id = a.role_id AND r.company_id = a.company_id AND r.kind <> 'customer'
          WHERE a.company_id = ?
            ${staffKind ? "AND r.kind = ?" : ""}
            ${search ? "AND (a.userid LIKE ? OR a.email LIKE ? OR a.full_name LIKE ? OR a.phone LIKE ?)" : ""}
          ORDER BY FIELD(r.kind, 'super_admin', 'admin', 'sales', 'account'), a.userid IS NULL, a.userid, a.email
          LIMIT 500`,
        [companyId, ...(staffKind ? [staffKind] : []), ...(search ? [like, like, like, like] : [])]
      )
    : [];
  const customers = wantCustomers
    ? await query<Record<string, unknown>[]>(
        `SELECT 'customer' AS account, u.id, u.userid, u.email, u.phone, u.full_name, u.sap_card_code, u.sap_card_name, u.is_active,
                u.must_change_password, u.approval_status, NULL AS department_code, NULL AS owner_code, NULL AS sap_user_code, NULL AS sap_password_updated_at, u.created_at,
                r.id AS role_id, r.name AS role_name, COALESCE(r.kind, 'customer') AS role_kind,
                (SELECT COUNT(*) FROM orders o WHERE o.company_id = u.company_id AND o.user_id = u.id) AS order_count
           FROM users u
           LEFT JOIN admin_roles r ON r.id = u.role_id
          WHERE u.company_id = ? AND (u.role_id IS NULL OR r.kind = 'customer')
            ${search ? "AND (u.userid LIKE ? OR u.email LIKE ? OR u.full_name LIKE ? OR u.sap_card_code LIKE ? OR u.phone LIKE ?)" : ""}
          ORDER BY u.userid IS NULL, u.userid, u.email
          LIMIT 500`,
        [companyId, ...(search ? [like, like, like, like, like] : [])]
      )
    : [];
  return NextResponse.json({ users: [...staff, ...customers] });
}

/**
 * POST /api/admin/users — create a user.
 * Body: { userid, email?, fullName, phone?, roleId, sapCardCode? (required for a Customer role),
 *         password, mustChangePassword?, departmentCode?, ownerCode? }
 */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const body = await request.json();
  const userid = typeof body.userid === "string" ? body.userid.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const roleId = Number(body.roleId);

  const kind = Number.isInteger(roleId) ? await getRoleKind(roleId) : null;
  if (!kind) return NextResponse.json({ error: "Choose a role" }, { status: 400 });
  if (!fullName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  if (kind !== "customer" && !userid) return NextResponse.json({ error: "User ID is required for staff" }, { status: 400 });
  if (kind !== "customer" && !email) return NextResponse.json({ error: "Email is required for staff" }, { status: 400 });
  // Accountant's SAP user: optional here — the Accountant can set it (with its password) in My Profile.
  if (hasSapAccountKind(kind) && typeof body.sapUserCode === "string" && body.sapUserCode.trim()) {
    // One-to-one, except Sales accounts, which may share a SAP user (sapUserCodeClash).
    const clash = await sapUserCodeClash(body.sapUserCode.trim(), null, kind);
    if (clash) return NextResponse.json({ error: clash }, { status: 409 });
  }
  if (kind !== "customer" && !userid && !email) return NextResponse.json({ error: "Enter a User ID or an email" }, { status: 400 });
  if (kind !== "customer" && userid && !USERID_PATTERN.test(userid)) return NextResponse.json({ error: "User ID: 3–50 letters, digits, dot, dash or underscore" }, { status: 400 });
  if (email && !isSingleEmail(email)) return NextResponse.json({ error: "Email: enter one valid address (used to sign in)" }, { status: 400 });
  if (kind !== "customer" && userid && (await findClash("userid", userid, null))) return NextResponse.json({ error: `User ID "${userid}" is already used` }, { status: 409 });
  if (email && (await findClash("email", email, null))) return NextResponse.json({ error: `Email "${email}" is already used` }, { status: 409 });

  let customer = null;
  if (kind === "customer") {
    const cardCode = typeof body.sapCardCode === "string" ? body.sapCardCode.trim() : "";
    if (!cardCode) return NextResponse.json({ error: "SAP customer code is required for a Customer role" }, { status: 400 });
    customer = await getSapCustomer(cardCode);
    if (!customer) return NextResponse.json({ error: `SAP customer ${cardCode} not found (SAP Customers)` }, { status: 400 });
    const misfit = await checkCustomerFitsRole(roleId, customer);
    if (misfit) return NextResponse.json({ error: misfit }, { status: 400 });
    if (await findClash("userid", customer.sap_card_code, null)) {
      return NextResponse.json({ error: `User ID "${customer.sap_card_code}" is already used` }, { status: 409 });
    }
    // UNIQUE (company_id, sap_card_code): one portal account per SAP customer.
    if (await findClash("sap_card_code", customer.sap_card_code, null)) {
      return NextResponse.json({ error: `SAP customer ${customer.sap_card_code} already has a portal account` }, { status: 409 });
    }
  }
  // A Customer's User ID is always its SAP customer code (both required).
  const finalUserid = customer ? customer.sap_card_code : userid;
  const phone = (typeof body.phone === "string" && body.phone.trim()) || null;
  const passwordHash = await bcrypt.hash(password, 12);

  // Staff -> admin_users; customers -> users.
  if (accountTableForKind(kind) === "staff") {
    const staffResult = await query<{ insertId: number }>(
      `INSERT INTO admin_users (company_id, userid, role_id, is_root, email, phone, password_hash, full_name,
                                must_change_password, is_active, department_code, owner_code, sap_user_code)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)`,
      [getCompanyId(), finalUserid, roleId, email, phone, passwordHash, fullName, !!body.mustChangePassword,
       (typeof body.departmentCode === "string" && body.departmentCode.trim()) || null,
       (typeof body.ownerCode === "string" && body.ownerCode.trim()) || null,
       // The SAP B1 user an Accountant approves Sales Orders as.
       hasSapAccountKind(kind) ? (typeof body.sapUserCode === "string" && body.sapUserCode.trim()) || null : null]
    );
    const staffId = (staffResult as unknown as { insertId: number }).insertId;
    // A Sales account on a SAP user other Sales accounts share: it uses their saved password.
    if (kind === "sales") await adoptSharedSapPassword(staffId).catch(() => false);
    await logAuditEvent({
      actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
      action: "admin_user_create", entityType: "staff", entityId: staffId,
      details: { account: "staff", userid: finalUserid, email, fullName, roleId, kind }, request,
    });
    return NextResponse.json({ success: true, userId: staffId, account: "staff" });
  }

  const result = await query<{ insertId: number }>(
    `INSERT INTO users (company_id, userid, role_id, email, phone, password_hash, full_name, must_change_password, is_active,
                        approval_status, approved_at, approved_by, sap_card_code, sap_card_name, mst_code, sap_price_list_num,
                        sap_cus_grp01, sap_cus_grp02, sap_cus_grp03, department_code, owner_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'approved', NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [getCompanyId(), finalUserid || null, roleId, email || null, (typeof body.phone === "string" && body.phone.trim()) || null,
     await bcrypt.hash(password, 12), fullName, !!body.mustChangePassword, guard.session.email,
     customer?.sap_card_code ?? null, customer?.card_name ?? null, customer?.mst_code ?? null, customer?.price_list_num ?? null,
     customer?.cus_grp01 ?? null, customer?.cus_grp02 ?? null, customer?.cus_grp03 ?? null,
     kind !== "customer" ? (typeof body.departmentCode === "string" && body.departmentCode.trim()) || null : null,
     kind !== "customer" ? (typeof body.ownerCode === "string" && body.ownerCode.trim()) || null : null]
  );
  const newId = (result as unknown as { insertId: number }).insertId;
  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "admin_user_create", entityType: "user", entityId: newId,
    details: { userid: finalUserid, email, fullName, roleId, kind, sapCardCode: customer?.sap_card_code ?? null }, request,
  });
  return NextResponse.json({ success: true, userId: newId });
}

// Failed calls are written to the audit log too (successes log their own detailed entry above).
export const POST = audited({ action: "admin_user_create", entityType: "user", failuresOnly: true }, POSTHandler);
