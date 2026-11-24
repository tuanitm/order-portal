import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getPromotionProgramForSo } from "@/lib/soApproval/service";

/**
 * GET /api/admin/approvals/[id]/promotion?code=GT260100024 — [id] = SAP SO DocEntry.
 * The promotion program behind a PM Code on this SO (its rules for the SO's items),
 * for the SO Approval "PM Code" popup.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  const docEntry = parseInt((await params).id, 10);
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  if (isNaN(docEntry) || !code) return NextResponse.json({ error: "DocEntry and code are required" }, { status: 400 });
  try {
    const program = await getPromotionProgramForSo(guard.session, docEntry, code);
    if (!program) return NextResponse.json({ error: "Sales Order not found" }, { status: 404 });
    return NextResponse.json(program);
  } catch (error) {
    console.error("[Approvals] Promotion lookup failed:", error);
    return NextResponse.json({ error: "Failed to load the promotion program" }, { status: 500 });
  }
}
