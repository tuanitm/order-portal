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
  buy_qty: string | null;
  give_item_code: string | null;
  give_item_name: string | null;
  give_qty: string | null;
}

/**
 * The bp_type/it_type match condition shared by every promotion_discount
 * LATERAL join below (percent-discount and buy-give alike) — see the GET
 * docstring for what these columns mean. Takes the alias to qualify columns
 * with (distinct LATERAL subqueries can't share one alias) and returns the
 * SQL text; the caller still needs to bind 4 bp params (exact/CG1/CG2/CG3)
 * for the bp clause — there are no params for the it clause (all column-to-column).
 */
function promotionMatchSql(alias: string): { bpSql: string; itSql: string; scoreSql: string } {
  return {
    bpSql: `(
      (${alias}.bp_type = '2' AND ${alias}.bp_code = ?)
      OR (${alias}.bp_type = 'CG1' AND ${alias}.bp_code = ?)
      OR (${alias}.bp_type = 'CG2' AND ${alias}.bp_code = ?)
      OR (${alias}.bp_type = 'CG3' AND ${alias}.bp_code = ?)
      OR (${alias}.bp_type IS NULL AND ${alias}.bp_code IS NULL)
    )`,
    itSql: `(
      (${alias}.it_type = '4' AND ${alias}.selling_item_code = i.sap_item_code)
      OR (${alias}.it_type = 'IC1' AND ${alias}.selling_item_code = i.item_cat01)
      OR (${alias}.it_type = 'IC2' AND ${alias}.selling_item_code = i.item_cat02)
      OR (${alias}.it_type = 'IC3' AND ${alias}.selling_item_code = i.item_cat03)
      OR (${alias}.it_type = 'IC4' AND ${alias}.selling_item_code = i.item_cat04)
      OR (${alias}.it_type = 'IC5' AND ${alias}.selling_item_code = i.item_cat05)
      OR (${alias}.it_type = 'IC6' AND ${alias}.selling_item_code = i.item_cat06)
    )`,
    scoreSql: `(
      (CASE ${alias}.it_type
         WHEN '4' THEN 600 WHEN 'IC6' THEN 60 WHEN 'IC5' THEN 50 WHEN 'IC4' THEN 40
         WHEN 'IC3' THEN 30 WHEN 'IC2' THEN 20 WHEN 'IC1' THEN 10 ELSE 0 END)
      +
      (CASE ${alias}.bp_type
         WHEN '2' THEN 600 WHEN 'CG3' THEN 300 WHEN 'CG2' THEN 200 WHEN 'CG1' THEN 100 ELSE 0 END)
    )`,
  };
}

/**
 * GET /api/products — List products with pricing.
 *
 * Price flow (sequential, not additive): Base Price -> Contract Discount
 * Price -> Promotion Discount Price (the final displayed price). "Base
 * Price" is the customer's applicable price-list price (their channel price
 * list, falling back to items.base_price if they have no channel price
 * cached). The Contract Discount Price is Base Price with the best-matching
 * contract_discount percent taken off; the Promotion Discount Price then
 * takes the best-matching promotion_discount percent off THAT
 * already-discounted price (compounding, not both computed off the
 * original base). The `basePrice`/strikethrough and `discountPercent`
 * returned to the client are this SAME reference price (priceBeforeDiscounts)
 * — never items.base_price (S01) when a channel price exists — so the
 * displayed "% off" always matches the price the discount was actually
 * taken from, even when a channel list prices an item above or below S01.
 *
 * Resolving that channel price (`cp_base.price` below): find the customer's
 * own item_channel_prices row (price_list_num = users.sap_price_list_num for
 * their sap_card_code), then read the price from item_channel_prices AGAIN
 * at price_list_num = that row's own base_price_list_num. When a list prices
 * an item directly (base_price_list_num = its own price_list_num), this
 * joins back to the same row, so it's a no-op; when a list derives an item's
 * price from another list (e.g. S02 GT Price List deriving from S01 IMV
 * Price List), this always reads the SOURCE list's own price rather than
 * trusting the derived row's own cached `price` value.
 *
 * A discount (from `contract_discount` or `promotion_discount`) matches a
 * (customer, item) pair if its customer code equals the customer's own BP
 * code OR one of their customer-group codes at any of the 3 BP-group levels
 * (cus_grp01-03/sap_cus_grp01-03), AND its item code equals the item's own
 * code OR one of its item-group codes at any of the 6 item-group levels
 * (item_cat01-06) — i.e. a discount targeting a group applies to every BP
 * under that BP group (and its sub-groups) or every item under that item
 * group (and its sub-groups), not just members of that exact group level.
 * When several currently-valid discounts co-exist for the same (customer,
 * item) — e.g. one targeting BP-group level 1, another level 2, another
 * level 3, another the exact BP itself — the MOST SPECIFIC (deepest) one
 * wins: exact BP > level-3 group > level-2 group > level-1 group, and
 * likewise exact item > level-6 group > ... > level-1 group on the item
 * side. Only currently-valid rows count (validity dates straddle today, and
 * for contract_discount, not canceled).
 *
 * `contract_discount` has no type column, so its `u_code_cust`/`u_code_item`
 * are matched by trying every level (existence-check against the code
 * itself or item_cat01-06/cus_grp01-03) and ranking by which level matched.
 * `promotion_discount`, by contrast, carries authoritative `bp_type`/
 * `it_type` columns that say EXACTLY what `bp_code`/`selling_item_code`
 * contain — bp_type='2' (exact BP) or 'CG1'/'CG2'/'CG3' (a customer_groups
 * code at that level); it_type='4' (exact item) or 'IC1'..'IC6' (an
 * item_groups code at that level) — so its matching is a direct, deterministic
 * lookup by type rather than a guess-every-level fallback. `bp_grp_code`/
 * `selling_grp_code` are NOT customer_groups/item_groups codes at all — just
 * free-text labels (e.g. "GT.TOILETRIES") — and are display-only, never used
 * for matching. A row with `bp_type` AND `bp_code` both NULL has no customer
 * restriction at all (applies to every customer) — it's still eligible, just
 * ranked below any row with a real BP/group match.
 *
 * Only percent-type promotions with no real quantity-break gate (`selling_qty`
 * NULL or <= 1, i.e. applies from the first unit) are folded into this listing
 * price — a promo whose discount only kicks in past a *higher* quantity break
 * can't be resolved to a single price before the customer has chosen a
 * quantity. Free/bonus-item promos (`giving_item_code`) don't affect the
 * selling item's own price, but ARE still resolved and returned per item
 * (`promoBuyQty`/`promoGiveItemCode`/`promoGiveItemName`/`promoGiveQty`) —
 * same bp_type/it_type matching/specificity as the percent-discount join,
 * just against `giving_item_code IS NOT NULL` rows instead, with no
 * `selling_qty <= 1` restriction (a buy-give promo's `selling_qty` IS its
 * "buy N" threshold).
 *
 * Anonymous/unapproved users have no BP/group codes, so no discount can match
 * and they only ever see the base price-list price.
 *
 * Query params: `promoOnly=true` restricts the listing to items with a
 * currently-valid promotion (percent OR buy-give) — the storefront's
 * "Khuyến mãi" tab. `sort=discount` orders by combined discount % (contract
 * + promotion) descending instead of by name; combine both for that tab.
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

    // Skipped when promoOnly — that filter depends on the LATERAL-joined
    // promo/giveaway matches computed further down, which this simple count
    // query doesn't have; its `total` is derived from the filtered/sorted
    // JS array length instead (see below).
    const promoOnly = searchParams.get("promoOnly") === "true";
    let total = 0;
    if (!promoOnly) {
      const totalRows = await query<{ cnt: number }[]>(
        `SELECT COUNT(*) as cnt FROM items i WHERE ${whereSql}`,
        params
      );
      total = totalRows[0]?.cnt ?? 0;
    }

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

    // promoOnly + sort=discount back the "Khuyến mãi" storefront tab: only
    // items with a currently-valid promotion (percent OR buy-give), ranked
    // by combined discount % — which can't be expressed as a plain SQL
    // ORDER BY (it depends on the same sequential contract->promo compounding
    // computed below in JS), so this mode fetches a capped, unpaginated set
    // and sorts/paginates in JS instead of at the SQL level.
    const sortByDiscount = searchParams.get("sort") === "discount";
    const DISCOUNT_SORT_CAP = 2000;

    const promoMatch = promotionMatchSql("pd");
    const giveMatch = promotionMatchSql("pd2");
    const promoOnlyClause = promoOnly ? " AND (promo_best.pct IS NOT NULL OR giveaway_best.give_code IS NOT NULL)" : "";

    const rows = await query<ProductRow[]>(
      `SELECT i.id, i.sap_item_code, i.item_name_vi, i.item_name_en, i.uom, i.pack_size,
              i.category, i.base_price, i.image_url, i.is_active,
              cp_base.price AS channel_price,
              cd_best.pct AS contract_disc_pct,
              promo_best.pct AS promo_disc_pct, promo_best.name AS promo_name,
              giveaway_best.buy_qty AS buy_qty, giveaway_best.give_code AS give_item_code,
              giveaway_best.give_name AS give_item_name, giveaway_best.give_qty AS give_qty
       FROM items i
       LEFT JOIN item_channel_prices cp
         ON cp.sap_item_code = i.sap_item_code AND cp.price_list_num = ?
       LEFT JOIN item_channel_prices cp_base
         ON cp_base.sap_item_code = i.sap_item_code AND cp_base.price_list_num = cp.base_price_list_num
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
           AND ${promoMatch.bpSql}
           AND ${promoMatch.itSql}
         ORDER BY ${promoMatch.scoreSql} DESC, pd.disc_pct DESC
         LIMIT 1
       ) promo_best ON TRUE
       LEFT JOIN LATERAL (
         SELECT pd2.selling_qty AS buy_qty, pd2.giving_item_code AS give_code,
                pd2.giving_item_name AS give_name, pd2.giving_qty AS give_qty
         FROM promotion_discount pd2
         WHERE pd2.giving_item_code IS NOT NULL
           AND (pd2.begin_date IS NULL OR pd2.begin_date <= CURDATE())
           AND (pd2.end_date IS NULL OR pd2.end_date >= CURDATE())
           AND ${giveMatch.bpSql}
           AND ${giveMatch.itSql}
         ORDER BY ${giveMatch.scoreSql} DESC, pd2.giving_qty DESC
         LIMIT 1
       ) giveaway_best ON TRUE
       WHERE ${whereSql}${promoOnlyClause}
       ORDER BY i.item_name_vi ASC
       LIMIT ?${sortByDiscount ? "" : " OFFSET ?"}`,
      [
        priceListNum ?? basePriceListNum,
        custCode, grp01, grp02, grp03, // contract WHERE u_code_cust IN list
        custCode, grp03, grp02, grp01, // contract ORDER BY customer-specificity weights
        custCode, grp01, grp02, grp03, // promo WHERE bp_type='2'/'CG1'/'CG2'/'CG3' match
        custCode, grp01, grp02, grp03, // giveaway WHERE bp_type='2'/'CG1'/'CG2'/'CG3' match
        ...params,
        ...(sortByDiscount ? [DISCOUNT_SORT_CAP] : [limit, offset]),
      ]
    );

    const items: ProductWithPricing[] = rows.map((row) => {
      const sapBasePrice = Number(row.base_price); // items.base_price (S01) — only used as the fallback when there's no channel price row at all
      const channelPrice = row.channel_price !== null ? Number(row.channel_price) : null;
      // The actual reference price the discount waterfall is taken from —
      // and, per the customer's request, also what's shown as "Base Price"/
      // the strikethrough and what discountPercent is computed against, so
      // the displayed "% off" always matches the price that was really cut.
      const priceBeforeDiscounts = channelPrice && channelPrice > 0 ? channelPrice : sapBasePrice;

      const contractDiscPct = row.contract_disc_pct !== null ? Number(row.contract_disc_pct) : 0;
      const promoDiscPct = row.promo_disc_pct !== null ? Number(row.promo_disc_pct) : 0;

      // Sequential flow: Base Price -> Contract Discount Price -> Promotion
      // Discount Price. The promotion discount is applied on top of the
      // already contract-discounted price, not off the original base.
      const contractPrice = priceBeforeDiscounts * (1 - contractDiscPct / 100);
      const promotionPrice = contractPrice * (1 - promoDiscPct / 100);

      const displayPrice = Math.max(0, promotionPrice);

      const discountPercent =
        displayPrice < priceBeforeDiscounts && priceBeforeDiscounts > 0
          ? Math.round(((priceBeforeDiscounts - displayPrice) / priceBeforeDiscounts) * 100)
          : null;

      return {
        id: row.id,
        sapItemCode: row.sap_item_code,
        itemNameVi: row.item_name_vi || "",
        itemNameEn: row.item_name_en || "",
        uom: row.uom || "",
        packSize: row.pack_size || "",
        category: row.category || "",
        basePrice: priceBeforeDiscounts,
        imageUrl: row.image_url,
        isActive: !!row.is_active,
        displayPrice,
        specialPrice: displayPrice < priceBeforeDiscounts ? displayPrice : null,
        discountPercent,
        hasPromotion: promoDiscPct > 0,
        promotionTitle: promoDiscPct > 0 ? row.promo_name || undefined : undefined,
        hasBuyGivePromo: row.give_item_code !== null,
        promoBuyQty: row.buy_qty !== null ? Number(row.buy_qty) : undefined,
        promoGiveItemCode: row.give_item_code || undefined,
        promoGiveItemName: row.give_item_name || undefined,
        promoGiveQty: row.give_qty !== null ? Number(row.give_qty) : undefined,
      };
    });

    // "Khuyến mãi" tab: rank by combined discount % descending (computed
    // above per-item, can't be expressed as a SQL ORDER BY — see comment at
    // the query), then paginate the already-fetched, already-filtered set.
    // Tie-break: among equal discount %, an item that ALSO has a buy-give
    // bonus-item promo ranks above one that doesn't — more benefit shown first.
    if (sortByDiscount) {
      items.sort((a, b) => {
        const discountDiff = (b.discountPercent ?? -1) - (a.discountPercent ?? -1);
        if (discountDiff !== 0) return discountDiff;
        return Number(b.hasBuyGivePromo) - Number(a.hasBuyGivePromo);
      });
      total = items.length;
      const paged = items.slice(offset, offset + limit);
      return NextResponse.json({
        items: paged,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        categories,
      });
    }

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
