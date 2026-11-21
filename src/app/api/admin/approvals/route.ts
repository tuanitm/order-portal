import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { listApprovalQueue, type QueueStatus } from "@/lib/soApproval/service";

/**
 * GET /api/admin/approvals — SAP Sales Order approval requests for the
 * caller (their SAP user's lines; Super Admin: all), DocDate on/after
 * Settings → "Approve SO from date", within their data permissions.
 *   ?status=pending|approved|rejected|all  (default pending)
 *   ?brand= &dateFrom=YYYY-MM-DD &dateTo= &soNo= (U_DocNo / DocNum) &bp= (code or name) &creator= (SAP user code)
 * Each row carries the SO header, the request's stage / who it waits for,
 * the customer's AR position and the linked portal order (if any).
 */
const clean = (v: string | null, max = 100) => (v ?? "").trim().slice(0, max) || undefined;

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  const sp = request.nextUrl.searchParams;
  const s = sp.get("status");
  const status: QueueStatus = s === "approved" || s === "rejected" || s === "all" ? s : "pending";
  try {
    const result = await listApprovalQueue(guard.session, {
      status,
      brand: clean(sp.get("brand"), 50),
      dateFrom: clean(sp.get("dateFrom"), 10),
      dateTo: clean(sp.get("dateTo"), 10),
      soNo: clean(sp.get("soNo"), 50),
      bp: clean(sp.get("bp")),
      creator: clean(sp.get("creator"), 50),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Approvals] Queue failed:", error);
    return NextResponse.json({ error: "Failed to load the approval list" }, { status: 500 });
  }
}
