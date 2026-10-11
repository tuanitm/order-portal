import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/price-lists/[num]/period-discounts — cached `period_discount`
 * rows for this price list (synced from SAP SpecialPrices, CardCode = '*NN'
 * — see syncPeriodDiscounts). Read-only cache view, same auth as the rest of
 * the Price Lists page.
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

  const rows = await query(
    `SELECT pd.sap_item_code, i.item_name_vi, i.item_name_en, COALESCE(i.sales_uom, i.uom) AS uom,
            pd.base_price, pd.discount_percent, pd.special_price, pd.date_from, pd.date_to, pd.last_synced
     FROM period_discount pd
     LEFT JOIN items i ON i.sap_item_code = pd.sap_item_code
     WHERE pd.price_list_num = ?
     ORDER BY i.item_name_vi ASC, pd.sap_item_code ASC`,
    [priceListNum]
  );

  return NextResponse.json({ rows });
}
