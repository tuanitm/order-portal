import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";

/**
 * GET /api/admin/price-lists/[num] — item-level pricing for one price list,
 * mirroring the SAP B1 client's own Price List screen: each item's own
 * "Base Price List" (which list SAP derived this list's price from — may be
 * this same list, meaning the price is set directly here, not derived),
 * the Factor, the resolved Base Price (that base list's own price for the
 * item), and the final Price (already SAP-resolved; Base Price × Factor).
 * Paginated/searchable, same shape as GET /api/admin/items.
 *
 * Normally only items with a cached row in `item_channel_prices` for this
 * list are returned (that table is populated per tracked list — base or
 * channel — by syncItems, so an untracked list has none). The one
 * exception: when `num` IS the price list currently flagged as Base (see
 * price_lists.is_base), every active item is shown even before its
 * `item_channel_prices` row exists yet, falling back to `items.base_price`
 * — syncItems already computes that column from this exact list, so it's
 * not a guess, just read from where it already landed. This covers the gap
 * right after a price list is first marked Base: items synced before that
 * point have no item_channel_prices row for it yet (only the next Items
 * sync backfills one), but items.base_price itself is still correct once
 * Items has been synced at least once since the Base flag was set.
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

  const companyId = getCompanyId();
  const isBaseList = priceListNum === (await getBasePriceListNum());

  if (isBaseList) {
    const whereClauses: string[] = ["i.company_id = ?", "i.is_active = TRUE"];
    const baseParams: (string | number)[] = [companyId];
    if (search) {
      whereClauses.push("(i.item_name_vi LIKE ? OR i.item_name_en LIKE ? OR i.sap_item_code LIKE ?)");
      baseParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const totalRows = await query<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM items i ${whereSql}`,
      baseParams
    );
    const total = totalRows[0]?.cnt ?? 0;

    const items = await query(
      `SELECT i.sap_item_code, i.item_name_vi, i.item_name_en, COALESCE(i.sales_uom, i.uom) AS uom, i.category,
              COALESCE(cp.base_price_list_num, ?) AS base_price_list_num,
              COALESCE(bpl.list_name, selfbpl.list_name) AS base_price_list_name,
              COALESCE(bp.price, i.base_price) AS base_price,
              COALESCE(cp.factor, 1) AS factor,
              COALESCE(cp.price, i.base_price) AS price,
              cp.last_synced
       FROM items i
       LEFT JOIN item_channel_prices cp
         ON cp.company_id = i.company_id AND cp.sap_item_code = i.sap_item_code AND cp.price_list_num = ?
       LEFT JOIN price_lists bpl ON bpl.company_id = i.company_id AND bpl.price_list_num = cp.base_price_list_num
       LEFT JOIN item_channel_prices bp
         ON bp.company_id = i.company_id AND bp.sap_item_code = i.sap_item_code AND bp.price_list_num = cp.base_price_list_num
       LEFT JOIN price_lists selfbpl ON selfbpl.company_id = i.company_id AND selfbpl.price_list_num = ?
       ${whereSql}
       ORDER BY i.item_name_vi ASC
       LIMIT ? OFFSET ?`,
      [priceListNum, priceListNum, priceListNum, ...baseParams, limit, offset]
    );

    return NextResponse.json({ items, total, page, totalPages: Math.ceil(total / limit) });
  }

  const whereClauses: string[] = ["cp.company_id = ?", "cp.price_list_num = ?"];
  const params_: (string | number)[] = [companyId, priceListNum];
  if (search) {
    whereClauses.push("(i.item_name_vi LIKE ? OR i.item_name_en LIKE ? OR i.sap_item_code LIKE ?)");
    params_.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM item_channel_prices cp
     JOIN items i ON i.company_id = cp.company_id AND i.sap_item_code = cp.sap_item_code ${whereSql}`,
    params_
  );
  const total = totalRows[0]?.cnt ?? 0;

  const items = await query(
    `SELECT i.sap_item_code, i.item_name_vi, i.item_name_en, COALESCE(i.sales_uom, i.uom) AS uom, i.category,
            cp.base_price_list_num, bpl.list_name AS base_price_list_name,
            bp.price AS base_price, cp.factor, cp.price, cp.last_synced
     FROM item_channel_prices cp
     JOIN items i ON i.company_id = cp.company_id AND i.sap_item_code = cp.sap_item_code
     LEFT JOIN price_lists bpl ON bpl.company_id = cp.company_id AND bpl.price_list_num = cp.base_price_list_num
     LEFT JOIN item_channel_prices bp
       ON bp.company_id = cp.company_id AND bp.sap_item_code = cp.sap_item_code AND bp.price_list_num = cp.base_price_list_num
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

  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only Super Admin can modify Base and Channel settings for price lists" }, { status: 403 });
  }

  const { num } = await params;
  const priceListNum = parseInt(num, 10);
  if (isNaN(priceListNum)) {
    return NextResponse.json({ error: "Invalid price list number" }, { status: 400 });
  }

  const body = await request.json();
  const companyId = getCompanyId();
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (typeof body.isBase === "boolean") {
      if (body.isBase) {
        await conn.execute(`UPDATE price_lists SET is_base = FALSE WHERE company_id = ? AND price_list_num != ?`, [companyId, priceListNum]);
      }
      await conn.execute(`UPDATE price_lists SET is_base = ? WHERE company_id = ? AND price_list_num = ?`, [
        body.isBase,
        companyId,
        priceListNum,
      ]);
    }
    if (typeof body.isChannel === "boolean") {
      await conn.execute(`UPDATE price_lists SET is_channel = ? WHERE company_id = ? AND price_list_num = ?`, [
        body.isChannel,
        companyId,
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
