import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncPeriodDiscounts } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/price-lists/[num]/period-discounts/sync — pull this price
 * list's "period discounts" from SAP (SpecialPrices rows SAP itself scopes
 * to the whole list, CardCode = '*{num}') into `period_discount`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ num: string }> }
) {
  const guard = await requireAdminPermission(request, "price-lists");
  if (guard.response) return guard.response;

  const { num } = await params;
  const priceListNum = parseInt(num, 10);
  if (isNaN(priceListNum)) {
    return NextResponse.json({ error: "Invalid price list number" }, { status: 400 });
  }

  try {
    const result = await syncPeriodDiscounts(priceListNum);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Period discounts sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
