import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/session";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { getVisibleWarehousesForCustomerGroup } from "@/lib/warehouseVisibility";
import { getCustomerRoleScope, customerItemScopeClauses, customerStockWarehouses } from "@/lib/customerRoleScope";
import {
  resolveHiddenItemCategories,
  buildHiddenCategoryClauses,
  buildStockGateClause,
  buildPriceGateClause,
  queryPricedProducts,
  type PricingContext,
} from "@/lib/pricing/productPricing";
import { getStorefrontStockTable } from "@/lib/stock/liveStock";
import type { ProductWithPricing } from "@/types/product";

/**
 * Short in-memory cache of the product list. The result only depends on the
 * pricing context (customer code + groups + price list, warehouses, stock
 * table) and the query (search, tab, page) — the storefront's default tabs
 * ("Khuyến mãi", each brand) price up to 2,000 items per request to sort them
 * by discount, so the same customer reopening the store or switching tabs back
 * and forth gets the stored page instead. 30 s: stock syncs every 10 minutes
 * and prices/promotions hourly at most, so a page is never noticeably stale.
 * Per server process; at most CACHE_MAX entries (oldest dropped first).
 */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 500;
const productCache = new Map<string, { at: number; body: unknown }>();
function cacheGet(key: string): unknown | null {
  const hit = productCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { productCache.delete(key); return null; }
  return hit.body;
}
function cachePut(key: string, body: unknown) {
  if (productCache.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of productCache) if (now - v.at > CACHE_TTL_MS) productCache.delete(k);
    while (productCache.size >= CACHE_MAX) productCache.delete(productCache.keys().next().value as string);
  }
  productCache.set(key, { at: Date.now(), body });
}

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

    // The setup lookups don't depend on each other — run them together.
    // WHICH warehouses count for THIS customer: if their level-2 customer
    // group has at least one mapping in `customer_group_warehouses` (set on
    // the Catalog Visibility page), only those warehouses count; otherwise
    // fall back to every globally Included warehouse — same fail-open rule,
    // so an unmapped group never loses visibility. The stock table is the
    // scheduled-sync one or the live one (refreshed from SAP if due) — see
    // src/lib/stock/liveStock.ts.
    const [hiddenCategories, roleScope, visibleWarehouses, basePriceListNum] = await Promise.all([
      user?.approvalStatus === "approved"
        ? resolveHiddenItemCategories(user.sapCusGrp01, user.sapCusGrp02, user.sapCusGrp03)
        : Promise.resolve([]),
      // The customer's role: Brands / Product Groups limit the items (none set = no limit).
      getCustomerRoleScope(user?.id),
      getVisibleWarehousesForCustomerGroup(cusGrp02),
      getBasePriceListNum(),
    ]);
    const hidden = buildHiddenCategoryClauses(hiddenCategories);
    const roleItems = await customerItemScopeClauses(roleScope);
    const hiddenClauses = [...hidden.clauses, ...roleItems.clauses];
    const hiddenParams: (string | number | null)[] = [...hidden.params, ...roleItems.params];

    // The role's Warehouses, when set, replace the customer group's.
    const stockWarehouseCodes = customerStockWarehouses(roleScope, visibleWarehouses.map((w) => w.code));
    // No warehouses (guest, unmapped customer) = no stock gate — don't touch
    // (or, in live mode, refresh from SAP) a stock table that won't be read.
    const stockTable = stockWarehouseCodes.length > 0 ? await getStorefrontStockTable() : "item_warehouse_stock";

    const ctx: PricingContext = {
      sapCardCode: sapCardCode ?? "",
      cusGrp01: cusGrp01 ?? "",
      cusGrp02: cusGrp02 ?? "",
      cusGrp03: cusGrp03 ?? "",
      priceListNum,
      basePriceListNum,
      stockWarehouseCodes,
      stockTable,
    };

    const promoOnly = searchParams.get("promoOnly") === "true";
    const sortByDiscount = searchParams.get("sort") === "discount";
    const cacheKey = JSON.stringify([companyId, ctx, hiddenClauses, hiddenParams, search, category, page, limit, promoOnly, sortByDiscount]);
    const cached = cacheGet(cacheKey);
    if (cached) return NextResponse.json(cached, { headers: { "X-Products-Cache": "hit" } });

    // The COUNT(*) query can't reuse queryPricedProducts' full LATERAL-joined
    // query (that would compute pricing for rows never shown) — it needs its
    // own copy of just the WHERE clause, including the SAME stock-gate
    // fragment (buildStockGateClause) so "how many" and "which ones" never
    // disagree on what's visible.
    const countWhereClauses = ["i.company_id = ?", "i.is_active = TRUE", "i.is_manually_hidden = FALSE", ...hiddenClauses];
    const countParams: (string | number | null)[] = [companyId, ...hiddenParams];
    const stockGate = buildStockGateClause(stockWarehouseCodes, companyId, ctx.cusGrp01, ctx.cusGrp02, ctx.cusGrp03, stockTable);
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
    // Count, category chips and the product page are independent queries —
    // started together and awaited below, so the page costs the slowest of
    // them rather than their sum.
    const totalPromise: Promise<number> = promoOnly
      ? Promise.resolve(0)
      : query<{ cnt: number }[]>(
          `SELECT COUNT(*) as cnt FROM items i WHERE ${countWhereClauses.join(" AND ")}`,
          countParams
        ).then((rows) => rows[0]?.cnt ?? 0);

    // Ordered by brand code (items.brand_code — SAP's U_ProdBrand, e.g. "D1"
    // = PIGEON), not alphabetically by name, so the storefront's brand chips
    // read "All, Promotion, Pigeon (D1), Etsuko (N1), ..." in the business's
    // own brand-code order rather than whatever order the names happen to
    // sort in. A category with no brand_code at all (shouldn't normally
    // happen) sorts after every coded one rather than before.
    const categoryPriceGate = buildPriceGateClause(companyId, priceListNum ?? ctx.basePriceListNum, "i");
    const categoryWhereClauses = [
      "company_id = ?", "is_active = TRUE", "is_manually_hidden = FALSE", "category IS NOT NULL", "category != ''", ...hiddenClauses,
      categoryPriceGate.clause,
    ];
    const categoryRowsPromise = query<{ category: string; brand_code: string | null }[]>(
      `SELECT category, MIN(brand_code) AS brand_code FROM items i
       WHERE ${categoryWhereClauses.join(" AND ")}
       GROUP BY category
       ORDER BY (MIN(brand_code) IS NULL) ASC, MIN(brand_code) ASC, category ASC`,
      [companyId, ...hiddenParams, ...categoryPriceGate.params]
    );

    // promoOnly + sort=discount back the "Khuyến mãi" storefront tab: only
    // items with a currently-valid promotion (percent OR buy-give), ranked
    // by combined discount % — which can't be expressed as a plain SQL
    // ORDER BY (it depends on the same sequential contract->promo compounding
    // computed inside queryPricedProducts), so this mode fetches a capped,
    // unpaginated set and sorts/paginates in JS instead of at the SQL level.
    const DISCOUNT_SORT_CAP = 2000;
    if (promoOnly) {
      extraWhereSql.push("(promo_options.options IS NOT NULL OR giveaway_options.options IS NOT NULL)");
    }

    const orderLimitSql = `ORDER BY i.item_name_vi ASC LIMIT ?${sortByDiscount ? "" : " OFFSET ?"}`;
    const orderLimitParams = sortByDiscount ? [DISCOUNT_SORT_CAP] : [limit, offset];

    const [items, categoryRows, countedTotal]: [ProductWithPricing[], { category: string }[], number] = await Promise.all([
      queryPricedProducts(ctx, hiddenClauses, hiddenParams, extraWhereSql, extraWhereParams, orderLimitSql, orderLimitParams),
      categoryRowsPromise,
      totalPromise,
    ]);
    const categories = categoryRows.map((c) => c.category);
    let total = countedTotal;

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
      const body = { items: paged, total, page, totalPages: Math.ceil(total / limit), categories };
      cachePut(cacheKey, body);
      return NextResponse.json(body);
    }

    const body = { items, total, page, totalPages: Math.ceil(total / limit), categories };
    cachePut(cacheKey, body);
    return NextResponse.json(body);
  } catch (error) {
    console.error("[API] List products error:", error);
    return NextResponse.json(
      { error: "Failed to list products" },
      { status: 500 }
    );
  }
}
