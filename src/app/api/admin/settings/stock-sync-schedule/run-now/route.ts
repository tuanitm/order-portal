import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { runScheduledStockSync } from "@/lib/sap-b1/stockSyncSchedule";
import { audited } from "@/lib/auditLog";
import { getStockSettings } from "@/lib/stock/liveStock";

/** POST — run the Inventory Stock sync immediately (records its last-run status like a scheduled run). */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  // Option 2 (live from SAP) replaces the scheduled stock sync.
  if ((await getStockSettings()).source === "live") {
    return NextResponse.json(
      { error: "Live stock (option 2) is selected — the scheduled stock sync is disabled. Use Refresh live stock instead." },
      { status: 409 }
    );
  }

  try {
    const result = await runScheduledStockSync();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Manual stock sync run failed:", error);
    return NextResponse.json(
      { error: "Stock sync run failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export const POST = audited({ action: "stock_sync_run_now", entityType: "sync" }, POSTHandler);
