import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncInventoryStock } from "@/lib/sap-b1/sync";
import { audited } from "@/lib/auditLog";

/**
 * POST /api/admin/inventory/sync — pull per-item, per-warehouse stock
 * (on-hand/committed/on-order) from SAP into `item_warehouse_stock`, the
 * table the storefront's stock gate reads from. Full replace, scoped to
 * config.json's masterdata.itemGroup/wareHouse — see syncInventoryStock.
 */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "warehouses");
  if (guard.response) return guard.response;

  try {
    const result = await syncInventoryStock();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Inventory stock sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const POST = audited({ action: "sync_inventory", entityType: "sync" }, POSTHandler);
