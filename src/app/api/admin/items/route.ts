import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/** Allowed sort columns to prevent SQL injection */
const SORT_COLUMNS: Record<string, string> = {
  sap_item_code: "sap_item_code",
  item_name_vi: "item_name_vi",
  category: "category",
  base_price: "base_price",
  is_active: "is_active",
};

/**
 * GET /api/admin/items — paginated/searchable item list, including inactive
 * items (unlike the customer-facing /api/products, which only shows active).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "items");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const sortKey = searchParams.get("sort") || "sap_item_code";
  const sortDir = searchParams.get("order")?.toUpperCase() === "DESC" ? "DESC" : "ASC";
  const sortCol = SORT_COLUMNS[sortKey] || "sap_item_code";

  const whereClauses: string[] = [];
  const params: string[] = [];
  if (search) {
    whereClauses.push("(item_name_vi LIKE ? OR sap_item_code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM items ${whereSql}`,
    params
  );
  const total = totalRows[0]?.cnt ?? 0;

  const items = await query(
    `SELECT id, sap_item_code, item_name_vi, item_name_en, uom, category, items_group_code,
            item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06,
            base_price, image_url, is_active, is_manually_hidden, last_synced
     FROM items ${whereSql}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ items, total, page, totalPages: Math.ceil(total / limit) });
}
