import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getSapClient } from "@/lib/sap-b1/client";
import { recordOrderStatus } from "@/lib/orderHistory";

interface OrderRow {
  id: number;
  remark: string | null;
  sap_doc_entry: number | null;
  sap_card_code: string | null;
}

interface OrderLineRow {
  sap_item_code: string;
  quantity: number;
  base_unit_price: string;
}

/**
 * POST /api/admin/orders/[id]/confirm — admin confirms a submitted order,
 * pushing it to SAP B1 as a Draft Sales Order. This is the only place the
 * SAP push happens — POST /api/orders only ever writes to MySQL, so nothing
 * reaches SAP until an admin explicitly confirms it here.
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

  const order = await queryOne<OrderRow>(
    `SELECT o.id, o.remark, o.sap_doc_entry, u.sap_card_code
     FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?`,
    [orderId]
  );
  if (!order) {
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

  const lines = await query<OrderLineRow[]>(
    `SELECT sap_item_code, quantity, base_unit_price FROM order_lines WHERE order_id = ?`,
    [orderId]
  );
  if (lines.length === 0) {
    return NextResponse.json({ error: "Order has no lines" }, { status: 400 });
  }

  const sap = getSapClient();
  let sapResult: { DocEntry: number; DocNum: number };
  try {
    sapResult = await sap.createDraftSalesOrder({
      CardCode: order.sap_card_code,
      Comments: order.remark || undefined,
      DocumentLines: lines.map((l) => ({
        ItemCode: l.sap_item_code,
        Quantity: l.quantity,
        // Only item, quantity and the pre-discount channel price go to SAP —
        // not discount_percent or the net unit_price. SAP B1 has its own
        // function that applies the discount structure to this base price.
        UnitPrice: Number(l.base_unit_price),
      })),
    });
  } catch (error) {
    console.error("[Admin] Failed to push order to SAP B1:", error);
    return NextResponse.json(
      { error: "Failed to create SAP B1 draft order", message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }

  await query(
    `UPDATE orders SET status = 'sap_draft_created', sap_doc_entry = ?, sap_doc_num = ? WHERE id = ?`,
    [sapResult.DocEntry, sapResult.DocNum, orderId]
  );
  await recordOrderStatus(orderId, "sap_draft_created");

  return NextResponse.json({ success: true, sapDocEntry: sapResult.DocEntry, sapDocNum: sapResult.DocNum });
}
