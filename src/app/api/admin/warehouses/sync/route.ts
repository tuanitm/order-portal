import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncWarehouses } from "@/lib/sap-b1/sync";

/** POST /api/admin/warehouses/sync — pull the warehouse list from SAP. */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "warehouses");
  if (guard.response) return guard.response;

  try {
    const result = await syncWarehouses();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Warehouses sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
