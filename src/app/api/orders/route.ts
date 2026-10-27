import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db/connection";
import { createOrdersFromLines, type OrderLineInput } from "@/lib/orderCreate";
import { getCompanyId } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auditLog";

/**
 * POST /api/orders — the storefront checkout. Creates one order PER BRAND
 * represented in the cart, all in one transaction, status 'submitted' for
 * admin review — see createOrdersFromLines (src/lib/orderCreate.ts, shared
 * with the admin "Self create" dialog) for the brand split rules. Does NOT
 * push to SAP; an admin confirms each order (POST /api/admin/orders/[id]/confirm).
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

    const createdOrders = await createOrdersFromLines(
      {
        companyId, userId: user.id, sapCardCode: user.sapCardCode || null,
        customerName, deliveryAddress: deliveryAddress || null, contactPhone, contactEmail: contactEmail || null,
        remark: remark || null, language: language === "en" ? "en" : "vi",
      },
      lines
    );

    await logAuditEvent({
      actorType: "customer", actorId: user.id, actorLabel: user.email || user.fullName,
      action: "order_place", entityType: "order", entityId: createdOrders[0]?.orderId ?? null,
      details: { orders: createdOrders.map((o) => ({ orderId: o.orderId, orderNumber: o.orderNumber, grandTotal: o.grandTotal })) },
      request,
    });

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
