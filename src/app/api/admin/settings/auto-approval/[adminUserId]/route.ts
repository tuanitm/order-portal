import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited } from "@/lib/auditLog";
import { autoApprovalDetail, saveAutoSetting, startAutoApprovalRun, AutoApprovalError } from "@/lib/soApproval/autoApproval";

/**
 * /api/admin/settings/auto-approval/[adminUserId] — one Accountant's Auto SO
 * Approval, for System Admin (Settings is root-only): same shapes as
 * /api/admin/me/auto-approval. A run still approves only that Accountant's
 * own queue, as their own SAP user.
 */
type Ctx = { params: Promise<{ adminUserId: string }> };
const idOf = async (ctx: Ctx) => {
  const id = parseInt((await ctx.params).adminUserId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function GET(request: NextRequest, ctx: Ctx) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  const sp = request.nextUrl.searchParams;
  return NextResponse.json(await autoApprovalDetail(id, { outcome: sp.get("outcome") ?? undefined, runId: Number(sp.get("runId")) || undefined }));
}

async function PUTHandler(request: NextRequest, ctx: Ctx) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json({ success: true, setting: await saveAutoSetting(id, body, guard.session.adminId ?? 0) });
  } catch (e) {
    if (e instanceof AutoApprovalError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function POSTHandler(request: NextRequest, ctx: Ctx) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  const started = startAutoApprovalRun(id, guard.session.adminId ?? 0);
  return NextResponse.json({ success: started, running: true, message: started ? "Run started" : "A run is already in progress" }, { status: started ? 202 : 409 });
}

export const PUT = audited({ action: "so_auto_approval_update", entityType: "user", entityParam: "adminUserId" }, PUTHandler);
export const POST = audited({ action: "so_auto_approval_run", entityType: "user", entityParam: "adminUserId" }, POSTHandler);
