import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/price-lists/[num]/special-discounts — cached
 * `special_discount` rows for every customer currently assigned this price
 * list (synced from SAP SpecialPrices, real CardCode — see
 * syncSpecialDiscountsForChannel). Read-only cache view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ num: string }> }
) {
  const guard = await requireAdminPermission(request, "price-lists");
  if (guard.response) return guard.response;

  const { num } = await params;
  const priceListNum = parseInt(num, 10);
  if (isNaN(priceListNum)) {
    return NextResponse.json({ error: "Invalid price list number" }, { status: 400 });
  }

  const companyId = getCompanyId();
  const rows = await query(
    `SELECT sd.sap_card_code, c.card_name, sd.sap_item_code, i.item_name_vi, i.item_name_en,
            sd.special_price, sd.discount_percent, sd.valid_from, sd.valid_to, sd.last_synced
     FROM special_discount sd
     JOIN customers c ON c.company_id = sd.company_id AND c.sap_card_code = sd.sap_card_code
     LEFT JOIN items i ON i.company_id = sd.company_id AND i.sap_item_code = sd.sap_item_code
     WHERE sd.company_id = ? AND c.price_list_num = ?
     ORDER BY c.card_name ASC, sd.sap_item_code ASC`,
    [companyId, priceListNum]
  );

  return NextResponse.json({ rows });
}
