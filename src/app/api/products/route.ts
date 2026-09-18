import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getSessionUser } from "@/lib/auth/session";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import type { ProductWithPricing } from "@/types/product";

interface HiddenCategory {
  level: number;
  code: string;
}

/**
 * Resolve which item categories (item_groups, levels 1-3) a customer
 * must NOT see: group-level defaults from `catalog_visibility` (checked at
 * each of the customer's group levels), then per-customer overrides from
 * `customer_item_group_overrides` (wins over the group default). No rule
 * configured for a category = visible.
 */
async function resolveHiddenItemCategories(
  cusGrp01: string | null,
  cusGrp02: string | null,
  cusGrp03: string | null,
  userId: number | null
): Promise<HiddenCategory[]> {
  const visibility = new Map<string, HiddenCategory & { visible: boolean; explicit: boolean }>();
  const key = (level: number, code: string) => `${level}:${code}`;

  const levels: { level: number; code: string }[] = [];
  if (cusGrp01) levels.push({ level: 1, code: cusGrp01 });
  if (cusGrp02) levels.push({ level: 2, code: cusGrp02 });
  if (cusGrp03) levels.push({ level: 3, code: cusGrp03 });

  for (const { level, code } of levels) {
    const rules = await query<
      { item_category_level: number; item_category_code: string; is_visible: number }[]
    >(
      `SELECT cv.item_category_level, cv.item_category_code, cv.is_visible
       FROM catalog_visibility cv
       JOIN customer_groups cg ON cg.id = cv.customer_group_id
       WHERE cg.level = ? AND cg.code = ?`,
      [level, code]
    );
    for (const r of rules) {
      visibility.set(key(r.item_category_level, r.item_category_code), {
        level: r.item_category_level,
        code: r.item_category_code,
        visible: !!r.is_visible,
        explicit: true,
      });
    }
  }

  if (userId) {
    const overrides = await query<
      { item_category_level: number; item_category_code: string; is_visible: number }[]
    >(
      `SELECT item_category_level, item_category_code, is_visible FROM customer_item_group_overrides WHERE user_id = ?`,
      [userId]
    );
    for (const o of overrides) {
      visibility.set(key(o.item_category_level, o.item_category_code), {
        level: o.item_category_level,
        code: o.item_category_code,
        visible: !!o.is_visible,
        explicit: true,
      });
    }
  }

  // ── Item group inheritance: propagate parent visibility to children ──
  // If D1 (level 1) is hidden, also hide D11/D12 (level 2), D111/D112 (level 3), etc.
  const allItemGroups = await query<{ level: number; code: string; parent_code: string | null }[]>(
    `SELECT level, code, parent_code FROM item_groups WHERE level IN (1, 2, 3) ORDER BY level ASC`
  );
  // Process level by level (1→2→3) so parent state is resolved first
  for (let lvl = 2; lvl <= 3; lvl++) {
    for (const ig of allItemGroups.filter((g) => g.level === lvl && g.parent_code)) {
      const parentKey = key(lvl - 1, ig.parent_code!);
      const parentState = visibility.get(parentKey);
      if (parentState) {
        const childKey = key(ig.level, ig.code);
        const childState = visibility.get(childKey);
        // Only inherit if no explicit rule exists for this child
        if (!childState || !childState.explicit) {
          visibility.set(childKey, {
            level: ig.level,
            code: ig.code,
            visible: parentState.visible,
            explicit: false,
          });
        }
      }
    }
  }

  return [...visibility.values()].filter((v) => !v.visible).map((v) => ({ level: v.level, code: v.code }));
}

/**
 * Build `AND items.item_catNN NOT IN (...)` clauses (one per level that has
 * hidden codes) plus the flat params array to bind them — one placeholder
 * per value, since db.execute() (prepared statements) does not expand an
 * array into an IN-list the way db.query() would.
 */
function buildHiddenCategoryClauses(hidden: HiddenCategory[]): { clauses: string[]; params: string[] } {
  const byLevel = new Map<number, string[]>();
  for (const h of hidden) {
    if (!byLevel.has(h.level)) byLevel.set(h.level, []);
    byLevel.get(h.level)!.push(h.code);
  }

  const clauses: string[] = [];
  const params: string[] = [];
  for (const [level, codes] of byLevel) {
    const col = `item_cat${String(level).padStart(2, "0")}`;
    clauses.push(`${col} NOT IN (${codes.map(() => "?").join(",")})`);
    params.push(...codes);
  }
  return { clauses, params };
}

interface ProductRow {
  id: number;
  sap_item_code: string;
  item_name_vi: string | null;
  item_name_en: string | null;
  uom: string | null;
  pack_size: string | null;
  category: string | null;
  base_price: string; // DECIMAL comes back as string from mysql2
  image_url: string | null;
  is_active: number;
  channel_price: string | null;
  contract_disc_pct: string | null;
  promo_disc_pct: string | null;
  promo_name: string | null;
}

/**
 * GET /api/products — List products with pricing.
 *
 * Final price = Base Price − Contract Discount amount − Promotion Discount
 * amount, where "Base Price" is the customer's applicable price-list price
 * (their channel price list, falling back to the base list if they have no
 * channel price cached) and each discount amount is that Base Price × the
 * best-matching discount's percent.
 *
 * A discount (from `contract_discount` or `promotion_discount`) matches a
 * (customer, item) pair if its customer code equals the customer's own BP
 * code OR one of their customer-group codes (cus_grp01-03/sap_cus_grp01-03),
 * AND its item code equals the item's own code OR one of its item-group
 * codes (item_cat01-06) — i.e. a discount can target an exact BP/item or any
 * level of the customer-group/item-group hierarchy. Among multiple matches
 * for the same item, the MOST SPECIFIC wins: exact BP beats any group match,
 * exact item beats any group match, and among group matches a deeper/more
 * specific level outranks a shallower one (see the CASE-based scoring in the
 * SQL below). Only currently-valid rows count (validity dates straddle
 * today, and for contract_discount, not canceled).
 *
 * Only percent-type promotions with no real quantity-break gate (`selling_qty`
 * NULL or <= 1, i.e. applies from the first unit) are folded into this listing
 * price — a promo whose discount only kicks in past a *higher* quantity break
 * can't be resolved to a single price before the customer has chosen a
 * quantity. Free/bonus-item promos (`giving_item_code`) don't affect the
 * selling item's own price and are out of scope for this listing.
 *
 * Anonymous/unapproved users have no BP/group codes, so no discount can match
 * and they only ever see the base price-list price.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const category = searchParams.get("category")?.trim() || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "24", 10) || 24));
    const offset = (page - 1) * limit;

    const user = await getSessionUser(request);
    const sapCardCode = user?.approvalStatus === "approved" ? user.sapCardCode : null;
    const priceListNum = user?.approvalStatus === "approved" ? user.sapPriceListNum : null;
    const cusGrp01 = user?.approvalStatus === "approved" ? user.sapCusGrp01 : null;
    const cusGrp02 = user?.approvalStatus === "approved" ? user.sapCusGrp02 : null;
    const cusGrp03 = user?.approvalStatus === "approved" ? user.sapCusGrp03 : null;

    const hiddenCategories = user?.approvalStatus === "approved"
      ? await resolveHiddenItemCategories(user.sapCusGrp01, user.sapCusGrp02, user.sapCusGrp03, user.id)
      : [];
    const { clauses: hiddenClauses, params: hiddenParams } = buildHiddenCategoryClauses(hiddenCategories);

    const whereClauses = ["i.is_active = TRUE", "i.is_manually_hidden = FALSE", ...hiddenClauses];
    const params: (string | number)[] = [...hiddenParams];

    if (search) {
      whereClauses.push("(i.item_name_vi LIKE ? OR i.item_name_en LIKE ? OR i.sap_item_code LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
      whereClauses.push("i.category = ?");
      params.push(category);
    }
    const whereSql = whereClauses.join(" AND ");

    const totalRows = await query<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM items i WHERE ${whereSql}`,
      params
    );
    const total = totalRows[0]?.cnt ?? 0;

    const categoryWhereClauses = [
      "is_active = TRUE", "is_manually_hidden = FALSE", "category IS NOT NULL", "category != ''", ...hiddenClauses,
    ];
    const categoryRows = await query<{ category: string }[]>(
      `SELECT DISTINCT category FROM items WHERE ${categoryWhereClauses.join(" AND ")} ORDER BY category ASC`,
      hiddenParams
    );
    const categories = categoryRows.map((c) => c.category);

    const basePriceListNum = await getBasePriceListNum();

    // "" never matches a real SAP code — safe stand-ins for an
    // anonymous/unapproved customer with no BP/group codes at all.
    const custCode = sapCardCode ?? "";
    const grp01 = cusGrp01 ?? "";
    const grp02 = cusGrp02 ?? "";
    const grp03 = cusGrp03 ?? "";

    const rows = await query<ProductRow[]>(
      `SELECT i.id, i.sap_item_code, i.item_name_vi, i.item_name_en, i.uom, i.pack_size,
              i.category, i.base_price, i.image_url, i.is_active,
              cp.price AS channel_price,
              cd_best.pct AS contract_disc_pct,
              promo_best.pct AS promo_disc_pct, promo_best.name AS promo_name
       FROM items i
       LEFT JOIN item_channel_prices cp
         ON cp.sap_item_code = i.sap_item_code AND cp.price_list_num = ?
       LEFT JOIN LATERAL (
         SELECT cd.u_base_disc_pct AS pct
         FROM contract_discount cd
         WHERE (cd.canceled IS NULL OR cd.canceled != 'Y')
           AND cd.u_code_cust IN (?, ?, ?, ?)
           AND cd.u_code_item IN (i.sap_item_code, i.item_cat01, i.item_cat02, i.item_cat03, i.item_cat04, i.item_cat05, i.item_cat06)
           AND (cd.u_valid_from IS NULL OR cd.u_valid_from <= CURDATE())
           AND (cd.u_valid_to IS NULL OR cd.u_valid_to >= CURDATE())
         ORDER BY
           (CASE WHEN cd.u_code_item = i.sap_item_code THEN 600
                 WHEN cd.u_code_item = i.item_cat06 THEN 60
                 WHEN cd.u_code_item = i.item_cat05 THEN 50
                 WHEN cd.u_code_item = i.item_cat04 THEN 40
                 WHEN cd.u_code_item = i.item_cat03 THEN 30
                 WHEN cd.u_code_item = i.item_cat02 THEN 20
                 WHEN cd.u_code_item = i.item_cat01 THEN 10
                 ELSE 0 END)
           +
           (CASE WHEN cd.u_code_cust = ? THEN 600
                 WHEN cd.u_code_cust = ? THEN 300
                 WHEN cd.u_code_cust = ? THEN 200
                 WHEN cd.u_code_cust = ? THEN 100
                 ELSE 0 END) DESC,
           cd.u_base_disc_pct DESC
         LIMIT 1
       ) cd_best ON TRUE
       LEFT JOIN LATERAL (
         SELECT pd.disc_pct AS pct, pd.promotion_name AS name
         FROM promotion_discount pd
         WHERE pd.disc_pct IS NOT NULL
           AND (pd.selling_qty IS NULL OR pd.selling_qty <= 1)
           AND (pd.begin_date IS NULL OR pd.begin_date <= CURDATE())
           AND (pd.end_date IS NULL OR pd.end_date >= CURDATE())
           AND (pd.bp_code IN (?, ?, ?, ?) OR pd.bp_grp_code IN (?, ?, ?))
           AND (pd.selling_item_code = i.sap_item_code OR pd.selling_grp_code IN (i.item_cat01, i.item_cat02, i.item_cat03, i.item_cat04, i.item_cat05, i.item_cat06))
         ORDER BY
           (CASE WHEN pd.selling_item_code = i.sap_item_code THEN 600 WHEN pd.selling_grp_code IS NOT NULL THEN 60 ELSE 0 END)
           +
           (CASE WHEN pd.bp_code = ? THEN 600
                 WHEN pd.bp_code IN (?, ?, ?) THEN 200
                 WHEN pd.bp_grp_code IN (?, ?, ?) THEN 100
                 ELSE 0 END) DESC,
           pd.disc_pct DESC
         LIMIT 1
       ) promo_best ON TRUE
       WHERE ${whereSql}
       ORDER BY i.item_name_vi ASC
       LIMIT ? OFFSET ?`,
      [
        priceListNum ?? basePriceListNum,
        custCode, grp01, grp02, grp03, // contract WHERE u_code_cust IN list
        custCode, grp03, grp02, grp01, // contract ORDER BY customer-specificity weights
        custCode, grp01, grp02, grp03, grp01, grp02, grp03, // promo WHERE bp_code IN (4) / bp_grp_code IN (3)
        custCode, grp01, grp02, grp03, grp01, grp02, grp03, // promo ORDER BY bp-specificity weights (exact / bp_code-group / bp_grp_code-group)
        ...params,
        limit, offset,
      ]
    );

    const items: ProductWithPricing[] = rows.map((row) => {
      const basePrice = Number(row.base_price);
      const channelPrice = row.channel_price !== null ? Number(row.channel_price) : null;
      const priceBeforeDiscounts = channelPrice && channelPrice > 0 ? channelPrice : basePrice;

      const contractDiscPct = row.contract_disc_pct !== null ? Number(row.contract_disc_pct) : 0;
      const promoDiscPct = row.promo_disc_pct !== null ? Number(row.promo_disc_pct) : 0;

      const contractDiscountAmount = priceBeforeDiscounts * (contractDiscPct / 100);
      const promotionDiscountAmount = priceBeforeDiscounts * (promoDiscPct / 100);

      const displayPrice = Math.max(0, priceBeforeDiscounts - contractDiscountAmount - promotionDiscountAmount);

      const discountPercent =
        displayPrice < basePrice && basePrice > 0
          ? Math.round(((basePrice - displayPrice) / basePrice) * 100)
          : null;

      return {
        id: row.id,
        sapItemCode: row.sap_item_code,
        itemNameVi: row.item_name_vi || "",
        itemNameEn: row.item_name_en || "",
        uom: row.uom || "",
        packSize: row.pack_size || "",
        category: row.category || "",
        basePrice,
        imageUrl: row.image_url,
        isActive: !!row.is_active,
        displayPrice,
        specialPrice: displayPrice < basePrice ? displayPrice : null,
        discountPercent,
        hasPromotion: promoDiscPct > 0,
        promotionTitle: promoDiscPct > 0 ? row.promo_name || undefined : undefined,
      };
    });

    return NextResponse.json({
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      categories,
    });
  } catch (error) {
    console.error("[API] List products error:", error);
    return NextResponse.json(
      { error: "Failed to list products" },
      { status: 500 }
    );
  }
}
