import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { generateArInvoice } from "@/lib/arInvoice/service";
import { arErrorResponse, idOf } from "../../respond";

/** POST — add the approved SAP draft as the A/R Invoice. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    return NextResponse.json(await generateArInvoice(guard.session, await idOf(params)));
  } catch (error) {
    return arErrorResponse(error, "Failed to add the approved AR Invoice");
  }
}
