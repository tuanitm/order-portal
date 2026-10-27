import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId, isFillOwnerEnabled } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getSapClient } from "@/lib/sap-b1/client";
import { recordOrderStatus, notifyCustomerOfStatusChange } from "@/lib/orderHistory";
import { getLiveAvailabilityForOrder } from "@/lib/orderStock";
import { getBasePriceListNum } from "@/lib/sap-b1/sync";
import { isOrderInAdminScope } from "@/lib/adminScope";
import { getAdminWarehouseCodes } from "@/lib/adminWarehouses";
import { logAuditEvent } from "@/lib/auditLog";
import { recalculateOrderTotals } from "@/lib/orderTotals";

interface OrderRow {
  id: number;
  order_number: string;
  remark: string | null;
  sap_doc_entry: number | null;
  sap_card_code: string | null;
  sap_price_list_num: number | null;
  sap_cus_grp01: string | null;
  sap_cus_grp02: string | null;
  sap_cus_grp03: string | null;
  /** Set only on admin-created ("Self create") orders — see schema.sql. */
  bill_to_code: string | null;
  ship_to_code: string | null;
  supervisor_code: string | null;
}

/** Appended to a free (gift) item's U_INVDesc on the SAP line. */
const FREE_ITEM_SUFFIX = " - HÀNG KHUYẾN MÃI KHÔNG THU TIỀN";

interface OrderLineRow {
  id: number;
  sap_item_code: string;
  item_name: string;
  /** The SAP item master name (OITM.ItemName) — what SAP puts in the line's Dscription. */
  sap_item_name: string;
  quantity: number;
  confirm_qty: number;
  customer_confirm_status: "pending" | "accepted" | "rejected";
  base_unit_price: string;
  is_gift_line: number;
  source_line_id: number | null;
  promo_buy_qty: number | null;
  promo_give_qty: number | null;
  brand_code: string | null;
  vat_group: string | null;
  item_tax_class: string | null;
  item_cat01: string | null;
  item_cat02: string | null;
  item_cat03: string | null;
  item_cat04: string | null;
  item_cat05: string | null;
  item_cat06: string | null;
}

interface ContractDiscountRow {
  u_code_cust: string | null;
  u_code_item: string | null;
  u_base_disc_pct: string;
}

interface PromotionDiscountRow {
  bp_type: string | null;
  bp_code: string | null;
  it_type: string | null;
  selling_item_code: string | null;
  promotion_code: string | null;
  disc_pct: string;
  selling_qty: string | null;
  promotion_name: string | null;
}

interface GiveawayPromotionRow {
  bp_type: string | null;
  bp_code: string | null;
  it_type: string | null;
  selling_item_code: string | null;
  giving_item_code: string | null;
  promotion_name: string | null;
}

/** "Period Management" add-on UDF, same pattern style as a real posted
 * order's own value (e.g. "8B6F852D16EC3200F00000031DA12500") — a GUID
 * with the dashes stripped and uppercased. One generated per buy/
 * inventory line, shared across every Contract/Promotion Discount and
 * free-item line derived from it. */
function generatePmGuid(): string {
  return randomUUID().replace(/-/g, "").toUpperCase();
}

/** Specificity score for a promotion_discount row's authoritative bp_type/
 * it_type columns — exact BP/item beats group level 3 beats 2 beats 1,
 * same weights as the storefront's own promotionMatchSql in
 * src/app/api/products/route.ts (kept in sync by hand, not shared code,
 * since this one matches in JS against a pre-fetched row set instead of
 * a SQL LATERAL join — see buildContractAndPromotionLines below for why). */
function promoBpScore(bpType: string | null): number {
  return bpType === "2" ? 600 : bpType === "CG3" ? 300 : bpType === "CG2" ? 200 : bpType === "CG1" ? 100 : 0;
}
function promoItemScore(itType: string | null): number {
  return itType === "4" ? 600
    : itType === "IC6" ? 60 : itType === "IC5" ? 50 : itType === "IC4" ? 40
    : itType === "IC3" ? 30 : itType === "IC2" ? 20 : itType === "IC1" ? 10 : 0;
}
interface PromoMatchRow {
  bp_type: string | null;
  bp_code: string | null;
  it_type: string | null;
  selling_item_code: string | null;
}
function promoMatchesBp(row: PromoMatchRow, cardCode: string, grp01: string | null, grp02: string | null, grp03: string | null): boolean {
  if (row.bp_type === "2") return row.bp_code === cardCode;
  if (row.bp_type === "CG1") return row.bp_code === grp01;
  if (row.bp_type === "CG2") return row.bp_code === grp02;
  if (row.bp_type === "CG3") return row.bp_code === grp03;
  return row.bp_type === null && row.bp_code === null;
}
function promoMatchesItem(row: PromoMatchRow, line: OrderLineRow): boolean {
  switch (row.it_type) {
    case "4": return row.selling_item_code === line.sap_item_code;
    case "IC1": return row.selling_item_code === line.item_cat01;
    case "IC2": return row.selling_item_code === line.item_cat02;
    case "IC3": return row.selling_item_code === line.item_cat03;
    case "IC4": return row.selling_item_code === line.item_cat04;
    case "IC5": return row.selling_item_code === line.item_cat05;
    case "IC6": return row.selling_item_code === line.item_cat06;
    default: return false;
  }
}

/** Specificity score for a contract_discount row — unlike promotion_discount
 * it has no type column (see contract_discount's own schema comment), so
 * which level matched is inferred by equality against each level in turn,
 * same scoring shape as the storefront's own cd_best ORDER BY CASE. */
function contractItemScore(row: ContractDiscountRow, line: OrderLineRow): number {
  if (row.u_code_item === line.sap_item_code) return 600;
  if (row.u_code_item === line.item_cat06) return 60;
  if (row.u_code_item === line.item_cat05) return 50;
  if (row.u_code_item === line.item_cat04) return 40;
  if (row.u_code_item === line.item_cat03) return 30;
  if (row.u_code_item === line.item_cat02) return 20;
  if (row.u_code_item === line.item_cat01) return 10;
  return -1;
}
function contractCustScore(row: ContractDiscountRow, cardCode: string, grp01: string | null, grp02: string | null, grp03: string | null): number {
  if (row.u_code_cust === cardCode) return 600;
  if (row.u_code_cust === grp03) return 300;
  if (row.u_code_cust === grp02) return 200;
  if (row.u_code_cust === grp01) return 100;
  return -1;
}

/** The fixed fallback for the header's U_ProdBrand when an order's lines
 * span more than one brand ("Inventory Brand" — see cost_centers,
 * dimension 1, for the full brand code list this is drawn from). */
const MULTI_BRAND_FALLBACK_CODE = "TODO_SET_ME"; // TODO: awaiting the real code from the user

/**
 * POST /api/admin/orders/[id]/confirm?warehouseCode=XXXX — admin confirms
 * a submitted order, pushing it to SAP B1 as a Draft Sales Order. This is
 * the only place the SAP push happens — POST /api/orders only ever writes
 * to MySQL, so nothing reaches SAP until an admin explicitly confirms it
 * here. warehouseCode is required and stamped onto every DocumentLine —
 * it's the same warehouse the admin picked on this page to check live
 * "Avail Qty" against, so the draft order fulfills from the warehouse
 * that was actually verified to have stock, not whatever SAP would have
 * defaulted to on its own.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const warehouseCode = new URL(request.url).searchParams.get("warehouseCode")?.trim();
  if (!warehouseCode) {
    return NextResponse.json({ error: "warehouseCode query param is required — select a warehouse on this page first" }, { status: 400 });
  }
  if (!(await getAdminWarehouseCodes(guard.session)).includes(warehouseCode)) {
    return NextResponse.json({ error: `Warehouse ${warehouseCode} is not one of your warehouses (Admin Users → Warehouse)` }, { status: 403 });
  }

  const companyId = getCompanyId();
  const order = await queryOne<OrderRow>(
    // The order's own customer (orders.sap_card_code, always set for admin-
    // created orders); pricing data from the login if there is one, else from
    // the SAP customer record — an admin-created order may have no login.
    `SELECT o.id, o.order_number, o.remark, o.sap_doc_entry,
            COALESCE(o.sap_card_code, u.sap_card_code) AS sap_card_code,
            COALESCE(u.sap_price_list_num, c.price_list_num) AS sap_price_list_num,
            COALESCE(u.sap_cus_grp01, c.cus_grp01) AS sap_cus_grp01,
            COALESCE(u.sap_cus_grp02, c.cus_grp02) AS sap_cus_grp02,
            COALESCE(u.sap_cus_grp03, c.cus_grp03) AS sap_cus_grp03,
            o.bill_to_code, o.ship_to_code, o.supervisor_code
     FROM orders o
     LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id
     LEFT JOIN customers c ON c.company_id = o.company_id AND c.sap_card_code = COALESCE(o.sap_card_code, u.sap_card_code)
     WHERE o.company_id = ? AND o.id = ?`,
    [companyId, orderId]
  );
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!(await isOrderInAdminScope(guard.session, orderId))) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.sap_doc_entry) {
    return NextResponse.json(
      { error: `Order already pushed to SAP as DocEntry ${order.sap_doc_entry}` },
      { status: 409 }
    );
  }
  if (!order.sap_card_code) {
    return NextResponse.json(
      { error: "This customer has no linked SAP BP code (sap_card_code) — cannot push to SAP" },
      { status: 400 }
    );
  }
  // TS can't carry the above null-check's narrowing of `order` into the
  // line-building closures defined much further down — capture it once
  // here instead of writing `order.order_number` (and `!`-asserting) everywhere.
  const orderNumber = order.order_number;

  const allLines = await query<OrderLineRow[]>(
    `SELECT ol.id, ol.sap_item_code, ol.item_name, COALESCE(NULLIF(i.item_name_vi, ''), ol.item_name) AS sap_item_name, ol.quantity, ol.confirm_qty, ol.customer_confirm_status, ol.base_unit_price,
            ol.is_gift_line, ol.source_line_id, ol.promo_buy_qty, ol.promo_give_qty, i.brand_code, i.vat_group, i.item_tax_class,
            i.item_cat01, i.item_cat02, i.item_cat03, i.item_cat04, i.item_cat05, i.item_cat06
     FROM order_lines ol
     LEFT JOIN items i ON i.company_id = ol.company_id AND i.sap_item_code = ol.sap_item_code
     WHERE ol.company_id = ? AND ol.order_id = ?`,
    [companyId, orderId]
  );
  if (allLines.length === 0) {
    return NextResponse.json({ error: "Order has no lines" }, { status: 400 });
  }

  // Period Discount — SAP B1's own "Period and Volume Discount" feature
  // (Special Prices scoped to the whole price list, CardCode='*{num}' —
  // see period_discount in schema.sql / syncPeriodDiscounts). Re-checked
  // fresh right now (not whatever was true at checkout), same price list
  // resolution as the storefront's own price calc (src/app/api/products/
  // route.ts) — the customer's channel list, falling back to the base list.
  //
  // How this actually gets applied in SAP (confirmed empirically by
  // creating and reading back a real test line): sending UnitPrice = the
  // line's pre-discount price and DiscountPercent = the discount % is all
  // that's needed — SAP's own engine computes Price (the net per-unit
  // price), LineTotal, GrossPrice, etc. from those two itself. There is no
  // separate field to set for "price before discount" or "discount
  // percent" under the names a raw RDR1 column read would suggest
  // (DiscPrcnt/PriceBefDi don't exist in the Service Layer JSON at all —
  // see CostingCode/COGSCostingCode's own history of this exact mistake).
  const priceListNum = order.sap_price_list_num ?? (await getBasePriceListNum());
  const periodDiscountRows = await query<{
    sap_item_code: string;
    base_price: string | null;
    discount_percent: string;
    special_price: string;
    date_from: string | null;
  }[]>(
    `SELECT sap_item_code, base_price, discount_percent, special_price, date_from
     FROM period_discount
     WHERE company_id = ?
       AND price_list_num = ?
       AND sap_item_code IN (${allLines.map(() => "?").join(",")})
       AND (date_from IS NULL OR date_from <= CURDATE())
       AND (date_to IS NULL OR date_to >= CURDATE())
     ORDER BY date_from DESC`,
    [companyId, priceListNum, ...allLines.map((l) => l.sap_item_code)]
  );
  // First row per item wins (rows already ordered by date_from DESC above),
  // same "most recent currently-valid tier" pick as the storefront's own
  // LATERAL JOIN ... ORDER BY date_from DESC LIMIT 1.
  const periodDiscountByItem = new Map<string, { basePrice: number | null; discountPercent: number; netPrice: number }>();
  for (const r of periodDiscountRows) {
    if (periodDiscountByItem.has(r.sap_item_code)) continue;
    periodDiscountByItem.set(r.sap_item_code, {
      basePrice: r.base_price !== null ? Number(r.base_price) : null,
      discountPercent: Number(r.discount_percent),
      netPrice: Number(r.special_price),
    });
  }

  /** The price Contract/Promotion Discount lines compute their own amount
   * off — the item's Period-Discounted net price if one applies, else its
   * plain undiscounted channel price. Confirmed empirically: a real
   * posted order with BOTH a Period Discount (117273 -> 93818) and a 10%
   * Contract Discount produced a discount line of 9382 = 93818 x 10%, NOT
   * 117273 x 10% — Contract/Promotion chain AFTER Period Discount, but
   * (per the earlier example) do NOT chain after each other; each is
   * independently pct% of this same effective price. */
  function effectiveDiscountBasePrice(line: OrderLineRow): number {
    return periodDiscountByItem.get(line.sap_item_code)?.netPrice ?? Number(line.base_unit_price);
  }

  // This admin's own Department Code (dimension 2) — posted onto every
  // line as CostingCode2/COGSCostingCode2. Omitted cleanly (not blocked)
  // if the confirming admin hasn't had one set yet on the Admin Users page.
  // owner_code (resolved to DocumentsOwner/U_OwnerName further below, once
  // `sap` exists) follows the same "set it on Admin Users, or it's skipped
  // cleanly" rule.
  const admin = await queryOne<{ department_code: string | null; owner_code: string | null }>(
    `SELECT department_code, owner_code FROM admin_users WHERE company_id = ? AND id = ?`,
    [companyId, guard.session.adminId]
  );
  const departmentCode = admin?.department_code || undefined;

  // This customer's own dimension-3 cost center (CenterCode == CardCode,
  // 1:1 — see cost_centers' own comment) — posted onto every line as
  // CostingCode3/COGSCostingCode3. Validated against the synced list
  // first (not just assumed from the CardCode itself) so an unmapped
  // customer omits the field cleanly instead of SAP rejecting the whole
  // push over an invalid distribution code.
  const customerCostCenter = await queryOne<{ ocr_code: string }>(
    `SELECT ocr_code FROM cost_centers WHERE company_id = ? AND dimension = 3 AND ocr_code = ?`,
    [companyId, order.sap_card_code]
  );
  const customerCostCenterCode = customerCostCenter?.ocr_code || undefined;

  // Contract Discount / Promotion Discount — SAP doesn't apply these to
  // the real inventory line's own price at all (unlike Period Discount
  // above); instead each qualifying inventory line generates its own
  // separate NEGATIVE-quantity line, one for each discount type that
  // applies, carrying that discount's $ amount as a flat per-unit price —
  // confirmed by reading a real posted order's raw lines (item CK99999998
  // for contract, CK99999999 for promotion; see the comment on
  // buildDiscountLines below for the exact math). Both are computed
  // independently off each line's own undiscounted base_unit_price (NOT
  // chained the way the storefront's own displayed net price is), per the
  // real example.
  const candidateItemCodes = new Set<string>();
  for (const l of allLines) {
    candidateItemCodes.add(l.sap_item_code);
    for (const cat of [l.item_cat01, l.item_cat02, l.item_cat03, l.item_cat04, l.item_cat05, l.item_cat06]) {
      if (cat) candidateItemCodes.add(cat);
    }
  }
  const itemCodeList = [...candidateItemCodes];
  const custCode = order.sap_card_code;
  const grp01 = order.sap_cus_grp01;
  const grp02 = order.sap_cus_grp02;
  const grp03 = order.sap_cus_grp03;

  const contractDiscountCandidates = itemCodeList.length === 0 ? [] : await query<ContractDiscountRow[]>(
    `SELECT u_code_cust, u_code_item, u_base_disc_pct
     FROM contract_discount
     WHERE company_id = ?
       AND (canceled IS NULL OR canceled != 'Y')
       AND u_code_cust IN (?, ?, ?, ?)
       AND u_code_item IN (${itemCodeList.map(() => "?").join(",")})
       AND (u_valid_from IS NULL OR u_valid_from <= CURDATE())
       AND (u_valid_to IS NULL OR u_valid_to >= CURDATE())`,
    [companyId, custCode, grp01, grp02, grp03, ...itemCodeList]
  );
  const promotionDiscountCandidates = itemCodeList.length === 0 ? [] : await query<PromotionDiscountRow[]>(
    `SELECT bp_type, bp_code, it_type, selling_item_code, promotion_code, disc_pct, selling_qty, promotion_name
     FROM promotion_discount
     WHERE company_id = ?
       AND disc_pct IS NOT NULL
       AND giving_item_code IS NULL
       AND selling_item_code IN (${itemCodeList.map(() => "?").join(",")})
       AND (begin_date IS NULL OR begin_date <= CURDATE())
       AND (end_date IS NULL OR end_date >= CURDATE())
       AND (
         (bp_type = '2' AND bp_code = ?) OR (bp_type = 'CG1' AND bp_code = ?)
         OR (bp_type = 'CG2' AND bp_code = ?) OR (bp_type = 'CG3' AND bp_code = ?)
         OR (bp_type IS NULL AND bp_code IS NULL)
       )`,
    [companyId, ...itemCodeList, custCode, grp01, grp02, grp03]
  );

  // Buy-give (free item) promotion rows for this order's items — used only
  // to look up the promotion's own NAME for a gift line's U_CTKM_NAME (the
  // gift linkage itself — which buy line earned which gift, at what ratio —
  // already comes from order_lines.promo_buy_qty/promo_give_qty/
  // source_line_id, set at checkout; this is purely for that one display field).
  const giveawayPromotionCandidates = itemCodeList.length === 0 ? [] : await query<GiveawayPromotionRow[]>(
    `SELECT bp_type, bp_code, it_type, selling_item_code, giving_item_code, promotion_name
     FROM promotion_discount
     WHERE company_id = ?
       AND giving_item_code IS NOT NULL
       AND selling_item_code IN (${itemCodeList.map(() => "?").join(",")})
       AND (begin_date IS NULL OR begin_date <= CURDATE())
       AND (end_date IS NULL OR end_date >= CURDATE())
       AND (
         (bp_type = '2' AND bp_code = ?) OR (bp_type = 'CG1' AND bp_code = ?)
         OR (bp_type = 'CG2' AND bp_code = ?) OR (bp_type = 'CG3' AND bp_code = ?)
         OR (bp_type IS NULL AND bp_code IS NULL)
       )`,
    [companyId, ...itemCodeList, custCode, grp01, grp02, grp03]
  );

  /** Best-matching contract discount % for one line, or null if none applies —
   * most specific (customer x item) match wins, same tie-break order as the
   * storefront's own cd_best: item specificity + customer specificity DESC,
   * then the discount % itself DESC. */
  function bestContractDiscountPct(line: OrderLineRow): number | null {
    let best: { score: number; pct: number } | null = null;
    for (const row of contractDiscountCandidates) {
      const itemScore = contractItemScore(row, line);
      const custScore = contractCustScore(row, custCode, grp01, grp02, grp03);
      if (itemScore < 0 || custScore < 0) continue;
      const score = itemScore + custScore;
      const pct = Number(row.u_base_disc_pct);
      if (!best || score > best.score || (score === best.score && pct > best.pct)) {
        best = { score, pct };
      }
    }
    return best?.pct ?? null;
  }

  /** Best-matching promotion discount for one line (percent-type only, not
   * a giveaway row), honoring quantity-break tiers (selling_qty) against
   * this line's own confirm_qty — unlike the storefront's own displayed
   * price, which skips any selling_qty > 1 since it doesn't know the final
   * quantity before checkout. We do, at this point. */
  function bestPromotionDiscount(line: OrderLineRow, confirmQty: number): { pct: number; name: string | null; code: string | null } | null {
    let best: { score: number; sellingQty: number; pct: number; name: string | null; code: string | null } | null = null;
    for (const row of promotionDiscountCandidates) {
      if (!promoMatchesBp(row, custCode, grp01, grp02, grp03)) continue;
      if (!promoMatchesItem(row, line)) continue;
      const sellingQty = row.selling_qty !== null ? Number(row.selling_qty) : 0;
      if (sellingQty > confirmQty) continue;
      const score = promoBpScore(row.bp_type) + promoItemScore(row.it_type);
      const pct = Number(row.disc_pct);
      if (
        !best ||
        score > best.score ||
        (score === best.score && sellingQty > best.sellingQty) ||
        (score === best.score && sellingQty === best.sellingQty && pct > best.pct)
      ) {
        best = { score, sellingQty, pct, name: row.promotion_name, code: row.promotion_code };
      }
    }
    return best ? { pct: best.pct, name: best.name, code: best.code } : null;
  }

  /** The giveaway promotion's own name tying a gift line to its buy line —
   * see giveawayPromotionCandidates' own comment for why this is the only
   * thing looked up here (the gift linkage itself is already known). */
  function bestGiveawayPromotionName(buyLine: OrderLineRow, giftItemCode: string): string | null {
    let best: { score: number; name: string | null } | null = null;
    for (const row of giveawayPromotionCandidates) {
      if (row.giving_item_code !== giftItemCode) continue;
      if (!promoMatchesBp(row, custCode, grp01, grp02, grp03)) continue;
      if (!promoMatchesItem(row, buyLine)) continue;
      const score = promoBpScore(row.bp_type) + promoItemScore(row.it_type);
      if (!best || score > best.score) best = { score, name: row.promotion_name };
    }
    return best?.name ?? null;
  }

  // Final safety cap: re-check LIVE available qty (same computation as
  // the "Avail Qty" column — see getLiveAvailabilityForOrder) right before
  // pushing, in case stock moved since the admin last reviewed this order
  // (sold elsewhere, a shelf-life batch expired, ...). Confirm Qty is
  // already supposed to reflect what's available, but this is the last
  // checkpoint before SAP actually gets it — a line is never SENT above
  // what's truly available right now, whatever Confirm Qty says.
  let availabilityByItem: Map<string, number>;
  // This (customer, item) pair's required shelf-life % range (see
  // customer_require_shelflife / getLiveAvailabilityForOrder) — posted
  // onto the line as U_ReqSLFrom/U_ReqSLTo below, independent of the
  // live-stock cap above (a line can still have a requirement even once
  // it's confirmed to actually meet it).
  let requiredShelfLifeByItem: Map<string, { from: number | null; to: number | null }>;
  try {
    const availability = await getLiveAvailabilityForOrder(orderId, warehouseCode);
    availabilityByItem = new Map(availability.map((a) => [a.sapItemCode, a.availableQty]));
    requiredShelfLifeByItem = new Map(
      availability.map((a) => [a.sapItemCode, { from: a.requiredShelfLifeFrom, to: a.requiredShelfLifeTo }])
    );
  } catch (error) {
    console.error("[Admin] Pre-confirm live availability check failed:", error);
    return NextResponse.json(
      { error: "Failed to verify live stock before confirming", message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }

  const adjustments: { sapItemCode: string; from: number; to: number }[] = [];
  const cappedLines = allLines.map((l) => {
    const availableQty = availabilityByItem.get(l.sap_item_code) ?? 0;
    const cappedQty = Math.max(0, Math.min(l.confirm_qty, availableQty));
    const changed = cappedQty !== l.confirm_qty;
    if (changed) {
      adjustments.push({ sapItemCode: l.sap_item_code, from: l.confirm_qty, to: cappedQty });
    }
    return {
      ...l,
      confirm_qty: cappedQty,
      // A cap applied right now hasn't been seen by the customer yet, so it
      // needs their fresh Accept/Reject even if they already accepted some
      // earlier value — same rule the PATCH endpoint applies to any admin edit.
      customer_confirm_status: changed
        ? ((cappedQty === l.quantity ? "accepted" : "pending") as OrderLineRow["customer_confirm_status"])
        : l.customer_confirm_status,
    };
  });

  await Promise.all(
    cappedLines
      .filter((l, i) => l.confirm_qty !== allLines[i].confirm_qty)
      .map((l) =>
        query(
          `UPDATE order_lines SET confirm_qty = ?, customer_confirm_status = ? WHERE company_id = ? AND id = ?`,
          [l.confirm_qty, l.confirm_qty === l.quantity ? "accepted" : "pending", companyId, l.id]
        )
      )
  );

  // Pass 2: a buy line's linked gift line was JUST capped above by its
  // OWN live availability (same as any other line), but the promo ratio
  // could still allow MORE gift units than that — e.g. the buy line kept
  // its full qty but the gift item itself ran short elsewhere — or FEWER,
  // if the buy line itself got capped in pass 1. Reconcile by taking the
  // stricter of (a) the ratio applied to this buy line's now-capped
  // confirm_qty and (b) whatever pass 1 already capped the gift line to.
  for (const buyLine of cappedLines) {
    if (!buyLine.promo_buy_qty || !buyLine.promo_give_qty) continue;
    const giftLine = cappedLines.find((l) => l.source_line_id === buyLine.id);
    if (!giftLine) continue;

    const ratioBased = Math.floor(buyLine.confirm_qty / buyLine.promo_buy_qty) * buyLine.promo_give_qty;
    const finalGiftQty = Math.max(0, Math.min(giftLine.confirm_qty, ratioBased));
    if (finalGiftQty !== giftLine.confirm_qty) {
      adjustments.push({ sapItemCode: giftLine.sap_item_code, from: giftLine.confirm_qty, to: finalGiftQty });
      giftLine.confirm_qty = finalGiftQty;
      giftLine.customer_confirm_status = finalGiftQty === giftLine.quantity ? "accepted" : "pending";
      await query(
        `UPDATE order_lines SET confirm_qty = ?, customer_confirm_status = ? WHERE company_id = ? AND id = ?`,
        [finalGiftQty, giftLine.customer_confirm_status, companyId, giftLine.id]
      );
    }
  }

  // Any cap above changed Cfm Qty — keep line totals and the order total in step.
  if (adjustments.length > 0 || cappedLines.some((l, i) => l.confirm_qty !== allLines[i].confirm_qty)) {
    await recalculateOrderTotals(orderId);
  }

  // Gate the actual SAP push on every still-relevant line (0-qty lines are
  // dropped below, not pushed, so their status doesn't matter) having been
  // explicitly resolved — either it still matches what the customer
  // originally ordered, or the customer themselves responded (see
  // .../lines/[lineId]/confirm). Any adjustment made just now by the
  // live-stock cap or the gift-ratio reconciliation above is persisted
  // either way, but it's a fresh change the customer hasn't seen yet, so
  // it blocks the push until they respond — "pending" ONLY: a line the
  // customer already explicitly Rejected isn't a fresh change needing a
  // response, it's a resolved decision, so it doesn't block the order —
  // see rejectedLines below, which drops just that line instead.
  const pendingLines = cappedLines.filter((l) => l.confirm_qty > 0 && l.customer_confirm_status === "pending");
  if (pendingLines.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot push to SAP — ${pendingLines.length} line(s) are pending customer confirmation: ${pendingLines.map((l) => l.sap_item_code).join(", ")}. Ask the customer to Accept/Reject the adjusted quantity on their order page first.`,
        pendingItems: pendingLines.map((l) => l.sap_item_code),
        adjustments,
      },
      { status: 409 }
    );
  }

  // A line the customer explicitly Rejected is dropped from the push
  // entirely — it's not shipped, not invoiced, nothing — while the REST
  // of the order still goes through. This is the one case that doesn't
  // block the order; it just removes that one line from it.
  const rejectedLines = cappedLines.filter((l) => l.confirm_qty > 0 && l.customer_confirm_status === "rejected");

  // A line at 0 (whether the admin already zeroed it out, or it was just
  // capped to 0 by the live check above) is dropped the same way, and so
  // is any gift line whose own BUY line didn't make it into this list for
  // either reason — a gift never ships without the purchase that earned
  // it, regardless of the gift line's own status.
  const keptIds = new Set(
    cappedLines.filter((l) => l.confirm_qty > 0 && l.customer_confirm_status !== "rejected").map((l) => l.id)
  );
  const lines = cappedLines.filter(
    (l) => keptIds.has(l.id) && (!l.source_line_id || keptIds.has(l.source_line_id))
  );
  if (lines.length === 0) {
    return NextResponse.json(
      { error: "Nothing left to push to SAP — every line is either 0 qty or was rejected by the customer" },
      { status: 400 }
    );
  }

  // Posting date, header delivery date, and each line's own ship date are
  // all the same day — the admin is confirming and pushing to SAP right
  // now, not scheduling a future delivery, so there's no real lead time to
  // reflect here. Vietnam local date (UTC+7), same convention as the order
  // number's own date stamp in POST /api/orders.
  const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Header U_ProdBrand: the one brand every pushed line shares, or the
  // fixed "Inventory Brand" fallback if they don't all agree (a line with
  // no brand_code at all — item never synced one — doesn't count as its
  // own value, it's just absent from this set).
  const distinctBrands = new Set(lines.map((l) => l.brand_code).filter((b): b is string => !!b));
  const headerBrand = distinctBrands.size === 1 ? [...distinctBrands][0] : MULTI_BRAND_FALLBACK_CODE;

  // Lines are sent to SAP in 4 fixed groups, not interleaved by item (the
  // admin's own instruction): (a) every real inventory line, (b) one
  // Contract Discount line (CK99999998) per inventory line that has one,
  // (c) one Promotion Discount line (CK99999999) per inventory line that
  // has one, (d) every free/gift item line (buy-X-get-Y). Discount lines
  // are never generated for gift lines themselves — a free item has
  // nothing left to discount.
  const inventoryLines = lines.filter((l) => !l.is_gift_line);
  const giftLines = lines.filter((l) => l.is_gift_line);

  // Per-inventory-line metadata shared across everything derived from it
  // (its own Contract/Promotion Discount lines, and any gift line tied to
  // it via source_line_id): `index` is this line's 0-based position among
  // inventoryLines — used both as its own U_PM_BaseLine's LineNum portion
  // AND as U_SortField's zero-padded segment, confirmed against 3 real
  // example orders to be the BASE item's position, not each derived
  // line's own actual (later, shifted-by-earlier-groups) DocumentLines
  // index.
  const lineMetaById = new Map<number, { index: number }>();
  inventoryLines.forEach((l, index) => lineMetaById.set(l.id, { index }));

  // U_PM_GUID — ONE per order (per DocEntry), not one per base item.
  // Confirmed against example file 3 (9 inventory items, 25 derived
  // lines): every single CK99999998/CK99999999/free-item line in that
  // whole order shares the exact same GUID, regardless of which base item
  // it's tied to. Real inventory lines never get one.
  const pmGuid = generatePmGuid();

  const sortFieldPrefix = (index: number, baseItemCode: string) =>
    `${orderNumber}_${String(index).padStart(4, "0")}_${baseItemCode}`;

  // One real inventory line. Fields NOT set here (U_PM_BaseItem, U_PM_Type,
  // U_PM_HavingSetupPrrt, U_CTKM, U_CTKM_NAME, U_PM_FreeQty,
  // U_PM_DiscPercent, U_PM_DiscAmount, U_PM_DiscPrice, U_PM_PriceBefFix,
  // U_PM_FixPrice, U_PM_GUID, U_PM_PrrtPMApplied) are deliberately left
  // unset — the admin's own spec calls for NULL on all of these for a real
  // inventory line, only the synthetic/free lines below carry them.
  function buildInventoryLine(l: typeof lines[number]) {
    const meta = lineMetaById.get(l.id)!;
    return {
      ItemCode: l.sap_item_code,
      // confirm_qty, NOT the originally-ordered quantity — defaults to it,
      // but the admin may have lowered it on the Order Review page
      // (insufficient live stock, shelf-life gate, ...) before confirming.
      Quantity: l.confirm_qty,
      // UnitPrice is always the PRE-discount channel price — not the net
      // unit_price (which already has contract/promo discounts folded
      // in for the customer-facing price shown at checkout). When this
      // item has an active Period Discount, DiscountPercent is set
      // alongside it and SAP computes the net Price/LineTotal itself.
      UnitPrice: periodDiscountByItem.get(l.sap_item_code)?.basePrice ?? Number(l.base_unit_price),
      DiscountPercent: periodDiscountByItem.get(l.sap_item_code)?.discountPercent,
      WarehouseCode: warehouseCode,
      ShipDate: vnToday,
      // Distribution Rule dimension 1 (Brand) — from the item itself.
      CostingCode: l.brand_code || undefined,
      COGSCostingCode: l.brand_code || undefined,
      // Distribution Rule dimension 2 (Department) — from the confirming admin.
      CostingCode2: departmentCode,
      COGSCostingCode2: departmentCode,
      // Distribution Rule dimension 3 (Customer) — from the order's own BP.
      CostingCode3: customerCostCenterCode,
      COGSCostingCode3: customerCostCenterCode,
      // Required remaining shelf-life % range for this (customer, item) —
      // see customer_require_shelflife. Omitted on either side the same
      // way the other fields are when there's nothing applicable.
      U_ReqSLFrom: requiredShelfLifeByItem.get(l.sap_item_code)?.from ?? undefined,
      U_ReqSLTo: requiredShelfLifeByItem.get(l.sap_item_code)?.to ?? undefined,
      VatGroup: l.vat_group || undefined,
      // U_SONo deliberately omitted — it mirrors the header's own U_DocNo
      // (see createDraftSalesOrder's call below), which SAP generates
      // server-side via SBO_SP_TransactionNotification AFTER this Sales
      // Order is added, so there's nothing for this client to set here.
      U_SODate: vnToday,
      U_PM_BaseLine: `${meta.index}-${l.sap_item_code}`,
      // Same as the line's Dscription (the SAP item name).
      ItemDescription: l.sap_item_name,
      U_INVDesc: l.sap_item_name,
      U_SortField: `${sortFieldPrefix(meta.index, l.sap_item_code)}_00`,
      U_ItemTaxClass: l.item_tax_class || undefined,
    };
  }

  // One synthetic discount line — a NEGATIVE-quantity line carrying the
  // discount's flat $ amount per unit (effectiveDiscountBasePrice * pct /
  // 100, rounded to whole VND same as every other money value in this
  // app), inheriting its SOURCE inventory line's own Costing codes/
  // warehouse/VatGroup so it nets against the same distribution rule and
  // taxes correctly (confirmed CK99999998/CK99999999's OWN item masters
  // default to a DIFFERENT VatGroup than a real item — "S10" vs "S08" —
  // so this override is required, not just belt-and-suspenders). No
  // DiscountPercent here — it's already a flat amount, not a %-off.
  // ctkmCode is only ever passed for the Promotion line (pmType "20");
  // Contract Discount (pmType "98") gets neither U_CTKM nor U_CTKM_NAME.
  function buildDiscountLine(
    sourceLine: typeof lines[number],
    itemCode: string,
    description: string,
    pct: number,
    pmType: "98" | "20",
    sortSuffix: "11" | "12",
    ctkmCode: string | undefined,
    ctkmName: string | undefined,
    prrtPMApplied: number
  ) {
    const meta = lineMetaById.get(sourceLine.id)!;
    const discountPerUnit = Math.round((effectiveDiscountBasePrice(sourceLine) * pct) / 100);
    return {
      ItemCode: itemCode,
      ItemDescription: description,
      Quantity: -sourceLine.confirm_qty,
      UnitPrice: discountPerUnit,
      WarehouseCode: warehouseCode,
      ShipDate: vnToday,
      CostingCode: sourceLine.brand_code || undefined,
      COGSCostingCode: sourceLine.brand_code || undefined,
      CostingCode2: departmentCode,
      COGSCostingCode2: departmentCode,
      CostingCode3: customerCostCenterCode,
      COGSCostingCode3: customerCostCenterCode,
      VatGroup: sourceLine.vat_group || undefined,
      // Fixed per the admin's own spec — not looked up from
      // customer_require_shelflife like a real goods line.
      U_ReqSLFrom: 0,
      U_ReqSLTo: 100,
      // U_SONo deliberately omitted — it mirrors the header's own U_DocNo
      // (see createDraftSalesOrder's call below), which SAP generates
      // server-side via SBO_SP_TransactionNotification AFTER this Sales
      // Order is added, so there's nothing for this client to set here.
      U_SODate: vnToday,
      U_PM_BaseItem: sourceLine.sap_item_code,
      U_PM_BaseLine: `${meta.index}-${sourceLine.sap_item_code}`,
      U_INVDesc: description,
      U_SortField: `${sortFieldPrefix(meta.index, sourceLine.sap_item_code)}_${sortSuffix}`,
      U_PM_Type: pmType,
      U_PM_HavingSetupPrrt: "N",
      U_CTKM: ctkmCode,
      U_CTKM_NAME: ctkmName,
      U_PM_FreeQty: 0,
      U_PM_DiscPercent: pct,
      U_PM_DiscAmount: 0,
      U_PM_DiscPrice: 0,
      U_PM_PriceBefFix: 0,
      U_PM_FixPrice: 0,
      U_PM_GUID: pmGuid,
      U_PM_PrrtPMApplied: prrtPMApplied,
    };
  }

  // One free/gift item line (buy-X-get-Y) — the linkage to its buy line
  // (source_line_id) already exists from checkout; this only adds the PM
  // bookkeeping fields and looks up the giveaway promotion's own NAME for
  // U_CTKM_NAME (U_CTKM itself is NEVER set on a gift line, only on the
  // Promotion Discount line — per the admin's own spec). Unlike discount
  // lines, a gift line's VatGroup/U_ItemTaxClass/U_ReqSLFrom-To come from
  // the FREE ITEM's own master data, not the buy line's.
  function buildGiftLine(l: typeof lines[number]) {
    const buyLine = l.source_line_id ? lines.find((x) => x.id === l.source_line_id) : undefined;
    const meta = buyLine ? lineMetaById.get(buyLine.id) : undefined;
    const ctkmName = buyLine ? bestGiveawayPromotionName(buyLine, l.sap_item_code) : null;
    return {
      ItemCode: l.sap_item_code,
      Quantity: l.confirm_qty,
      UnitPrice: 0,
      WarehouseCode: warehouseCode,
      ShipDate: vnToday,
      CostingCode: l.brand_code || undefined,
      COGSCostingCode: l.brand_code || undefined,
      CostingCode2: departmentCode,
      COGSCostingCode2: departmentCode,
      CostingCode3: customerCostCenterCode,
      COGSCostingCode3: customerCostCenterCode,
      U_ReqSLFrom: requiredShelfLifeByItem.get(l.sap_item_code)?.from ?? undefined,
      U_ReqSLTo: requiredShelfLifeByItem.get(l.sap_item_code)?.to ?? undefined,
      VatGroup: l.vat_group || undefined,
      // U_SONo deliberately omitted — it mirrors the header's own U_DocNo
      // (see createDraftSalesOrder's call below), which SAP generates
      // server-side via SBO_SP_TransactionNotification AFTER this Sales
      // Order is added, so there's nothing for this client to set here.
      U_SODate: vnToday,
      U_PM_BaseItem: buyLine?.sap_item_code,
      U_PM_BaseLine: meta && buyLine ? `${meta.index}-${buyLine.sap_item_code}` : undefined,
      // Dscription stays the item name; the invoice text marks it as a free promotional item.
      ItemDescription: l.sap_item_name,
      // U_INVDesc is 254 chars max — trim the name, never the suffix.
      U_INVDesc: `${l.sap_item_name.slice(0, 254 - FREE_ITEM_SUFFIX.length)}${FREE_ITEM_SUFFIX}`,
      U_SortField: meta && buyLine ? `${sortFieldPrefix(meta.index, buyLine.sap_item_code)}_31` : undefined,
      U_PM_Type: "31",
      U_PM_HavingSetupPrrt: "N",
      U_CTKM_NAME: ctkmName || undefined,
      U_PM_FreeQty: l.confirm_qty,
      U_PM_DiscPercent: 0,
      U_PM_DiscAmount: 0,
      U_PM_DiscPrice: 0,
      U_PM_PriceBefFix: 0,
      U_PM_FixPrice: 0,
      U_PM_GUID: pmGuid,
      U_PM_PrrtPMApplied: l.confirm_qty,
      U_ItemTaxClass: l.item_tax_class || undefined,
    };
  }

  const contractLines = inventoryLines
    .map((l) => {
      const pct = bestContractDiscountPct(l);
      if (pct === null) return null;
      return buildDiscountLine(
        l, "CK99999998", `Chiết khấu nền ${pct.toFixed(1)}% - ${l.item_name}`, pct,
        "98", "11", undefined, undefined, 0
      );
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const promotionLines = inventoryLines
    .map((l) => {
      const match = bestPromotionDiscount(l, l.confirm_qty);
      if (!match) return null;
      const name = match.name || "PROMOTION DISCOUNT";
      return buildDiscountLine(
        l, "CK99999999", name, match.pct,
        "20", "12", match.code || undefined, name, 52
      );
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const documentLines = [
    ...inventoryLines.map(buildInventoryLine),
    ...contractLines,
    ...promotionLines,
    ...giftLines.map(buildGiftLine),
  ];

  const sap = getSapClient();

  // Invoice-related header fields (from the customer BusinessPartner) and
  // who this order's DocumentsOwner/U_OwnerName should be (see
  // resolveOrderOwner's own docstring) — two independent SAP lookups, run
  // concurrently rather than back-to-back. Neither blocks the push on
  // failure: getBusinessPartner already catches its own errors into null,
  // and resolveOrderOwner never throws either — a failure/no-match on
  // either side just leaves its own header fields unset.
  // When fillOwner is disabled (config.json sapb1.fillOwner != "Yes"),
  // skip the resolveOrderOwner round-trip entirely and leave owner fields
  // out of the SAP payload so all SAP users can see every order.
  const fillOwner = isFillOwnerEnabled();
  const [businessPartner, orderOwner] = await Promise.all([
    sap.getBusinessPartner(order.sap_card_code),
    fillOwner ? sap.resolveOrderOwner(admin?.owner_code || null) : Promise.resolve(null),
  ]);

  // Read the Post SO Mode setting — determines whether to push as SAP Draft or
  // a confirmed SAP Sales Order. Defaults to 'draft' if the row is missing.
  const settingsRow = await queryOne<{ post_so_mode: string }>(
    `SELECT post_so_mode FROM sync_schedule_settings WHERE company_id = ?`,
    [companyId]
  );
  const postSoMode: "draft" | "sales_order" =
    settingsRow?.post_so_mode === "sales_order" ? "sales_order" : "draft";

  const sapPayload = {
    CardCode: order.sap_card_code,
    Comments: order.remark || undefined,
    DocDate: vnToday,
    DocDueDate: vnToday,
    U_ProdBrand: headerBrand,
    // Portal order number stamped onto the SAP header so it's visible in SAP B1.
    U_RelDocs: orderNumber,
    // "Y" only if at least one Promotion Discount line is actually
    // being pushed — left unset otherwise, not forced to "N".
    U_GetPMStatus: promotionLines.length > 0 ? "Y" : undefined,
    U_InvEmail: businessPartner?.EmailAddress || undefined,
    U_BPPaymentMethod: "TM/CK",
    // UDF is 200 chars max (confirmed via /UserFieldsMD) — truncate
    // defensively rather than let an unusually long address get rejected.
    U_InvAddress: businessPartner?.Address?.slice(0, 200) || undefined,
    U_InvTaxNo: businessPartner?.FederalTaxID || undefined,
    U_InvName: businessPartner?.CardName || undefined,
    // Chosen in the admin "Self create" dialog; unset on storefront orders,
    // where SAP fills the customer's own defaults.
    PayToCode: order.bill_to_code || undefined,
    ShipToCode: order.ship_to_code || undefined,
    U_CusSEL04: order.supervisor_code || undefined,
    // DocumentsOwner (SAP B1's "Owner" authorization field) / U_OwnerName —
    // see resolveOrderOwner. Only set when fillOwner is enabled in config;
    // omitted entirely when disabled so all SAP users can see every order.
    // Also omitted if no Employee could be resolved at all, same "set it up,
    // or it's skipped cleanly" rule as departmentCode above.
    ...(fillOwner && orderOwner ? { DocumentsOwner: orderOwner.employeeId, U_OwnerName: orderOwner.ownerName } : {}),
    // U_DocNo omitted — it's generated server-side by SAP's own
    // SBO_SP_TransactionNotification trigger after this Sales Order is
    // added (format SOO+YYMMDD+3-digit running number), not something
    // this client sets on create.
    DocumentLines: documentLines,
  };

  let sapResult: { DocEntry: number; DocNum: number };
  try {
    sapResult = postSoMode === "sales_order"
      ? await sap.createSalesOrder(sapPayload)
      : await sap.createDraftSalesOrder(sapPayload);
  } catch (error) {
    console.error("[Admin] Failed to push order to SAP B1:", error);
    const label = postSoMode === "sales_order" ? "SAP B1 sales order" : "SAP B1 draft order";
    return NextResponse.json(
      { error: `Failed to create ${label}`, message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }

  // Portal status: draft mode → 'sap_draft_created'; direct SO mode → 'approved'
  // (SAP will immediately process it as a real order, so 'approved' is accurate)
  const newPortalStatus = postSoMode === "sales_order" ? "approved" : "sap_draft_created";

  await query(
    `UPDATE orders SET status = ?, sap_doc_entry = ?, sap_doc_num = ?, warehouse_code = ? WHERE company_id = ? AND id = ?`,
    [newPortalStatus, sapResult.DocEntry, sapResult.DocNum, warehouseCode, companyId, orderId]
  );
  await recordOrderStatus(orderId, newPortalStatus);
  await notifyCustomerOfStatusChange(orderId, newPortalStatus);

  // Persist live availability snapshot on order lines at confirm
  for (const [sapItemCode, availQty] of availabilityByItem.entries()) {
    await query(
      `UPDATE order_lines SET avail_qty = ? WHERE company_id = ? AND order_id = ? AND sap_item_code = ?`,
      [availQty, companyId, orderId, sapItemCode]
    );
  }

  // ── Direct Sales Order: read back U_DocNo (e.g. SOO261016001) immediately ──
  // When posting as a confirmed SO, the DocEntry we just got back IS the real
  // Sales Order DocEntry (not a Draft), so /Orders(docEntry) will find it.
  // U_DocNo is filled by SAP's SBO_SP_TransactionNotification trigger during
  // the INSERT, so it should already be present on a GET right after create.
  let sapSoNumber: string | null = null;
  if (postSoMode === "sales_order") {
    try {
      const soStatus = await sap.getSalesOrderStatus(sapResult.DocEntry, orderNumber);
      sapSoNumber = soStatus?.U_DocNo || null;
      if (sapSoNumber) {
        await query(
          `UPDATE orders SET sap_so_number = ? WHERE company_id = ? AND id = ?`,
          [sapSoNumber, companyId, orderId]
        );
        console.log(`[Admin] SO created — U_DocNo=${sapSoNumber} written to sap_so_number for order ${orderId}`);
      }
    } catch (err) {
      // Non-fatal: the scheduled sync will pick it up later
      console.warn(`[Admin] Could not read back U_DocNo after SO create:`, err);
    }
  }

  await logAuditEvent({
    actorType: "admin", actorId: guard.session.adminId, actorLabel: guard.session.email,
    action: "order_confirm", entityType: "order", entityId: orderId,
    details: {
      orderNumber, warehouseCode, postSoMode,
      sapDocEntry: sapResult.DocEntry, sapDocNum: sapResult.DocNum, sapSoNumber,
    },
    request,
  });

  return NextResponse.json({
    success: true,
    sapDocEntry: sapResult.DocEntry,
    sapDocNum: sapResult.DocNum,
    sapSoNumber,
    // Any line the live pre-confirm check capped below its last saved
    // Confirm Qty — empty on the common path where nothing changed.
    adjustments,
    // Lines the customer explicitly Rejected — not sent to SAP at all,
    // dropped from this order silently from SAP's point of view, but
    // flagged here so the admin sees what got left out.
    rejectedItems: rejectedLines.map((l) => l.sap_item_code),
  });
}
