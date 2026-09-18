import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncSapCustomers } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/sap-customers/sync — pull SAP customers into the local
 * cache, scoped to the pairs declared in custgroup.json.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "sap-customers");
  if (guard.response) return guard.response;

  try {
    const result = await syncSapCustomers();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] SAP customer sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
