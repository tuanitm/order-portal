import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited, logAuditEvent } from "@/lib/auditLog";
import { USERID_PATTERN, findClash, getRoleKind, getSapCustomer } from "@/lib/userAdmin";
import { checkCustomerFitsRole } from "@/lib/customerRoleScope";

/**
 * GET /api/admin/users?kind=staff|customer|<role kind>&search= — every user
 * (staff and customers), with their role. Super Admin only ("admin-users").
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") || "";
  const search = (sp.get("search") || "").trim();
  const where = ["u.company_id = ?"];
  const params: (string | number)[] = [getCompanyId()];
  if (kind === "staff") where.push("r.kind IN ('super_admin','admin','sales')");
  else if (["super_admin", "admin", "sales", "customer"].includes(kind)) { where.push("r.kind = ?"); params.push(kind); }
  if (search) {
    const like = `%${search}%`;
    where.push("(u.userid LIKE ? OR u.email LIKE ? OR u.full_name LIKE ? OR u.sap_card_code LIKE ? OR u.phone LIKE ?)");
    params.push(like, like, like, like, like);
  }

  const users = await query(
    `SELECT u.id, u.userid, u.email, u.phone, u.full_name, u.sap_card_code, u.sap_card_name, u.is_active,
            u.must_change_password, u.approval_status, u.department_code, u.owner_code, u.created_at,
            r.id AS role_id, r.name AS role_name, r.kind AS role_kind,
            (SELECT COUNT(*) FROM orders o WHERE o.company_id = u.company_id AND o.user_id = u.id) AS order_count
       FROM users u
       LEFT JOIN admin_roles r ON r.id = u.role_id
      WHERE ${where.join(" AND ")}
      ORDER BY FIELD(r.kind, 'super_admin', 'admin', 'sales', 'customer'), u.userid IS NULL, u.userid, u.email
      LIMIT 500`,
    params
  );
  return NextResponse.json({ users });
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
  if (!userid && !email) return NextResponse.json({ error: "Enter a User ID or an email" }, { status: 400 });
  if (userid && !USERID_PATTERN.test(userid)) return NextResponse.json({ error: "User ID: 3–50 letters, digits, dot, dash or underscore" }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Email is not valid" }, { status: 400 });
  if (userid && (await findClash("userid", userid, null))) return NextResponse.json({ error: `User ID "${userid}" is already used` }, { status: 409 });
  if (email && (await findClash("email", email, null))) return NextResponse.json({ error: `Email "${email}" is already used` }, { status: 409 });

  let customer = null;
  if (kind === "customer") {
    const cardCode = typeof body.sapCardCode === "string" ? body.sapCardCode.trim() : "";
    if (!cardCode) return NextResponse.json({ error: "SAP customer code is required for a Customer role" }, { status: 400 });
    customer = await getSapCustomer(cardCode);
    if (!customer) return NextResponse.json({ error: `SAP customer ${cardCode} not found (SAP Customers)` }, { status: 400 });
    const misfit = await checkCustomerFitsRole(roleId, customer);
    if (misfit) return NextResponse.json({ error: misfit }, { status: 400 });
  }

  const result = await query<{ insertId: number }>(
    `INSERT INTO users (company_id, userid, role_id, email, phone, password_hash, full_name, must_change_password, is_active,
                        approval_status, approved_at, approved_by, sap_card_code, sap_card_name, mst_code, sap_price_list_num,
                        sap_cus_grp01, sap_cus_grp02, sap_cus_grp03, department_code, owner_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'approved', NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [getCompanyId(), userid || null, roleId, email || null, (typeof body.phone === "string" && body.phone.trim()) || null,
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
    details: { userid, email, fullName, roleId, kind, sapCardCode: customer?.sap_card_code ?? null }, request,
  });
  return NextResponse.json({ success: true, userId: newId });
}

// Failed calls are written to the audit log too (successes log their own detailed entry above).
export const POST = audited({ action: "admin_user_create", entityType: "user", failuresOnly: true }, POSTHandler);
