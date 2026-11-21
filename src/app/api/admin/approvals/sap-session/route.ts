import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { audited } from "@/lib/auditLog";
import { getUserSapSession, loginUserSapSession, logoutUserSapSession, SapLoginError } from "@/lib/sap-b1/userSession";

/**
 * The Accountant's own SAP B1 session, used to approve Sales Orders as
 * their SAP user (admin_users.sap_user_code, set on the Users page).
 *   GET    — current session (sapUser, expiresAt) or null
 *   POST   — { password }: sign in to SAP. The password is passed to SAP's
 *            /Login only — never stored or logged (logBody: false).
 *   DELETE — sign out of SAP
 */
async function sapUserCodeOf(adminId: number | null): Promise<string | null> {
  if (!adminId) return null;
  const row = await queryOne<{ sap_user_code: string | null }>(
    `SELECT sap_user_code FROM admin_users WHERE company_id = ? AND id = ?`, [getCompanyId(), adminId]
  );
  return row?.sap_user_code ?? null;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  return NextResponse.json({
    sapUserCode: await sapUserCodeOf(guard.session.adminId),
    session: guard.session.adminId ? getUserSapSession(guard.session.adminId) : null,
  });
}

async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  const adminId = guard.session.adminId;
  // Accountants sign in with the SAP password saved in My Profile (automatic) — no one-off sign-in.
  if (guard.session.kind === "account") {
    return NextResponse.json({ error: "Save your SAP user and password in My Profile — approving then signs in to SAP automatically" }, { status: 400 });
  }
  const sapUser = await sapUserCodeOf(adminId);
  if (!adminId || !sapUser) {
    return NextResponse.json({ error: "No SAP user is set for your account — ask a Super Admin to set it on the Users page" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ error: "Enter your SAP password" }, { status: 400 });
  try {
    const session = await loginUserSapSession(adminId, sapUser, password);
    return NextResponse.json({ success: true, session });
  } catch (error) {
    if (error instanceof SapLoginError) return NextResponse.json({ error: `SAP sign-in failed: ${error.message}` }, { status: 401 });
    console.error("[Approvals] SAP sign-in failed:", error);
    return NextResponse.json({ error: "Could not reach SAP" }, { status: 502 });
  }
}

async function DELETEHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  if (guard.session.adminId) await logoutUserSapSession(guard.session.adminId);
  return NextResponse.json({ success: true });
}

// logBody: false — the request body holds the SAP password.
export const POST = audited({ action: "sap_user_login", entityType: "sap_session", logBody: false }, POSTHandler);
export const DELETE = audited({ action: "sap_user_logout", entityType: "sap_session", logBody: false }, DELETEHandler);
