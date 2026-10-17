import { query } from "@/lib/db/connection";
import type { ProductWithPricing } from "@/types/product";

/**
 * The shared pricing core behind both GET /api/products (search/paginated
 * storefront listing) and POST /api/products/batch (exact-code lookup for
 * Excel Import) — extracted so the discount waterfall (Channel -> Period ->
 * Contract -> Promotion) and the visibility/stock-gate rules are defined
 * ONCE and can never drift between the two callers. See queryPricedProducts'
 * own docstring for the full price-flow explanation (moved here verbatim
 * from the former GET handler's docstring).
 */

export interface HiddenCategory {
  level: number;
  code: string;
}

/**
 * Resolve which item categories (item_groups, levels 1-3) a customer must
 * NOT see: group-level defaults from `catalog_visibility`, checked at each
 * of the customer's group levels. No rule configured for a category =
 * visible. (Per-customer overrides were removed — group-level rules are now
 * the only source.)
 */
export async function resolveHiddenItemCategories(
  cusGrp01: string | null,
  cusGrp02: string | null,
  cusGrp03: string | null
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
export function buildHiddenCategoryClauses(hidden: HiddenCategory[]): { clauses: string[]; params: string[] } {
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
  period_disc_pct: string | null;
  contract_disc_pct: string | null;
  available_qty: string | null;
  brand_code: string | null;
  brand_name_display: string | null;
  // Every currently-valid candidate promotion/giveaway program for this
  // (customer, item) pair, as a JSON array built by JSON_ARRAYAGG — mysql2
  // may hand this back already-parsed (JSON result type) or as a raw string
  // depending on driver/version, so parseJsonArray() below handles both.
  promo_options_json: unknown;
  giveaway_options_json: unknown;
}

/** One candidate percent-discount promotion program for an item, as returned by the promo_options LATERAL join. `score` is internal (specificity ranking) and stripped before reaching the client. */
interface PromoOptionRow {
  code: string | null;
  name: string | null;
  pct: number;
  score: number;
}

/** One candidate buy-X-get-Y promotion program for an item, as returned by the giveaway_options LATERAL join. `score` is internal and stripped before reaching the client. */
interface GiveawayOptionRow {
  code: string | null;
  name: string | null;
  buyQty: number;
  giveCode: string;
  giveName: string | null;
  giveQty: number;
  score: number;
}

/**
 * A single PROGRAM (promotion_code) can have several matching RULE rows for
 * the same (customer, item) pair at once — e.g. one row targeting the
 * customer's exact CardCode and another targeting their customer group,
 * both satisfied simultaneously — and the promo_options/giveaway_options
 * LATERAL joins' JSON_ARRAYAGG has no way to collapse those into one entry
 * (it aggregates per-row, not per-program). Dedupe here by `identityFn` so a
 * customer never sees — or React never gets a duplicate key for — the exact
 * same rule listed twice. Keeps the first (highest-score, per the caller's
 * own prior sort) occurrence of each identity.
 *
 * `identityFn` must capture everything that makes two entries genuinely the
 * SAME choice to the customer, not just the same program — a promo_code
 * alone is enough for promoOptions (one program = one %), but a single
 * promotion program can legitimately offer several DIFFERENT free items off
 * the same selling item (e.g. promo "GT261000011" on item D17423101 giving
 * a choice of D73405202, D73405103, or D73405104) — all 3 rows share the
 * same code (and usually the same name), so deduping giveawayOptions by code
 * alone would wrongly collapse 3 real choices down to 1. Callers must
 * include giveCode in the identity for giveawayOptions.
 */
function dedupeByIdentity<T>(options: T[], identityFn: (o: T) => string): T[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    const identity = identityFn(o);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

/**
 * JSON_ARRAYAGG results come back as a JS array (recent mysql2 auto-parses
 * JSON-typed result columns) or, depending on driver/version, as a raw JSON
 * string — handle both rather than assuming one.
 */
function parseJsonArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * The bp_type/it_type match condition shared by every promotion_discount
 * LATERAL join below (percent-discount and buy-give alike) — see
 * queryPricedProducts' docstring for what these columns mean. Takes the
 * alias to qualify columns with (distinct LATERAL subqueries can't share one
 * alias) and returns the SQL text; the caller still needs to bind 4 bp
 * params (exact/CG1/CG2/CG3) for the bp clause — there are no params for the
 * it clause (all column-to-column).
 */
export function promotionMatchSql(alias: string): { bpSql: string; itSql: string; scoreSql: string } {
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

export function mapRowToProductWithPricing(row: ProductRow): ProductWithPricing {
  const sapBasePrice = Number(row.base_price); // items.base_price (S01) — only used as the fallback when there's no channel price row at all
  const channelPrice = row.channel_price !== null ? Number(row.channel_price) : null;
  // The actual reference price the discount waterfall is taken from — and,
  // per the customer's request, also what's shown as "Base Price"/the
  // strikethrough and what discountPercent is computed against, so the
  // displayed "% off" always matches the price that was really cut.
  const priceBeforeDiscounts = channelPrice && channelPrice > 0 ? channelPrice : sapBasePrice;

  const periodDiscPct = row.period_disc_pct !== null ? Number(row.period_disc_pct) : 0;
  const contractDiscPct = row.contract_disc_pct !== null ? Number(row.contract_disc_pct) : 0;

  // Every currently-valid percent-discount/buy-give program for this
  // (customer, item) pair — sorted here (specificity score desc, then
  // discount/give-qty desc) rather than trusting JSON_ARRAYAGG's row order,
  // since MySQL's JSON_ARRAYAGG has no ORDER BY clause of its own. Index 0
  // is "today's winner" — the auto-picked default every existing caller
  // (ProductCard default, ReorderButton, Excel Import) keeps relying on;
  // the full list lets the customer choose a different one on the card.
  const promoOptionsSorted = dedupeByIdentity(
    parseJsonArray<PromoOptionRow>(row.promo_options_json)
      .sort((a, b) => b.score - a.score || Number(b.pct) - Number(a.pct)),
    (o) => o.code ?? o.name ?? ""
  );
  // Identity includes giveCode — see dedupeByIdentity's own comment on why
  // code/name alone would wrongly merge distinct free-item choices that
  // happen to share one promotion program.
  const giveawayOptionsSorted = dedupeByIdentity(
    parseJsonArray<GiveawayOptionRow>(row.giveaway_options_json)
      .sort((a, b) => b.score - a.score || Number(b.giveQty) - Number(a.giveQty)),
    (o) => `${o.code ?? o.name ?? ""}::${o.giveCode}`
  );

  const promoDiscPct = promoOptionsSorted[0] ? Number(promoOptionsSorted[0].pct) : 0;

  // Sequential flow: Channel Price -> Period Discount Price -> Contract
  // Discount Price -> Promotion Discount Price. Each step is taken off
  // the PREVIOUS step's already-discounted price, not off the original
  // Channel Price.
  const periodPrice = priceBeforeDiscounts * (1 - periodDiscPct / 100);
  const contractPrice = periodPrice * (1 - contractDiscPct / 100);
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
    // Individual waterfall percentages that compound into discountPercent
    // above — 0 when that step didn't apply. Persisted per order line (see
    // order_lines.period_disc_pct/contract_disc_pct/promo_disc_pct) so
    // Admin - Order can show which discount type(s) actually applied,
    // instead of only the combined discountPercent.
    periodDiscPct,
    contractDiscPct,
    promoDiscPct,
    hasPromotion: promoDiscPct > 0,
    promotionTitle: promoOptionsSorted[0] ? promoOptionsSorted[0].name || undefined : undefined,
    promotionCode: promoOptionsSorted[0] ? promoOptionsSorted[0].code || undefined : undefined,
    // Every currently-valid candidate program, best first (index 0 matches
    // promoDiscPct/promotionTitle/promotionCode above) — the product card
    // only shows a picker when this has more than one entry; `undefined`ed
    // `code`/`name` (a legacy Excel-import-sourced row with no bp_type/
    // it_type-derived program identity) still shows up so the pct is visible.
    promotionOptions: promoOptionsSorted.map((o) => ({ code: o.code, name: o.name, pct: Number(o.pct) })),
    hasBuyGivePromo: giveawayOptionsSorted.length > 0,
    promoBuyQty: giveawayOptionsSorted[0] ? Number(giveawayOptionsSorted[0].buyQty) : undefined,
    promoGiveItemCode: giveawayOptionsSorted[0]?.giveCode || undefined,
    promoGiveItemName: giveawayOptionsSorted[0]?.giveName || undefined,
    promoGiveQty: giveawayOptionsSorted[0] ? Number(giveawayOptionsSorted[0].giveQty) : undefined,
    giveawayCode: giveawayOptionsSorted[0]?.code || undefined,
    giveawayOptions: giveawayOptionsSorted.map((o) => ({
      code: o.code, name: o.name, buyQty: Number(o.buyQty),
      giveItemCode: o.giveCode, giveItemName: o.giveName, giveQty: Number(o.giveQty),
    })),
    // null = stock tracking is off (or no stock row at all) for this customer's
    // resolved warehouse set — distinct from a real 0, which means "out of
    // stock" (though a 0-or-below item wouldn't reach this far: the stock
    // gate already excludes it from the result set entirely).
    availableQty: row.available_qty !== null ? Math.floor(Number(row.available_qty)) : null,
    // Display-only (checkout's multi-order-split preview) — the server-side
    // split in POST /api/orders does its OWN live items.brand_code lookup,
    // never trusts this field, so a resync here can only make the preview
    // briefly stale, never the actual order grouping.
    brandCode: row.brand_code,
    brandName: row.brand_name_display,
  };
}

export interface PricingContext {
  /** "" sentinel (not null) for an anonymous/unapproved customer — matches every SQL IN-list placeholder below, which never matches "". */
  sapCardCode: string;
  cusGrp01: string;
  cusGrp02: string;
  cusGrp03: string;
  priceListNum: number | null;
  basePriceListNum: number;
  /** The customer's resolved visible warehouse codes — [] disables the stock gate/availableQty entirely (feature off). */
  stockWarehouseCodes: string[];
}

/**
 * The "only list an item with positive available stock" EXISTS clause,
 * shared by queryPricedProducts' own WHERE (via extraWhereSql... no — via
 * its OWN internal call to this same helper) and GET /api/products' separate
 * COUNT(*) query, which can't run the full LATERAL-joined query just to get
 * a total. Returns null when `stockWarehouseCodes` is empty (feature off —
 * no gate at all, same no-op as today).
 */
export function buildStockGateClause(
  stockWarehouseCodes: string[],
  cusGrp01: string,
  cusGrp02: string,
  cusGrp03: string
): { clause: string | null; params: (string | number)[] } {
  if (stockWarehouseCodes.length === 0) return { clause: null, params: [] };
  const shelfLifeOkSql = shelfLifeOkSqlFor("iws");
  return {
    clause: `EXISTS (
      SELECT 1 FROM item_warehouse_stock iws
      WHERE iws.sap_item_code = i.sap_item_code
        AND iws.warehouse_code IN (${stockWarehouseCodes.map(() => "?").join(",")})
        AND ${shelfLifeOkSql}
      GROUP BY iws.sap_item_code
      HAVING SUM(iws.in_stock - iws.committed) > 0
    )`,
    params: [...stockWarehouseCodes, cusGrp01, cusGrp02, cusGrp03],
  };
}

/**
 * Shared by the stock-gate EXISTS (buildStockGateClause) AND availableQtySql
 * inside queryPricedProducts — both must apply the identical shelf-life
 * condition, or the displayed "available" number could disagree with
 * whether the item is listed at all. `iwsAlias` lets each call site qualify
 * iws.shelf_life_pct with its own alias; 3 `?` placeholders (cusGrp01/02/03)
 * are needed wherever this is spliced in.
 */
function shelfLifeOkSqlFor(iwsAlias: string): string {
  return `(
    ${iwsAlias}.shelf_life_pct IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM customer_require_shelflife crs
      WHERE crs.cust_group_code IN (?, ?, ?)
        AND crs.item_group_code IN (i.item_cat01, i.item_cat02, i.item_cat03, i.item_cat04, i.item_cat05, i.item_cat06)
        AND (crs.valid_from IS NULL OR crs.valid_from <= CURDATE())
        AND (crs.valid_to IS NULL OR crs.valid_to >= CURDATE())
        AND (
          (crs.shelf_life_from IS NOT NULL AND ${iwsAlias}.shelf_life_pct < crs.shelf_life_from)
          OR (crs.shelf_life_to IS NOT NULL AND ${iwsAlias}.shelf_life_pct > crs.shelf_life_to)
        )
    )
  )`;
}

/**
 * Price flow (sequential, not additive — each step's output feeds the next
 * step's input, none of them computed off the original Channel Price):
 *   Step 1: Channel Price      = the customer's applicable price-list price
 *                                 (their channel price list, falling back to
 *                                 items.base_price if they have no channel
 *                                 price cached).
 *   Step 2: Period Discount    = Channel Price - Channel Price * (period
 *                                 discount % / 100) — the best-matching,
 *                                 currently-valid `period_discount` row for
 *                                 the customer's own channel price list (SAP
 *                                 scopes these to the whole price list, not
 *                                 a customer — see syncPeriodDiscounts).
 *   Step 3: Contract Discount  = Step 2's price - Step 2's price * (contract
 *                                 discount % / 100) — best-matching
 *                                 `contract_discount` row.
 *   Step 4: Promotion Discount = Step 3's price - Step 3's price * (promotion
 *                                 discount % / 100) — best-matching
 *                                 `promotion_discount` row. This is the final
 *                                 displayed price.
 * The `basePrice`/strikethrough and `discountPercent` returned to the client
 * are the Step 1 Channel Price (priceBeforeDiscounts) — never items.base_price
 * (S01) when a channel price exists — so the displayed "% off" always matches
 * the price the discounts were actually taken from, even when a channel list
 * prices an item above or below S01.
 *
 * A discount (from `contract_discount` or `promotion_discount`) matches a
 * (customer, item) pair if its customer code equals the customer's own BP
 * code OR one of their customer-group codes at any of the 3 BP-group levels,
 * AND its item code equals the item's own code OR one of its item-group
 * codes at any of the 6 item-group levels — the MOST SPECIFIC (deepest) one
 * wins. See the former GET /api/products docstring (now here) for the full
 * explanation of contract_discount's level-guessing vs promotion_discount's
 * authoritative bp_type/it_type columns, and the buy-give giveaway match.
 *
 * Visibility and the stock gate are ALWAYS applied inside this function
 * (is_active, is_manually_hidden, hidden-category NOT IN clauses, and —
 * when `ctx.stockWarehouseCodes` is non-empty — the positive-available-qty
 * EXISTS gate) — no caller can bypass them by omitting a WHERE fragment.
 * `extraWhereSql`/`extraWhereParams` are ANDed in on top (e.g. a fuzzy
 * `search` LIKE clause for the storefront listing, or an exact
 * `sap_item_code IN (...)` clause for the Excel Import batch lookup).
 * `orderLimitSql`/`orderLimitParams` is the raw `ORDER BY ... LIMIT ...
 * [OFFSET ...]` tail — pagination/sort concerns are entirely the caller's.
 */
export async function queryPricedProducts(
  ctx: PricingContext,
  hiddenClauses: string[],
  hiddenParams: (string | number | null)[],
  extraWhereSql: string[],
  extraWhereParams: (string | number | null)[],
  orderLimitSql: string,
  orderLimitParams: (string | number)[]
): Promise<ProductWithPricing[]> {
  const { sapCardCode, cusGrp01, cusGrp02, cusGrp03, priceListNum, basePriceListNum, stockWarehouseCodes } = ctx;

  const whereClauses = ["i.is_active = TRUE", "i.is_manually_hidden = FALSE", ...hiddenClauses];
  const params: (string | number | null)[] = [...hiddenParams];

  // Stock gate: only applies once an admin has marked at least one
  // warehouse "Included" — until then this is a no-op, so turning the
  // feature on is opt-in and never silently empties the result set.
  const stockGate = buildStockGateClause(stockWarehouseCodes, cusGrp01, cusGrp02, cusGrp03);
  if (stockGate.clause) {
    whereClauses.push(stockGate.clause);
    params.push(...stockGate.params);
  }

  whereClauses.push(...extraWhereSql);
  params.push(...extraWhereParams);

  const whereSql = whereClauses.join(" AND ");

  const promoMatch = promotionMatchSql("pd");
  const giveMatch = promotionMatchSql("pd2");

  // Same resolved warehouse set as the stock gate above — the quantity
  // shown to the customer must match the one the gate actually used,
  // otherwise "in stock" and the number on the card could disagree. NULL
  // (not 0) when the feature is off entirely, so the UI can tell "unknown/
  // not tracked" apart from "really zero" and just not show a number.
  const availableQtySql =
    stockWarehouseCodes.length > 0
      ? `(SELECT SUM(iws.in_stock - iws.committed) FROM item_warehouse_stock iws
          WHERE iws.sap_item_code = i.sap_item_code
            AND iws.warehouse_code IN (${stockWarehouseCodes.map(() => "?").join(",")})
            AND ${shelfLifeOkSqlFor("iws")})`
      : "NULL";

  // "" never matches a real SAP code — safe stand-ins for an
  // anonymous/unapproved customer with no BP/group codes at all.
  const custCode = sapCardCode ?? "";
  const grp01 = cusGrp01 ?? "";
  const grp02 = cusGrp02 ?? "";
  const grp03 = cusGrp03 ?? "";

  const rows = await query<ProductRow[]>(
    `SELECT i.id, i.sap_item_code, i.item_name_vi, i.item_name_en, COALESCE(i.sales_uom, i.uom) AS uom, i.pack_size,
            i.category, i.base_price, i.image_url, i.is_active,
            i.brand_code, COALESCE(cc.ocr_name, i.brand_code) AS brand_name_display,
            cp_base.price AS channel_price,
            period_best.pct AS period_disc_pct,
            cd_best.pct AS contract_disc_pct,
            promo_options.options AS promo_options_json,
            giveaway_options.options AS giveaway_options_json,
            ${availableQtySql} AS available_qty
     FROM items i
     LEFT JOIN item_channel_prices cp
       ON cp.sap_item_code = i.sap_item_code AND cp.price_list_num = ?
     LEFT JOIN item_channel_prices cp_base
       ON cp_base.sap_item_code = i.sap_item_code AND cp_base.price_list_num = cp.base_price_list_num
     LEFT JOIN cost_centers cc
       ON cc.ocr_code = i.brand_code AND cc.dimension = 1
     LEFT JOIN LATERAL (
       SELECT pdisc.discount_percent AS pct
       FROM period_discount pdisc
       WHERE pdisc.price_list_num = ?
         AND pdisc.sap_item_code = i.sap_item_code
         AND (pdisc.date_from IS NULL OR pdisc.date_from <= CURDATE())
         AND (pdisc.date_to IS NULL OR pdisc.date_to >= CURDATE())
       ORDER BY pdisc.date_from DESC
       LIMIT 1
     ) period_best ON TRUE
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
       -- Every currently-valid percent-discount program for this (customer,
       -- item) pair, not just the winner -- JSON_ARRAYAGG has no ORDER BY of
       -- its own, so score rides along and the JS mapper (see
       -- mapRowToProductWithPricing) does the real sort + picks index 0 as
       -- today's auto-best default.
       SELECT JSON_ARRAYAGG(JSON_OBJECT(
         'code', pd.promotion_code, 'name', pd.promotion_name, 'pct', pd.disc_pct,
         'score', (${promoMatch.scoreSql})
       )) AS options
       FROM promotion_discount pd
       WHERE pd.disc_pct IS NOT NULL
         AND (pd.selling_qty IS NULL OR pd.selling_qty <= 1)
         AND (pd.begin_date IS NULL OR pd.begin_date <= CURDATE())
         AND (pd.end_date IS NULL OR pd.end_date >= CURDATE())
         AND ${promoMatch.bpSql}
         AND ${promoMatch.itSql}
     ) promo_options ON TRUE
     LEFT JOIN LATERAL (
       -- Same idea for every currently-valid buy-X-get-Y program.
       SELECT JSON_ARRAYAGG(JSON_OBJECT(
         'code', pd2.promotion_code, 'name', pd2.promotion_name, 'buyQty', pd2.selling_qty,
         'giveCode', pd2.giving_item_code, 'giveName', pd2.giving_item_name, 'giveQty', pd2.giving_qty,
         'score', (${giveMatch.scoreSql})
       )) AS options
       FROM promotion_discount pd2
       WHERE pd2.giving_item_code IS NOT NULL
         AND (pd2.begin_date IS NULL OR pd2.begin_date <= CURDATE())
         AND (pd2.end_date IS NULL OR pd2.end_date >= CURDATE())
         AND ${giveMatch.bpSql}
         AND ${giveMatch.itSql}
     ) giveaway_options ON TRUE
     WHERE ${whereSql}
     ${orderLimitSql}`,
    [
      ...(stockWarehouseCodes.length > 0 ? [...stockWarehouseCodes, cusGrp01, cusGrp02, cusGrp03] : []), // available_qty subquery (SELECT list — comes first in the SQL text)
      priceListNum ?? basePriceListNum, // cp.price_list_num
      priceListNum ?? basePriceListNum, // period_discount.price_list_num (same list — SAP scopes these per price list, not per customer)
      custCode, grp01, grp02, grp03, // contract WHERE u_code_cust IN list
      custCode, grp03, grp02, grp01, // contract ORDER BY customer-specificity weights
      custCode, grp01, grp02, grp03, // promo WHERE bp_type='2'/'CG1'/'CG2'/'CG3' match
      custCode, grp01, grp02, grp03, // giveaway WHERE bp_type='2'/'CG1'/'CG2'/'CG3' match
      ...params,
      ...orderLimitParams,
    ]
  );

  return rows.map(mapRowToProductWithPricing);
}
