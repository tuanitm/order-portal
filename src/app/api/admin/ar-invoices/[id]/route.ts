import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getArInvoice, saveArInvoice, deleteArInvoice, ArError, type ArInvoiceInput } from "@/lib/arInvoice/service";
import { arErrorResponse, idOf } from "../respond";

type Ctx = { params: Promise<{ id: string }> };

/** GET (with SAP approval progress, refreshed from SAP) · PUT (save the draft) · DELETE (a draft not in SAP) */
export async function GET(request: NextRequest, { params }: Ctx) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    const detail = await getArInvoice(guard.session, await idOf(params));
    if (!detail) throw new ArError("AR Invoice not found", 404);
    return NextResponse.json(detail);
  } catch (error) {
    return arErrorResponse(error, "Failed to load AR Invoice");
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    const body = (await request.json()) as ArInvoiceInput;
    return NextResponse.json({ id: await saveArInvoice(guard.session, await idOf(params), body) });
  } catch (error) {
    return arErrorResponse(error, "Failed to save AR Invoice");
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    await deleteArInvoice(guard.session, await idOf(params));
    return NextResponse.json({ success: true });
  } catch (error) {
    return arErrorResponse(error, "Failed to delete AR Invoice");
  }
}
