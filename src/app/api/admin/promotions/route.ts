import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/promotions — the cached Promotion Discount rows (SAP
 * "@PM_HEADER" via the executePromotionSql SQLQuery), one row per
 * Promotion -> BP/Group -> Item/Group combination. Optional filters:
 * search (promotion_code or promotion_name, partial match), bpCode (partial
 * match against bp_code OR bp_name), itemCode (partial match against
 * selling_item_code OR selling_item_name), activeOnly (begin_date/end_date
 * bracket today), type ("discount_pct" — disc_pct set, or "free_item" —
 * giving_item_code set), validDate (a row is included if this date falls
 * within its own begin_date/end_date window).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "promotions");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const bpCode = searchParams.get("bpCode")?.trim();
  const itemCode = searchParams.get("itemCode")?.trim();
  const activeOnly = searchParams.get("activeOnly") === "true";
  const type = searchParams.get("type")?.trim();
  const validDate = searchParams.get("validDate")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const params: string[] = [];
  if (search) {
    whereClauses.push("(promotion_code LIKE ? OR promotion_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (bpCode) {
    whereClauses.push("(bp_code LIKE ? OR bp_name LIKE ?)");
    params.push(`%${bpCode}%`, `%${bpCode}%`);
  }
  if (itemCode) {
    whereClauses.push("(selling_item_code LIKE ? OR selling_item_name LIKE ?)");
    params.push(`%${itemCode}%`, `%${itemCode}%`);
  }
  if (type === "discount_pct") {
    whereClauses.push("disc_pct IS NOT NULL");
  } else if (type === "free_item") {
    whereClauses.push("giving_item_code IS NOT NULL");
  }
  if (activeOnly) {
    whereClauses.push("(begin_date IS NULL OR begin_date <= CURDATE()) AND (end_date IS NULL OR end_date >= CURDATE())");
  }
  if (validDate) {
    whereClauses.push("(begin_date IS NULL OR begin_date <= ?) AND (end_date IS NULL OR end_date >= ?)");
    params.push(validDate, validDate);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM promotion_discount ${whereSql}`,
    params
  );
  const total = totalRows[0]?.cnt ?? 0;

  const promotions = await query(
    `SELECT id, doc_entry, promotion_code, promotion_name, begin_date, end_date,
            bp_grp_code, bp_grp_name, bp_code, bp_name,
            selling_grp_code, selling_grp_name, selling_item_code, selling_item_name,
            disc_pct, selling_qty, giving_item_code, giving_item_name, giving_qty, last_synced
     FROM promotion_discount ${whereSql}
     ORDER BY begin_date DESC, promotion_code, bp_code, selling_item_code
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ promotions, total, page, totalPages: Math.ceil(total / limit) });
}
