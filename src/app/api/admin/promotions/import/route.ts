import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { importPromotionDiscountsFromXlsx } from "@/lib/promotionImport";

/**
 * POST /api/admin/promotions/import — load the local GT_Promotion_Detail.xlsx
 * export into the promotion_discount cache (full replace). Primary source
 * for promotions while the SAP API user lacks Query Generator authorization
 * on the promotion UDTs — see syncPromotionDiscounts in sync.ts.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "promotions");
  if (guard.response) return guard.response;

  try {
    const result = await importPromotionDiscountsFromXlsx();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Promotion xlsx import failed:", error);
    return NextResponse.json(
      { error: "Import failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
