import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { postArInvoice } from "@/lib/arInvoice/service";
import { arErrorResponse, idOf } from "../../respond";

/** POST — add the AR Invoice to SAP as the user's own SAP user (SAP may hold it for approval). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    return NextResponse.json(await postArInvoice(guard.session, await idOf(params)));
  } catch (error) {
    return arErrorResponse(error, "Failed to post AR Invoice to SAP");
  }
}
