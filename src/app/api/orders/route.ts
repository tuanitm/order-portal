import { NextRequest, NextResponse } from "next/server";
import { getPool, queryOne, query } from "@/lib/db/connection";
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
}

/**
 * POST /api/orders — Create a new order.
 * Persists to MySQL (`orders` + `order_lines`, status = 'submitted') for
 * admin review. Does NOT push to SAP here — an admin confirms the order
 * first (see POST /api/admin/orders/[id]/confirm), which is what actually
 * creates the SAP B1 Draft Sales Order.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check the linked SAP customer's Enable toggle (admin > SAP Customers)
    if (user.sapCardCode) {
      const customer = await queryOne<{ is_enabled: number }>(
        "SELECT is_enabled FROM customers WHERE sap_card_code = ? LIMIT 1",
        [user.sapCardCode]
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

    // Order number: SO-{BP code}-{yymmdd}-{3 random digits}, e.g. SO-GTSO0701-260919-482.
    // The date is Vietnam local time (UTC+7). Only 1000 combinations exist per
    // BP per day, so re-roll if the number is already taken (order_number is
    // UNIQUE, which remains the final guard against a concurrent duplicate).
    const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const yymmdd = vnNow.toISOString().slice(2, 10).replace(/-/g, "");
    const bpCode = user.sapCardCode || "NA";
    let orderNumber = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const seq = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
      orderNumber = `SO-${bpCode}-${yymmdd}-${seq}`;
      const taken = await queryOne<{ id: number }>("SELECT id FROM orders WHERE order_number = ? LIMIT 1", [orderNumber]);
      if (!taken) break;
    }

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

    // Order totals are summed from the rounded line values so they reconcile
    // with the lines shown.
    let subtotal = 0;
    let grandTotal = 0;
    for (const l of roundedLines) {
      subtotal += l.baseUnitPrice * l.quantity;
      grandTotal += l.lineTotal;
    }
    const discountTotal = subtotal - grandTotal;

    const pool = getPool();
    const conn = await pool.getConnection();
    let orderId: number;
    try {
      await conn.beginTransaction();

      const [result] = await conn.execute(
        `INSERT INTO orders (
           order_number, user_id, customer_name, delivery_address, contact_phone, contact_email,
           subtotal, discount_total, grand_total, remark, status, language)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
        [
          orderNumber, user.id, customerName, deliveryAddress || null, contactPhone, contactEmail || null,
          subtotal, discountTotal, grandTotal, remark || null, language === "en" ? "en" : "vi",
        ]
      );
      orderId = (result as { insertId: number }).insertId;

      await conn.execute(
        `INSERT INTO order_status_history (order_id, status) VALUES (?, 'submitted')`,
        [orderId]
      );

      for (const line of roundedLines) {
        await conn.execute(
          `INSERT INTO order_lines (order_id, sap_item_code, item_name, quantity, uom, base_unit_price, unit_price, discount_percent, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId, line.sapItemCode, line.itemName, line.quantity, line.uom,
            line.baseUnitPrice, line.netUnitPrice, line.discountPercent || 0, line.lineTotal,
          ]
        );
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
      orderId,
      orderNumber,
      subtotal,
      discountTotal,
      grandTotal,
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

    const totalRows = await query<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?`,
      [user.id]
    );
    const total = totalRows[0]?.cnt ?? 0;

    const orders = await query(
      `SELECT o.id, o.order_number, o.customer_name, o.subtotal, o.discount_total, o.grand_total,
              o.status, o.sap_doc_entry, o.sap_doc_num, o.created_at,
              (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id) AS line_count
       FROM orders o WHERE o.user_id = ?
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, limit, offset]
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
