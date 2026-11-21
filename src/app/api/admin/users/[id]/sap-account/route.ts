import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited } from "@/lib/auditLog";
import { saveSapCredentials, clearSapPassword, getSapCredentialStatus, SapCredentialError } from "@/lib/sap-b1/userCredentials";

/**
 * PUT/DELETE /api/admin/users/[id]/sap-account — Super Admin sets (or clears)
 * an Accountant's SAP B1 user + password. Same rules as My Profile: only for
 * users with an Accountant role, verified by an SAP login, stored
 * Fernet-encrypted. Body never logged (logBody: false).
 */
async function guardRoot(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard;
  if (!guard.session.isSuperAdmin) return { response: NextResponse.json({ error: "Only Super Admin" }, { status: 403 }) };
  return guard;
}

async function PUTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardRoot(request);
  if (guard.response) return guard.response;
  const userId = parseInt((await params).id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  try {
    const status = await saveSapCredentials(
      userId,
      typeof body.sapUserCode === "string" ? body.sapUserCode : "",
      typeof body.password === "string" ? body.password : ""
    );
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    if (error instanceof SapCredentialError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[Users] SAP account save failed:", error);
    return NextResponse.json({ error: "Could not reach SAP to verify the login" }, { status: 502 });
  }
}

async function DELETEHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardRoot(request);
  if (guard.response) return guard.response;
  const userId = parseInt((await params).id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  await clearSapPassword(userId);
  return NextResponse.json({ success: true, ...(await getSapCredentialStatus(userId)) });
}

export const PUT = audited({ action: "admin_user_sap_account_update", entityType: "user", entityParam: "id", logBody: false }, PUTHandler);
export const DELETE = audited({ action: "admin_user_sap_account_clear", entityType: "user", entityParam: "id", logBody: false }, DELETEHandler);
