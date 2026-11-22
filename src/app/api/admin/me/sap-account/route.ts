import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/adminSession";
import { audited } from "@/lib/auditLog";
import {
  getSapCredentialStatus, saveSapCredentials, clearSapPassword, SapCredentialError, hasSapAccountKind,
} from "@/lib/sap-b1/userCredentials";
import { getUserSapSession } from "@/lib/sap-b1/userSession";

/**
 * GET/PUT/DELETE /api/admin/me/sap-account — the signed-in Accountant's own
 * SAP B1 user + password (My Profile). For Accountants (approve Sales Orders
 * as it) and Admin / Sales users (push orders to SAP as it); Super Admin
 * sets them for anyone on the Users page, and pushes as admin02 itself.
 *   GET    — { sapUserCode, hasPassword, updatedAt, session }
 *   PUT    — { sapUserCode, password }: verified by an SAP login, then saved
 *            Fernet-encrypted. Body never logged (logBody: false).
 *   DELETE — forget the saved password (and sign out of SAP)
 */
async function guard(request: NextRequest): Promise<{ response: NextResponse; adminId?: never } | { adminId: number; response?: never }> {
  const session = await getAdminSession(request);
  if (!session || !session.adminId) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  // Accountants approve as this SAP user; Admin / Sales users push orders as it. Super Admin uses admin02.
  if (!hasSapAccountKind(session.kind)) {
    return { response: NextResponse.json({ error: "Only Admin, Sales and Accountant users have their own SAP account — Super Admin uses the portal's integration login" }, { status: 403 }) };
  }
  return { adminId: session.adminId };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if (g.response) return g.response;
  return NextResponse.json({ ...(await getSapCredentialStatus(g.adminId)), session: getUserSapSession(g.adminId) });
}

/** Sales accounts may share one SAP user — only System Admin sets it (Users page); the Salesman sees it read only. */
async function guardWrite(request: NextRequest) {
  const session = await getAdminSession(request);
  if (session?.kind === "sales") {
    return { response: NextResponse.json({ error: "Only System Admin sets the SAP user and password of Sales accounts (Users page)" }, { status: 403 }) };
  }
  return guard(request);
}

async function PUTHandler(request: NextRequest) {
  const g = await guardWrite(request);
  if (g.response) return g.response;
  const body = await request.json().catch(() => ({}));
  const sapUserCode = typeof body.sapUserCode === "string" ? body.sapUserCode : "";
  const password = typeof body.password === "string" ? body.password : "";
  try {
    const status = await saveSapCredentials(g.adminId, sapUserCode, password);
    return NextResponse.json({ success: true, ...status, session: getUserSapSession(g.adminId) });
  } catch (error) {
    if (error instanceof SapCredentialError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[SAP account] Save failed:", error);
    return NextResponse.json({ error: "Could not reach SAP to verify the login" }, { status: 502 });
  }
}

async function DELETEHandler(request: NextRequest) {
  const g = await guardWrite(request);
  if (g.response) return g.response;
  await clearSapPassword(g.adminId);
  return NextResponse.json({ success: true });
}

// logBody: false — the body holds the SAP password.
export const PUT = audited({ action: "profile_sap_account_update", entityType: "user", logBody: false }, PUTHandler);
export const DELETE = audited({ action: "profile_sap_account_clear", entityType: "user", logBody: false }, DELETEHandler);
