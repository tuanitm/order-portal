import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncWarehouses } from "@/lib/sap-b1/sync";
import { audited } from "@/lib/auditLog";

/** POST /api/admin/warehouses/sync — pull the warehouse list from SAP. */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "warehouses");
  if (guard.response) return guard.response;

  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only Super Admin can sync warehouses" }, { status: 403 });
  }

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

// Every call is written to the audit log (who, role, target, request, outcome).
export const POST = audited({ action: "sync_warehouses", entityType: "sync" }, POSTHandler);
