import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncInventoryStock } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/inventory/sync — pull per-item, per-warehouse stock
 * (on-hand/committed/on-order) from SAP into `item_warehouse_stock`, the
 * table the storefront's stock gate reads from.
 */
export async function POST(request: NextRequest) {
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
