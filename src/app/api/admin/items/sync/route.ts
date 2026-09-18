import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncItems } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/items/sync — pull sellable items + channel price lists
 * from SAP B1 into the local MySQL cache. Run item-groups/sync and mark
 * groups sellable first if this returns itemsSynced: 0.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "items");
  if (guard.response) return guard.response;

  try {
    const result = await syncItems();
    console.log(`[Admin] Item sync complete: ${result.itemsSynced} items`);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Item sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
