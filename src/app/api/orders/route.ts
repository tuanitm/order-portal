import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/orders — Create a new order
 * Saves to MySQL and pushes Draft Sales Order to SAP B1.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerName, deliveryAddress, contactPhone, contactEmail, remark, lines, language } = body;

    // Validate required fields
    if (!customerName || !contactPhone || !lines || lines.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: customerName, contactPhone, lines" },
        { status: 400 }
      );
    }

    // Generate order number
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const seq = String(Math.floor(Math.random() * 99999)).padStart(5, "0");
    const orderNumber = `ORD-${dateStr}-${seq}`;

    // Calculate totals
    let subtotal = 0;
    let grandTotal = 0;

    for (const line of lines) {
      const lineTotal = line.unitPrice * line.quantity;
      const discountAmount = lineTotal * (line.discountPercent || 0) / 100;
      subtotal += line.unitPrice * line.quantity;
      grandTotal += lineTotal - discountAmount;
    }

    const discountTotal = subtotal - grandTotal;

    // TODO: Save to MySQL database
    // const orderId = await insertOrder({ orderNumber, customerName, ... });

    // TODO: Push to SAP B1 as Draft Sales Order
    // const sapClient = getSapClient();
    // const sapResult = await sapClient.createDraftSalesOrder({ ... });

    return NextResponse.json({
      success: true,
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
 * GET /api/orders — List user orders
 */
export async function GET() {
  try {
    // TODO: Get user from session and fetch from MySQL
    // For now return demo data
    return NextResponse.json({
      orders: [],
      total: 0,
      page: 1,
      totalPages: 0,
    });
  } catch (error) {
    console.error("[API] List orders error:", error);
    return NextResponse.json(
      { error: "Failed to list orders" },
      { status: 500 }
    );
  }
}
