import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { refreshLiveStock, refreshLiveShelfLife } from "@/lib/stock/liveStock";
import { audited } from "@/lib/auditLog";

/**
 * POST — refresh the live stock (option 2) from SAP right now: quantities
 * from HANA, then the batch shelf-life % (the slow part, 5–15 s). Root-only.
 */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  try {
    const stock = await refreshLiveStock();
    const started = Date.now();
    await refreshLiveShelfLife();
    return NextResponse.json({
      success: true,
      status: "success",
      summary: `✓ Live stock: ${stock.rows} rows in ${stock.ms} ms; shelf life in ${Date.now() - started} ms`,
    });
  } catch (error) {
    console.error("[Admin] Live stock refresh failed:", error);
    return NextResponse.json(
      { error: "Live stock refresh failed", message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}

export const POST = audited({ action: "stock_live_refresh", entityType: "sync" }, POSTHandler);
