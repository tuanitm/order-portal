import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncCostCenters } from "@/lib/sap-b1/sync";

/** POST /api/admin/cost-centers/sync — pull Brand/Department codes from SAP. */
export async function POST(request: NextRequest) {
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
