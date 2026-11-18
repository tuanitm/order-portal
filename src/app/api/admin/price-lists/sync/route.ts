import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncPriceLists } from "@/lib/sap-b1/sync";
import { audited } from "@/lib/auditLog";

async function POSTHandler(request: NextRequest) {
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

// Every call is written to the audit log (who, role, target, request, outcome).
export const POST = audited({ action: "sync_price_lists", entityType: "sync" }, POSTHandler);
