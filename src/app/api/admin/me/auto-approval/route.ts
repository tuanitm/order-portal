import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited } from "@/lib/auditLog";
import { autoApprovalDetail, saveAutoSetting, startAutoApprovalRun, AutoApprovalError } from "@/lib/soApproval/autoApproval";

/**
 * /api/admin/me/auto-approval — the signed-in Accountant's own Auto SO Approval.
 *   GET   ?outcome=approved|skipped|failed&runId= — setting, recent runs, per-SO log
 *   PUT   { enabled, windows: [{ start, end, intervalMinutes }] }
 *   POST  — run now (in the background; poll GET for `running`)
 * Accountants only (role kind account) — it approves as their SAP user, on their own queue.
 */
async function guard(request: NextRequest) {
  const g = await requireAdminPermission(request, "so-approval");
  if (g.response) return { response: g.response };
  if (g.session.kind !== "account" || !g.session.adminId) {
    return { response: NextResponse.json({ error: "Auto SO Approval is for Accountant users — System Admin manages it on Settings" }, { status: 403 }) };
  }
  return { adminId: g.session.adminId };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if (g.response) return g.response;
  const sp = request.nextUrl.searchParams;
  return NextResponse.json(await autoApprovalDetail(g.adminId, { outcome: sp.get("outcome") ?? undefined, runId: Number(sp.get("runId")) || undefined }));
}

async function PUTHandler(request: NextRequest) {
  const g = await guard(request);
  if (g.response) return g.response;
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json({ success: true, setting: await saveAutoSetting(g.adminId, body, g.adminId) });
  } catch (e) {
    if (e instanceof AutoApprovalError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function POSTHandler(request: NextRequest) {
  const g = await guard(request);
  if (g.response) return g.response;
  const started = startAutoApprovalRun(g.adminId, g.adminId);
  return NextResponse.json({ success: started, running: true, message: started ? "Run started" : "A run is already in progress" }, { status: started ? 202 : 409 });
}

export const PUT = audited({ action: "so_auto_approval_update", entityType: "setting" }, PUTHandler);
export const POST = audited({ action: "so_auto_approval_run", entityType: "setting" }, POSTHandler);
