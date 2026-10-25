import { NextRequest, NextResponse } from "next/server";
import { getPool, queryOne, query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/session";

interface OrderLineInput {
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
 * POST /api/orders — Create one order PER BRAND represented in the cart
 * (Business Brand / Cost Center control: SAP's Sales Order header can only
 * carry a single U_ProdBrand value, so a mixed-brand cart is split here
 * rather than forcing an ambiguous header downstream — see the
 * MULTI_BRAND_FALLBACK_CODE comment in POST /api/admin/orders/[id]/confirm,
 * which remains only as a defensive fallback for any edge case that still
 * slips through). Brand is resolved live from `items.brand_code` here,
 * server-side — the client's cart/checkout preview grouping is display-only
 * and never trusted for the actual split, so a resync between what the
 * customer previewed and what the server persists can't happen.
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
 * is created or none is). Does NOT push to SAP here — an admin confirms
 * each order separately (see POST /api/admin/orders/[id]/confirm), which is
 * what actually creates the SAP B1 Draft Sales Order; that route already
 * operates strictly one order at a time, so splitting here needs no change
 * there.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const companyId = getCompanyId();

    // Check the linked SAP customer's Enable toggle (admin > SAP Customers)
    if (user.sapCardCode) {
      const customer = await queryOne<{ is_enabled: number }>(
        "SELECT is_enabled FROM customers WHERE company_id = ? AND sap_card_code = ? LIMIT 1",
        [companyId, user.sapCardCode]
      );
      if (customer && !customer.is_enabled) {
        return NextResponse.json(
          { error: "This account was blocked, please contact Admin 0908404678 to enable account again." },
          { status: 403 }
        );
      }
    }

    const body = await request.json();
    const { customerName, deliveryAddress, contactPhone, contactEmail, remark, lines, language } = body as {
      customerName: string;
      deliveryAddress: string;
      contactPhone: string;
      contactEmail: string;
      remark: string;
      lines: OrderLineInput[];
      language: "vi" | "en";
    };

    // Validate required fields
    if (!customerName || !contactPhone || !lines || lines.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: customerName, contactPhone, lines" },
        { status: 400 }
      );
    }

    const bpCode = user.sapCardCode || "NA";

    // Prices are whole VND: base_unit_price, unit_price and line_total are
    // rounded to 0 decimals before being written (line_total from the exact
    // unitPrice x qty the customer saw, not from the rounded unit price).
    // unitPrice is already the net price the customer was shown (contract/
    // promotion discounts applied) — discountPercent is informational and
    // must NOT be applied again; the discount is originalPrice vs unitPrice.
    const roundedLines = lines.map((line) => ({
      ...line,
      baseUnitPrice: Math.round(line.originalPrice ?? line.unitPrice),
      netUnitPrice: Math.round(line.unitPrice),
      lineTotal: Math.round(line.unitPrice * line.quantity),
    }));

    // Authoritative, server-trusted brand per item code — the client's own
    // cart/checkout brandCode field is display-only and never consulted
    // here, consistent with how brand is already looked up live elsewhere
    // in this codebase (Admin Order detail page, the SAP confirm route)
    // rather than trusted from a stored/submitted snapshot.
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

    const pool = getPool();
    const conn = await pool.getConnection();
    const createdOrders: { orderId: number; orderNumber: string; subtotal: number; discountTotal: number; grandTotal: number; brandCode: string | null }[] = [];
    try {
      await conn.beginTransaction();

      for (const group of groups) {
        const orderNumber = await generateOrderNumber(companyId, bpCode);

        const [result] = await conn.execute(
          `INSERT INTO orders (
             company_id, order_number, user_id, customer_name, delivery_address, contact_phone, contact_email,
             subtotal, discount_total, grand_total, remark, status, language)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
          [
            companyId, orderNumber, user.id, customerName, deliveryAddress || null, contactPhone, contactEmail || null,
            group.subtotal, group.discountTotal, group.grandTotal, remark || null, language === "en" ? "en" : "vi",
          ]
        );
        const orderId = (result as { insertId: number }).insertId;

        await conn.execute(
          `INSERT INTO order_status_history (company_id, order_id, status) VALUES (?, ?, 'submitted')`,
          [companyId, orderId]
        );

        // Buy lines are always listed before their gift line (see the
        // checkout page's flatMap), so by the time a gift line is reached
        // its "buy" line's own just-inserted id is already in this map —
        // reset per group/order, since source_line_id only ever needs to
        // resolve within the SAME order.
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

    return NextResponse.json({
      success: true,
      orders: createdOrders,
      status: "submitted",
      message: language === "vi"
        ? "Đơn hàng đã được gửi thành công"
        : "Order submitted successfully",
    });
  } catch (error) {
    console.error("[API] Create order error:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/orders — List the current customer's own orders.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const offset = (page - 1) * limit;

    const companyId = getCompanyId();

    const totalRows = await query<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM orders WHERE company_id = ? AND user_id = ?`,
      [companyId, user.id]
    );
    const total = totalRows[0]?.cnt ?? 0;

    const orders = await query(
      `SELECT o.id, o.order_number, o.customer_name, o.subtotal, o.discount_total, o.grand_total,
              o.status, o.sap_doc_entry, o.sap_doc_num, o.created_at,
              (SELECT COUNT(*) FROM order_lines ol WHERE ol.company_id = o.company_id AND ol.order_id = o.id) AS line_count
       FROM orders o WHERE o.company_id = ? AND o.user_id = ?
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [companyId, user.id, limit, offset]
    );

    return NextResponse.json({
      orders,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("[API] List orders error:", error);
    return NextResponse.json(
      { error: "Failed to list orders" },
      { status: 500 }
    );
  }
}
