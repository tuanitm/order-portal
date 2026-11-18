import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getVatRates } from "@/lib/vatRates";

/**
 * GET /api/orders/vat-rates?items=A,B,C — VAT % per item code (from the item's
 * SAP VAT group), for the checkout's tax preview. An item whose rate isn't
 * known is left out.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const codes = [...new Set((request.nextUrl.searchParams.get("items") || "").split(",").map((c) => c.trim()).filter(Boolean))].slice(0, 500);
  if (codes.length === 0) return NextResponse.json({ rates: {} });

  const [vatRates, items] = await Promise.all([
    getVatRates(),
    query<{ sap_item_code: string; vat_group: string | null }[]>(
      `SELECT sap_item_code, vat_group FROM items WHERE company_id = ? AND sap_item_code IN (${codes.map(() => "?").join(",")})`,
      [getCompanyId(), ...codes]
    ),
  ]);
  const rates: Record<string, number> = {};
  for (const i of items) {
    const rate = i.vat_group ? vatRates.get(i.vat_group) : undefined;
    if (rate !== undefined) rates[i.sap_item_code] = rate;
  }
  return NextResponse.json({ rates });
}
