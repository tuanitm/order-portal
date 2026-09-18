import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncSpecialPricesForCard } from "@/lib/sap-b1/sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> }
) {
  const guard = await requireAdminPermission(request, "contract-discounts");
  if (guard.response) return guard.response;

  const { cardCode } = await params;
  try {
    const result = await syncSpecialPricesForCard(cardCode);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error(`[Admin] Failed to sync contract discounts for ${cardCode}:`, error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
