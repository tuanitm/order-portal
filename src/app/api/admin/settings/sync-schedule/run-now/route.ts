import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { runScheduledSync, SYNC_GROUPS, type SyncGroupKey } from "@/lib/sap-b1/scheduledSync";
import { audited } from "@/lib/auditLog";

async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  // ?group=master|price|discount|promotion|order_status runs that group only; none = all groups.
  const group = request.nextUrl.searchParams.get("group");
  if (group && !SYNC_GROUPS.some((g) => g.key === group)) {
    return NextResponse.json({ error: `Unknown sync group ${group}` }, { status: 400 });
  }
  try {
    const result = await runScheduledSync(group ? [group as SyncGroupKey] : undefined);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Manual sync run failed:", error);
    return NextResponse.json(
      { error: "Sync run failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const POST = audited({ action: "sync_run_now", entityType: "sync" }, POSTHandler);
