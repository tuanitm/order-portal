import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncCostCenters } from "@/lib/sap-b1/sync";
import { audited } from "@/lib/auditLog";

/** POST /api/admin/cost-centers/sync — pull Brand/Department codes from SAP. */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  try {
    const result = await syncCostCenters();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Cost centers sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const POST = audited({ action: "sync_cost_centers", entityType: "sync" }, POSTHandler);
