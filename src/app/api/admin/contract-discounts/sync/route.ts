import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncSpecialPricesForCard } from "@/lib/sap-b1/sync";

/**
 * POST /api/admin/contract-discounts/sync — bulk-refresh SpecialPrices for
 * every approved customer with a SAP card code. Sequential (not
 * Promise.all) to avoid hammering the SAP session with concurrent requests.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "contract-discounts");
  if (guard.response) return guard.response;

  const customers = await query<{ sap_card_code: string }[]>(
    `SELECT sap_card_code FROM users WHERE approval_status = 'approved' AND sap_card_code IS NOT NULL`
  );

  let customersSynced = 0;
  let totalPricesSynced = 0;
  const errors: string[] = [];

  for (const { sap_card_code } of customers) {
    try {
      const result = await syncSpecialPricesForCard(sap_card_code);
      customersSynced++;
      totalPricesSynced += result.pricesSynced;
    } catch (error) {
      errors.push(sap_card_code);
      console.error(`[Admin] Failed to sync contract discounts for ${sap_card_code}:`, error);
    }
  }

  return NextResponse.json({
    success: true,
    customersSynced,
    totalPricesSynced,
    failedCardCodes: errors,
  });
}
