import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited } from "@/lib/auditLog";
import { undoApproval, DecisionError } from "@/lib/soApproval/service";
import { SapSessionExpiredError } from "@/lib/sap-b1/userSession";

/**
 * POST /api/admin/approvals/[id]/undo — [id] = SAP Sales Order DocEntry
 * Body: { reason } (required). Takes back the SO's final approval while it
 * isn't on an AR Invoice: an Accountant only their own approval, System Admin
 * anyone's. U_DataStatus goes back to I in SAP, the SO waits in the same
 * stage again. 403 cannot_undo / 409 not_approved / 428 SAP login needed.
 */
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  const docEntry = parseInt((await params).id, 10);
  if (isNaN(docEntry)) return NextResponse.json({ error: "Invalid SAP DocEntry" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (reason.length > 1000) return NextResponse.json({ error: "Reason is too long" }, { status: 400 });
  try {
    const r = await undoApproval(guard.session, docEntry, reason);
    return NextResponse.json({ success: true, ...r });
  } catch (error) {
    if (error instanceof SapSessionExpiredError) return NextResponse.json({ error: error.message, code: "sap_login_required" }, { status: 428 });
    if (error instanceof DecisionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[Approvals] Undo failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Undo failed" }, { status: 502 });
  }
}

export const POST = audited({ action: "so_approval_undo", entityType: "sap_sales_order", entityParam: "id" }, POSTHandler);
