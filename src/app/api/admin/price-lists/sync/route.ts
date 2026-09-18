import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncPriceLists } from "@/lib/sap-b1/sync";

export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "price-lists");
  if (guard.response) return guard.response;

  try {
    const result = await syncPriceLists();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Price list sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
