import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncSpecialDiscountsForChannel } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/price-lists/[num]/special-discounts/sync — pull SAP
 * SpecialPrices for every local customer currently assigned this price list
 * (e.g. all "GT Channel" customers on "S02. GT Price List") into
 * `special_discount`. One SAP round trip per customer — can take a while
 * for a large channel.
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
    const result = await syncSpecialDiscountsForChannel(priceListNum);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Special discounts sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
