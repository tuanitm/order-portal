import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncPromotionDiscounts } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/promotions/sync — pull the current Promotion Discount
 * snapshot from SAP B1 into the local cache (full replace — see
 * syncPromotionDiscounts).
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "promotions");
  if (guard.response) return guard.response;

  try {
    const result = await syncPromotionDiscounts();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Promotion sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
