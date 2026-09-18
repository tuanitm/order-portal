import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncContractDiscounts } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/contract-discounts/agreements/sync — pull all Contract
 * Discount agreements (SAP CBD headers + lines) into the local cache.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "contract-discounts");
  if (guard.response) return guard.response;

  try {
    const result = await syncContractDiscounts();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Contract discount agreement sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
