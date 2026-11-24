import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { decideArInvoice, ArError } from "@/lib/arInvoice/service";
import { arErrorResponse, idOf } from "../../respond";

/** POST { decision: "approved" | "rejected", remarks } — decide on SAP's approval request as the user's own SAP user. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    const body = (await request.json()) as { decision?: string; remarks?: string };
    if (body.decision !== "approved" && body.decision !== "rejected") throw new ArError("decision must be approved or rejected");
    return NextResponse.json(await decideArInvoice(guard.session, await idOf(params), body.decision, String(body.remarks ?? "")));
  } catch (error) {
    return arErrorResponse(error, "Failed to record the decision");
  }
}
