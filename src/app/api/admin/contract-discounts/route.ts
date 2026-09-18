import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/contract-discounts?cardCode=... — a customer's SAP
 * SpecialPrices (already cached by syncSpecialPricesForCard).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "contract-discounts");
  if (guard.response) return guard.response;

  const cardCode = new URL(request.url).searchParams.get("cardCode")?.trim();
  if (!cardCode) {
    return NextResponse.json({ error: "cardCode query param is required" }, { status: 400 });
  }

  const discounts = await query(
    `SELECT sp.sap_item_code, i.item_name_vi, sp.special_price, sp.discount_percent,
            sp.valid_from, sp.valid_to, sp.last_synced
     FROM special_prices sp
     LEFT JOIN items i ON i.sap_item_code = sp.sap_item_code
     WHERE sp.sap_card_code = ?
     ORDER BY sp.last_synced DESC`,
    [cardCode]
  );

  return NextResponse.json({ discounts });
}
