import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { audited } from "@/lib/auditLog";
import { decideApproval, DecisionError } from "@/lib/soApproval/service";
import { SapSessionExpiredError } from "@/lib/sap-b1/userSession";

/**
 * POST /api/admin/approvals/[id]/decision — [id] = SAP Sales Order DocEntry
 * Body: { decision: "approved" | "rejected", notes?, stepNotes?: { [checkKey]: note } }
 * Approve: every check that isn't "pass" needs a step note; sets the SAP
 * Sales Order's U_DataStatus to C as the Accountant's own SAP user (428
 * sap_login_required when there's no SAP session). Reject: notes required.
 * Only in the SAP approval stage where the user is an authorizer (403
 * not_your_stage otherwise); outcome = approved / rejected (final) or
 * stage_approved / stage_rejected (waiting for the next stage: waitingFor).
 */
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  const docEntry = parseInt((await params).id, 10);
  if (isNaN(docEntry)) return NextResponse.json({ error: "Invalid SAP DocEntry" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
  if (!decision) return NextResponse.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 });
  const notes = typeof body.notes === "string" ? body.notes : "";
  const stepNotes = body.stepNotes && typeof body.stepNotes === "object" ? body.stepNotes as Record<string, string> : {};
  if (notes.length > 2000 || Object.values(stepNotes).some((v) => String(v).length > 1000)) {
    return NextResponse.json({ error: "Notes are too long" }, { status: 400 });
  }

  try {
    // Every step that isn't a pass needs its own checking note — so a multi-SO approval only goes through
    // for SOs whose six checks all pass; the others are reviewed one by one.
    const r = await decideApproval(guard.session, docEntry, decision, notes, stepNotes);
    return NextResponse.json({ success: true, decision, sapUser: r.sapUser, outcome: r.outcome, waitingFor: r.waitingFor, requestNo: r.requestNo, warning: r.warning });
  } catch (error) {
    if (error instanceof SapSessionExpiredError) {
      return NextResponse.json({ error: error.message, code: "sap_login_required" }, { status: 428 });
    }
    if (error instanceof DecisionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[Approvals] Decision failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Decision failed" }, { status: 502 });
  }
}

// [id] is the SAP DocEntry — logged as a SAP Sales Order, not a portal order id.
export const POST = audited({ action: "so_approval_decision", entityType: "sap_sales_order", entityParam: "id" }, POSTHandler);
