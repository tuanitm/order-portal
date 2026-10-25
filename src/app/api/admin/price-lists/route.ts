import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "price-lists");
  if (guard.response) return guard.response;

  const rows = await query(
    `SELECT price_list_num, list_name, is_base, is_channel, last_synced FROM price_lists WHERE company_id = ? ORDER BY price_list_num ASC`,
    [getCompanyId()]
  );
  return NextResponse.json({ priceLists: rows });
}
