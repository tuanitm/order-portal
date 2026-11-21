import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getApprovalDetail } from "@/lib/soApproval/service";

/**
 * GET /api/admin/approvals/[id]?recheck=1 — [id] = SAP Sales Order DocEntry. One SO for approval: SAP
 * header, customer AR / credit position, the six checks (cached 15 min;
 * recheck=1 runs them again), decision history and the caller's SAP session.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "so-approval");
  if (guard.response) return guard.response;
  const docEntry = parseInt((await params).id, 10);
  if (isNaN(docEntry)) return NextResponse.json({ error: "Invalid SAP DocEntry" }, { status: 400 });
  try {
    const detail = await getApprovalDetail(guard.session, docEntry, request.nextUrl.searchParams.get("recheck") === "1");
    if (!detail) return NextResponse.json({ error: "Sales Order not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[Approvals] Detail failed:", error);
    return NextResponse.json({ error: "Failed to load the order" }, { status: 500 });
  }
}
