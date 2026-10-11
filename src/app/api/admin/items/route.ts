import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getAllowedItemGroupCodes, groupScopeClause } from "@/lib/adminScope";

/** Allowed sort columns to prevent SQL injection */
const SORT_COLUMNS: Record<string, string> = {
  sap_item_code: "i.sap_item_code",
  item_name_vi: "i.item_name_vi",
  category: "i.category",
  base_price: "i.base_price",
  is_active: "i.is_active",
};

/**
 * GET /api/admin/items — paginated/searchable item list, including inactive
 * items (unlike the customer-facing /api/products, which only shows active).
 * `brand` is `items.category` — the resolved name of the item's level-1 item
 * group, which already doubles as the storefront's brand label/filter chips
 * (e.g. "PIGEON", "ETSUKO" — see syncItems). `item_group_l2` is the resolved
 * NAME of the item's level-2 item group specifically, distinct from
 * `item_group_chain` (the full level 1-6 code chain, e.g. "D1 / D11 / D111").
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
  const sortCol = SORT_COLUMNS[sortKey] || "i.sap_item_code";

  const whereClauses: string[] = [];
  const params: string[] = [];
  if (search) {
    whereClauses.push("(i.item_name_vi LIKE ? OR i.sap_item_code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  // A scoped (non-root) admin only sees items under their assigned item
  // groups (and descendants) — an item matches if ANY of its 6 category
  // levels falls in that set. See getAllowedItemGroupCodes.
  const allowedItemGroups = await getAllowedItemGroupCodes(guard.session);
  const scope = groupScopeClause(allowedItemGroups, [
    "i.item_cat01", "i.item_cat02", "i.item_cat03", "i.item_cat04", "i.item_cat05", "i.item_cat06",
  ]);
  whereClauses.push(scope.sql);
  params.push(...scope.params);

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM items i ${whereSql}`,
    params
  );
  const total = totalRows[0]?.cnt ?? 0;

  const items = await query(
    `SELECT i.id, i.sap_item_code, i.item_name_vi, i.item_name_en, i.uom, i.sales_uom,
            i.category AS brand, ig2.name AS item_group_l2, i.items_group_code,
            i.item_cat01, i.item_cat02, i.item_cat03, i.item_cat04, i.item_cat05, i.item_cat06,
            i.base_price, i.image_url, i.is_active, i.is_manually_hidden, i.last_synced
     FROM items i
     LEFT JOIN item_groups ig2 ON ig2.level = 2 AND ig2.code = i.item_cat02
     ${whereSql}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ items, total, page, totalPages: Math.ceil(total / limit) });
}
