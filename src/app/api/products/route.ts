import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/session";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { getVisibleWarehousesForCustomerGroup } from "@/lib/warehouseVisibility";
import {
  resolveHiddenItemCategories,
  buildHiddenCategoryClauses,
  buildStockGateClause,
  buildPriceGateClause,
  queryPricedProducts,
  type PricingContext,
} from "@/lib/pricing/productPricing";
import type { ProductWithPricing } from "@/types/product";

/**
 * GET /api/products — List products with pricing.
 *
 * The discount waterfall (Channel -> Period -> Contract -> Promotion),
 * visibility rules, and the stock gate are all implemented once in
 * src/lib/pricing/productPricing.ts (see queryPricedProducts' own
 * docstring there for the full price-flow explanation) — this route is a
 * thin wrapper around it that adds the storefront-specific concerns:
 * fuzzy `search`/`category` filtering, pagination, the `categories` facet
 * list, and the `promoOnly`/`sort=discount` "Khuyến mãi" tab behavior. The
 * same pricing core also backs POST /api/products/batch (exact-code lookup
 * for Excel Import), so both callers can never drift apart.
 *
 * Query params: `search` (fuzzy LIKE on name/code), `category` (exact),
 * `page`/`limit`, `promoOnly=true` (only items with a currently-valid
 * promotion, percent or buy-give), `sort=discount` (rank by combined
 * discount % descending instead of by name — combine with promoOnly for
 * the "Khuyến mãi" tab).
 *
 * Anonymous/unapproved users have no BP/group codes, so no discount can
 * match and they only ever see the base price-list price.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = getCompanyId();
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
      ? await resolveHiddenItemCategories(user.sapCusGrp01, user.sapCusGrp02, user.sapCusGrp03)
      : [];
    const { clauses: hiddenClauses, params: hiddenParams } = buildHiddenCategoryClauses(hiddenCategories);

    // WHICH warehouses count for THIS customer: if their level-2 customer
    // group has at least one mapping in `customer_group_warehouses` (set on
    // the Catalog Visibility page), only those warehouses count; otherwise
    // fall back to every globally Included warehouse — same fail-open rule,
    // so an unmapped group never loses visibility.
    const visibleWarehouses = await getVisibleWarehousesForCustomerGroup(cusGrp02);
    const stockWarehouseCodes = visibleWarehouses.map((w) => w.code);

    const ctx: PricingContext = {
      sapCardCode: sapCardCode ?? "",
      cusGrp01: cusGrp01 ?? "",
      cusGrp02: cusGrp02 ?? "",
      cusGrp03: cusGrp03 ?? "",
      priceListNum,
      basePriceListNum: await getBasePriceListNum(),
      stockWarehouseCodes,
    };

    // The COUNT(*) query can't reuse queryPricedProducts' full LATERAL-joined
    // query (that would compute pricing for rows never shown) — it needs its
    // own copy of just the WHERE clause, including the SAME stock-gate
    // fragment (buildStockGateClause) so "how many" and "which ones" never
    // disagree on what's visible.
    const countWhereClauses = ["i.company_id = ?", "i.is_active = TRUE", "i.is_manually_hidden = FALSE", ...hiddenClauses];
    const countParams: (string | number | null)[] = [companyId, ...hiddenParams];
    const stockGate = buildStockGateClause(stockWarehouseCodes, companyId, ctx.cusGrp01, ctx.cusGrp02, ctx.cusGrp03);
    if (stockGate.clause) {
      countWhereClauses.push(stockGate.clause);
      countParams.push(...stockGate.params);
    }
    // Never count a 0-priced or unpriced item — see buildPriceGateClause.
    const priceGate = buildPriceGateClause(companyId, priceListNum ?? ctx.basePriceListNum);
    countWhereClauses.push(priceGate.clause);
    countParams.push(...priceGate.params);

    const extraWhereSql: string[] = [];
    const extraWhereParams: (string | number | null)[] = [];
    if (search) {
      extraWhereSql.push("(i.item_name_vi LIKE ? OR i.item_name_en LIKE ? OR i.sap_item_code LIKE ?)");
      extraWhereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      countWhereClauses.push("(i.item_name_vi LIKE ? OR i.item_name_en LIKE ? OR i.sap_item_code LIKE ?)");
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
      extraWhereSql.push("i.category = ?");
      extraWhereParams.push(category);
      countWhereClauses.push("i.category = ?");
      countParams.push(category);
    }

    // Skipped when promoOnly — that filter depends on the LATERAL-joined
    // promo/giveaway matches queryPricedProducts computes, which this simple
    // count query doesn't have; its `total` is derived from the filtered/
    // sorted JS array length instead (see below).
    const promoOnly = searchParams.get("promoOnly") === "true";
    let total = 0;
    if (!promoOnly) {
      const totalRows = await query<{ cnt: number }[]>(
        `SELECT COUNT(*) as cnt FROM items i WHERE ${countWhereClauses.join(" AND ")}`,
        countParams
      );
      total = totalRows[0]?.cnt ?? 0;
    }

    // Ordered by brand code (items.brand_code — SAP's U_ProdBrand, e.g. "D1"
    // = PIGEON), not alphabetically by name, so the storefront's brand chips
    // read "All, Promotion, Pigeon (D1), Etsuko (N1), ..." in the business's
    // own brand-code order rather than whatever order the names happen to
    // sort in. A category with no brand_code at all (shouldn't normally
    // happen) sorts after every coded one rather than before.
    const categoryPriceGate = buildPriceGateClause(companyId, priceListNum ?? ctx.basePriceListNum, "items");
    const categoryWhereClauses = [
      "company_id = ?", "is_active = TRUE", "is_manually_hidden = FALSE", "category IS NOT NULL", "category != ''", ...hiddenClauses,
      categoryPriceGate.clause,
    ];
    const categoryRows = await query<{ category: string; brand_code: string | null }[]>(
      `SELECT category, MIN(brand_code) AS brand_code FROM items
       WHERE ${categoryWhereClauses.join(" AND ")}
       GROUP BY category
       ORDER BY (MIN(brand_code) IS NULL) ASC, MIN(brand_code) ASC, category ASC`,
      [companyId, ...hiddenParams, ...categoryPriceGate.params]
    );
    const categories = categoryRows.map((c) => c.category);

    // promoOnly + sort=discount back the "Khuyến mãi" storefront tab: only
    // items with a currently-valid promotion (percent OR buy-give), ranked
    // by combined discount % — which can't be expressed as a plain SQL
    // ORDER BY (it depends on the same sequential contract->promo compounding
    // computed inside queryPricedProducts), so this mode fetches a capped,
    // unpaginated set and sorts/paginates in JS instead of at the SQL level.
    const sortByDiscount = searchParams.get("sort") === "discount";
    const DISCOUNT_SORT_CAP = 2000;
    if (promoOnly) {
      extraWhereSql.push("(promo_options.options IS NOT NULL OR giveaway_options.options IS NOT NULL)");
    }

    const orderLimitSql = `ORDER BY i.item_name_vi ASC LIMIT ?${sortByDiscount ? "" : " OFFSET ?"}`;
    const orderLimitParams = sortByDiscount ? [DISCOUNT_SORT_CAP] : [limit, offset];

    const items: ProductWithPricing[] = await queryPricedProducts(
      ctx, hiddenClauses, hiddenParams, extraWhereSql, extraWhereParams, orderLimitSql, orderLimitParams
    );

    // "Khuyến mãi" tab: rank by combined discount % descending (computed
    // inside queryPricedProducts, can't be expressed as a SQL ORDER BY — see
    // comment above), then paginate the already-fetched, already-filtered
    // set. Tie-break: among equal discount %, an item that ALSO has a
    // buy-give bonus-item promo ranks above one that doesn't.
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
