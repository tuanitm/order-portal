import { getPool, queryOne, query } from "@/lib/db/connection";

export interface OrderLineInput {
  sapItemCode: string;
  itemName: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  /** Pre-discount price, used only to compute the order's subtotal/discount. */
  originalPrice?: number;
  discountPercent: number;
  /** Buy-X-get-Y linkage — see order_lines in schema.sql. */
  isGift?: boolean;
  promoBuyQty?: number;
  promoGiveQty?: number;
  /** Set only on a gift line — the sapItemCode of the "buy" line (earlier in this same `lines` array) it came from. */
  sourceSapItemCode?: string;
  /** Set only on a line added via Excel Import — the customer's free-text Remark column for that row. */
  remark?: string;
  /** Discount-waterfall breakdown, snapshotted from the pricing lookup at add-to-cart time — see
   *  ProductWithPricing's fields of the same name. Unset on the gift line. */
  periodDiscPct?: number;
  contractDiscPct?: number;
  promoDiscPct?: number;
  /** Which specific promotion PROGRAM the customer chose on the product card — see
   *  src/lib/pricing/productPricing.ts's promotionOptions/giveawayOptions. Persisted so the SAP push
   *  (POST .../confirm) uses the same program instead of re-deriving a possibly-different "best" match. */
  promotionCode?: string;
  promotionName?: string;
  giveawayCode?: string;
  giveawayName?: string;
}

/** Order header shared by storefront and admin-created ("Self create") orders. */
export interface OrderHeaderInput {
  companyId: string;
  /** The portal login the order belongs to — null for a customer with no login. */
  userId: number | null;
  /** The SAP customer (BP) — null only for a storefront login not yet linked to one. */
  sapCardCode: string | null;
  customerName: string;
  deliveryAddress: string | null;
  contactPhone: string;
  contactEmail: string | null;
  remark: string | null;
  language: "vi" | "en";
  /** Admin "Self create" only — see the matching orders columns in schema.sql. */
  createdByAdminId?: number | null;
  warehouseCode?: string | null;
  billToCode?: string | null;
  billingAddress?: string | null;
  shipToCode?: string | null;
  supervisorCode?: string | null;
  supervisorName?: string | null;
}

export interface CreatedOrder {
  orderId: number;
  orderNumber: string;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  brandCode: string | null;
}

/** One brand-group's lines plus the order totals computed from just that group. */
interface OrderGroup {
  brandCode: string | null;
  lines: (OrderLineInput & { baseUnitPrice: number; netUnitPrice: number; lineTotal: number })[];
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
}

/**
 * Generates a `SO-{BP code}-{yymmdd}-{3 random digits}` order number, e.g.
 * SO-GTSO0701-260919-482 (Vietnam local time, UTC+7), re-rolling on a
 * collision (order_number is UNIQUE — the final guard against a concurrent
 * duplicate). Self-contained so it can be called once per brand-group when
 * a cart splits into several orders, same as it was called once for the
 * whole cart before the split existed.
 */
async function generateOrderNumber(companyId: string, bpCode: string): Promise<string> {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const yymmdd = vnNow.toISOString().slice(2, 10).replace(/-/g, "");
  let orderNumber = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    const seq = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    orderNumber = `SO-${bpCode}-${yymmdd}-${seq}`;
    const taken = await queryOne<{ id: number }>(
      "SELECT id FROM orders WHERE company_id = ? AND order_number = ? LIMIT 1",
      [companyId, orderNumber]
    );
    if (!taken) break;
  }
  return orderNumber;
}

/**
 * Creates one order PER BRAND represented in `lines` (Business Brand / Cost
 * Center control: SAP's Sales Order header can only carry a single
 * U_ProdBrand value, so a mixed-brand cart is split here rather than forcing
 * an ambiguous header downstream — see the MULTI_BRAND_FALLBACK_CODE comment
 * in POST /api/admin/orders/[id]/confirm, which remains only as a defensive
 * fallback for any edge case that still slips through). Brand is resolved
 * live from `items.brand_code` here, server-side — never from the caller.
 *
 * A buy line and its linked gift line always land in the SAME group (the
 * gift line's own item can legitimately belong to a different brand than
 * the item that earned it — promotion_discount.giving_item_code is
 * independent of selling_item_code — but source_line_id only makes sense
 * within one order, so the pairing wins over the gift's own brand).
 * Brand-less items (no items.brand_code at all) get their own group, never
 * merged into a real brand's order.
 *
 * Persists to MySQL (`orders` + `order_lines`, status = 'submitted') for
 * admin review, all orders in ONE transaction (atomic — either every group
 * is created or none is). Does NOT push to SAP — an admin confirms each
 * order separately (POST /api/admin/orders/[id]/confirm).
 *
 * Used by both the storefront checkout (POST /api/orders) and the admin
 * "Self create" dialog (POST /api/admin/orders/create).
 */
export async function createOrdersFromLines(header: OrderHeaderInput, lines: OrderLineInput[]): Promise<CreatedOrder[]> {
  const { companyId } = header;
  const bpCode = header.sapCardCode || "NA";

  // Prices are whole VND: base_unit_price, unit_price and line_total are
  // rounded to 0 decimals before being written (line_total from the exact
  // unitPrice x qty the customer saw, not from the rounded unit price).
  // unitPrice is already the net price (contract/promotion discounts
  // applied) — discountPercent is informational and must NOT be applied
  // again; the discount is originalPrice vs unitPrice.
  const roundedLines = lines.map((line) => ({
    ...line,
    baseUnitPrice: Math.round(line.originalPrice ?? line.unitPrice),
    netUnitPrice: Math.round(line.unitPrice),
    lineTotal: Math.round(line.unitPrice * line.quantity),
  }));

  // Authoritative, server-trusted brand per item code — a client's own
  // brandCode field is display-only and never consulted here.
  const distinctCodes = [...new Set(roundedLines.map((l) => l.sapItemCode))];
  const brandRows = distinctCodes.length > 0
    ? await query<{ sap_item_code: string; brand_code: string | null }[]>(
        `SELECT sap_item_code, brand_code FROM items WHERE company_id = ? AND sap_item_code IN (${distinctCodes.map(() => "?").join(",")})`,
        [companyId, ...distinctCodes]
      )
    : [];
  const brandByCode = new Map(brandRows.map((r) => [r.sap_item_code, r.brand_code]));

  // Group key: a buy line's own item brand; a gift line's BUY line's
  // brand (via sourceSapItemCode) — never the gift item's own brand, so
  // a buy+gift pair always stays in one order even if the free item
  // happens to belong to a different brand.
  const groupKeyFor = (line: (typeof roundedLines)[number]): string | null => {
    const codeForBrand = line.isGift && line.sourceSapItemCode ? line.sourceSapItemCode : line.sapItemCode;
    return brandByCode.get(codeForBrand) ?? null;
  };

  const groupsByKey = new Map<string | null, OrderGroup>();
  for (const line of roundedLines) {
    const key = groupKeyFor(line);
    let group = groupsByKey.get(key);
    if (!group) {
      group = { brandCode: key, lines: [], subtotal: 0, discountTotal: 0, grandTotal: 0 };
      groupsByKey.set(key, group);
    }
    group.lines.push(line);
    group.subtotal += line.baseUnitPrice * line.quantity;
    group.grandTotal += line.lineTotal;
  }
  for (const group of groupsByKey.values()) {
    group.discountTotal = group.subtotal - group.grandTotal;
  }
  const groups = [...groupsByKey.values()];

  const conn = await getPool().getConnection();
  const createdOrders: CreatedOrder[] = [];
  try {
    await conn.beginTransaction();

    for (const group of groups) {
      const orderNumber = await generateOrderNumber(companyId, bpCode);

      const [result] = await conn.execute(
        `INSERT INTO orders (
           company_id, order_number, user_id, sap_card_code, created_by_admin_id,
           warehouse_code, bill_to_code, billing_address, ship_to_code, supervisor_code, supervisor_name,
           customer_name, delivery_address, contact_phone, contact_email,
           subtotal, discount_total, grand_total, remark, status, language)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
        [
          companyId, orderNumber, header.userId, header.sapCardCode, header.createdByAdminId ?? null,
          header.warehouseCode ?? null, header.billToCode ?? null, header.billingAddress ?? null,
          header.shipToCode ?? null, header.supervisorCode ?? null, header.supervisorName ?? null,
          header.customerName, header.deliveryAddress || null, header.contactPhone, header.contactEmail || null,
          group.subtotal, group.discountTotal, group.grandTotal, header.remark || null, header.language === "en" ? "en" : "vi",
        ]
      );
      const orderId = (result as { insertId: number }).insertId;

      await conn.execute(
        `INSERT INTO order_status_history (company_id, order_id, status) VALUES (?, ?, 'submitted')`,
        [companyId, orderId]
      );

      // Buy lines are always listed before their gift line, so by the time
      // a gift line is reached its "buy" line's own just-inserted id is
      // already in this map — reset per group/order, since source_line_id
      // only ever needs to resolve within the SAME order.
      const lineIdBySapItemCode = new Map<string, number>();
      for (const line of group.lines) {
        const sourceLineId = line.isGift && line.sourceSapItemCode
          ? lineIdBySapItemCode.get(line.sourceSapItemCode) ?? null
          : null;

        const [lineResult] = await conn.execute(
          `INSERT INTO order_lines (
             company_id, order_id, sap_item_code, item_name, quantity, uom, base_unit_price, unit_price, discount_percent, line_total, confirm_qty,
             is_gift_line, source_line_id, promo_buy_qty, promo_give_qty, remark, period_disc_pct, contract_disc_pct, promo_disc_pct,
             promotion_code, promotion_name, giveaway_promotion_code, giveaway_promotion_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId, orderId, line.sapItemCode, line.itemName, line.quantity, line.uom,
            line.baseUnitPrice, line.netUnitPrice, line.discountPercent || 0, line.lineTotal, line.quantity,
            !!line.isGift, sourceLineId, line.promoBuyQty ?? null, line.promoGiveQty ?? null,
            line.remark?.trim() || null, line.periodDiscPct ?? null, line.contractDiscPct ?? null, line.promoDiscPct ?? null,
            line.promotionCode ?? null, line.promotionName ?? null, line.giveawayCode ?? null, line.giveawayName ?? null,
          ]
        );
        if (!line.isGift) {
          lineIdBySapItemCode.set(line.sapItemCode, (lineResult as { insertId: number }).insertId);
        }
      }

      createdOrders.push({
        orderId, orderNumber, subtotal: group.subtotal, discountTotal: group.discountTotal,
        grandTotal: group.grandTotal, brandCode: group.brandCode,
      });
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return createdOrders;
}
