import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { listArInvoices, saveArInvoice, type ArInvoiceInput } from "@/lib/arInvoice/service";
import { importSapArRequests } from "@/lib/arInvoice/sapImport";
import { arErrorResponse } from "./respond";

/**
 * GET  /api/admin/ar-invoices?status=&search=&from=&to=&waiting=1 — AR Invoices within the user's customer scope
 *      (entered on the portal + approval requests raised in SAP, see lib/arInvoice/sapImport.ts)
 * POST /api/admin/ar-invoices — create a draft (not sent to SAP yet)
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  const sp = request.nextUrl.searchParams;
  try {
    // Pick up the newest requests raised in the SAP client (the scheduler does the rest every minute).
    await importSapArRequests({ limit: 10 }).catch((e) => console.warn("[AR Invoice] SAP request import failed:", e));
    return NextResponse.json(await listArInvoices(guard.session, {
      status: sp.get("status") ?? undefined, search: sp.get("search") ?? undefined,
      from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, waiting: sp.get("waiting") === "1", brand: sp.get("brand") ?? undefined,
    }));
  } catch (error) {
    return arErrorResponse(error, "Failed to load AR Invoices");
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    const body = (await request.json()) as ArInvoiceInput;
    return NextResponse.json({ id: await saveArInvoice(guard.session, null, body) });
  } catch (error) {
    return arErrorResponse(error, "Failed to save AR Invoice");
  }
}
