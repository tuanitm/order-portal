import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncPeriodDiscounts } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/period-discounts/sync — Quick-sync entry point (Dashboard
 * "Quick sync" button): resolves "S02. GT Price List" by name and syncs its
 * period discounts, same as the per-list button on the Price Lists page
 * (/api/admin/price-lists/[num]/period-discounts/sync) but without needing
 * an admin to open that page and pick the list first.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "price-lists");
  if (guard.response) return guard.response;

  const list = await queryOne<{ price_list_num: number }>(
    `SELECT price_list_num FROM price_lists WHERE company_id = ? AND list_name = 'S02. GT Price List' LIMIT 1`,
    [getCompanyId()]
  );
  if (!list) {
    return NextResponse.json(
      { error: "Sync failed", message: `"S02. GT Price List" not found — sync price lists from SAP first.` },
      { status: 404 }
    );
  }

  try {
    const result = await syncPeriodDiscounts(list.price_list_num);
    return NextResponse.json({ success: true, priceListNum: list.price_list_num, ...result });
  } catch (error) {
    console.error("[Admin] Period discounts quick-sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
