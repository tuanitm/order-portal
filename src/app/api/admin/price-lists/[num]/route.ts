import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/price-lists/[num] — item-level pricing for one price list,
 * mirroring the SAP B1 client's own Price List screen: each item's own
 * "Base Price List" (which list SAP derived this list's price from — may be
 * this same list, meaning the price is set directly here, not derived),
 * the Factor, the resolved Base Price (that base list's own price for the
 * item), and the final Price (already SAP-resolved; Base Price × Factor).
 * Paginated/searchable, same shape as GET /api/admin/items. Only items with
 * a cached price for this list are returned (item_channel_prices is
 * populated per tracked list — base or channel — by syncItems, so an
 * untracked list has none).
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

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = ["cp.price_list_num = ?"];
  const params_: (string | number)[] = [priceListNum];
  if (search) {
    whereClauses.push("(i.item_name_vi LIKE ? OR i.item_name_en LIKE ? OR i.sap_item_code LIKE ?)");
    params_.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM item_channel_prices cp
     JOIN items i ON i.sap_item_code = cp.sap_item_code ${whereSql}`,
    params_
  );
  const total = totalRows[0]?.cnt ?? 0;

  const items = await query(
    `SELECT i.sap_item_code, i.item_name_vi, i.item_name_en, i.uom, i.category,
            cp.base_price_list_num, bpl.list_name AS base_price_list_name,
            bp.price AS base_price, cp.factor, cp.price, cp.last_synced
     FROM item_channel_prices cp
     JOIN items i ON i.sap_item_code = cp.sap_item_code
     LEFT JOIN price_lists bpl ON bpl.price_list_num = cp.base_price_list_num
     LEFT JOIN item_channel_prices bp
       ON bp.sap_item_code = cp.sap_item_code AND bp.price_list_num = cp.base_price_list_num
     ${whereSql}
     ORDER BY i.item_name_vi ASC
     LIMIT ? OFFSET ?`,
    [...params_, limit, offset]
  );

  return NextResponse.json({ items, total, page, totalPages: Math.ceil(total / limit) });
}

/**
 * PATCH /api/admin/price-lists/[num] — toggle whether a price list is the
 * base ("original price") list or a customer-assignable channel list.
 * Body: { isBase?: boolean, isChannel?: boolean }
 * Setting isBase=true clears it on every other list (only one base allowed).
 */
export async function PATCH(
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

  const body = await request.json();
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (typeof body.isBase === "boolean") {
      if (body.isBase) {
        await conn.execute(`UPDATE price_lists SET is_base = FALSE WHERE price_list_num != ?`, [priceListNum]);
      }
      await conn.execute(`UPDATE price_lists SET is_base = ? WHERE price_list_num = ?`, [
        body.isBase,
        priceListNum,
      ]);
    }
    if (typeof body.isChannel === "boolean") {
      await conn.execute(`UPDATE price_lists SET is_channel = ? WHERE price_list_num = ?`, [
        body.isChannel,
        priceListNum,
      ]);
    }

    await conn.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    await conn.rollback();
    console.error("[Admin] Price list update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}
