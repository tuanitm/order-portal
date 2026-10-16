import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { IMPORT_TEMPLATE_COLUMNS_EN, IMPORT_TEMPLATE_COLUMNS_VI } from "@/lib/importTemplate";

/**
 * GET /api/products/template?locale=vi|en — downloadable .xlsx template for
 * Excel Import (storefront bulk order upload). No auth required — it's a
 * static template with no customer data, same as the product list's own
 * public GET. Headers come from src/lib/importTemplate.ts so they can never
 * drift from what ImportExcelModal's parser expects.
 */
export async function GET(request: NextRequest) {
  const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "vi";
  const headers = locale === "en" ? IMPORT_TEMPLATE_COLUMNS_EN : IMPORT_TEMPLATE_COLUMNS_VI;
  const exampleRow =
    locale === "en"
      ? ["ITEM001", "Example Item", 10, "Optional note"]
      : ["ITEM001", "Hàng mẫu", 10, "Ghi chú (tuỳ chọn)"];

  const sheet = XLSX.utils.aoa_to_sheet([headers as unknown as string[], exampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Template");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="import_template_${locale}.xlsx"`,
    },
  });
}
