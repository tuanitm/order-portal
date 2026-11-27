import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { importArInvoices, type ArImportRow } from "@/lib/arInvoice/excelImport";
import { arErrorResponse } from "../respond";

/**
 * POST /api/admin/ar-invoices/import — AR Invoice (CK) Import Excel.
 * Body: { docDate, dueDate, rows: ArImportRow[], dryRun }. One draft AR Invoice
 * per Customer Code. dryRun = check only (the dialog's preview); otherwise the
 * valid invoices are saved as drafts (not sent to SAP).
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "ar-invoice");
  if (guard.response) return guard.response;
  try {
    const body = (await request.json()) as { docDate?: string; dueDate?: string; rows?: ArImportRow[]; dryRun?: boolean };
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    return NextResponse.json(await importArInvoices(guard.session, {
      docDate: String(body.docDate ?? ""), dueDate: String(body.dueDate ?? ""), rows, dryRun: body.dryRun !== false,
    }));
  } catch (error) {
    return arErrorResponse(error, "Import failed");
  }
}
