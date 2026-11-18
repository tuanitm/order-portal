import { sortOrderLines } from "@/lib/orderLineSort";
import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/session";
import { getVatRates } from "@/lib/vatRates";
import { audited } from "@/lib/auditLog";

/**
 * GET /api/orders/[id] — a single order's detail, for the customer who
 * placed it. Scoped to `user_id = session user` — returns 404 (not 403, to
 * avoid confirming an order id exists) for anyone else's order.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const companyId = getCompanyId();

  const order = await queryOne(
    `SELECT id, order_number, customer_name, delivery_address, billing_address, contact_phone, contact_email,
            subtotal, discount_total, grand_total, remark, status, sap_doc_entry, sap_doc_num, created_at
     FROM orders WHERE company_id = ? AND id = ? AND user_id = ?`,
    [companyId, orderId, user.id]
  );
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const rawLines = await query<{ id: number; sap_item_code: string; is_gift_line: number; source_line_id: number | null; line_total: string; vat_group: string | null }[]>(
    `SELECT ol.id, ol.sap_item_code, ol.item_name, ol.quantity, ol.uom, ol.unit_price, ol.discount_percent, ol.line_total,
            ol.confirm_qty, ol.customer_confirm_status, ol.is_gift_line, ol.source_line_id, i.vat_group
     FROM order_lines ol
     LEFT JOIN items i ON i.company_id = ol.company_id AND i.sap_item_code = ol.sap_item_code
     WHERE ol.company_id = ? AND ol.order_id = ?`,
    [companyId, orderId]
  );

  // VAT: Line Total is before tax (the SAP Sales Order adds VAT from each
  // line's VAT group), so tax = Line Total x the item's VAT rate, rounded per
  // line to whole VND. vat_rate is null when the rate isn't known.
  const vatRates = await getVatRates();
  const lines = sortOrderLines(rawLines).map((l) => {
    const rate = l.vat_group ? vatRates.get(l.vat_group) ?? null : null;
    return { ...l, vat_rate: rate, vat_amount: rate === null ? null : Math.round((Number(l.line_total) * rate) / 100) };
  });
  const vatByRate = new Map<number, number>();
  for (const l of lines) {
    if (l.vat_rate !== null && l.vat_amount !== null) vatByRate.set(l.vat_rate, (vatByRate.get(l.vat_rate) ?? 0) + l.vat_amount);
  }
  const vatTotal = [...vatByRate.values()].reduce((s, v) => s + v, 0);
  const tax = {
    complete: lines.every((l) => l.vat_rate !== null || Number(l.line_total) === 0),
    byRate: [...vatByRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amount]) => ({ rate, amount })),
    total: vatTotal,
    grandTotalWithTax: Number((order as { grand_total: string }).grand_total) + vatTotal,
  };

  const history = await query<{ status: string; created_at: string }[]>(
    `SELECT status, created_at FROM order_status_history WHERE company_id = ? AND order_id = ? ORDER BY created_at DESC, id DESC`,
    [companyId, orderId]
  );

  // Orders placed before status history existed have no rows — fall back to
  // the one status/time we do know.
  const o = order as { status: string; created_at: string };
  return NextResponse.json({
    order,
    lines,
    tax,
    history: history.length > 0 ? history : [{ status: o.status, created_at: o.created_at }],
  });
}

/**
 * PATCH /api/orders/[id] — the customer editing their own order's
 * delivery_address / contact_phone / remark (e.g. a wrong address flagged
 * by admin in the message thread). Only while the order hasn't been
 * pushed to SAP yet — once it has, this is SAP's record, not something to
 * silently change here. Body: any subset of { deliveryAddress, contactPhone, remark }.
 */
async function PATCHHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  const companyId = getCompanyId();

  const order = await queryOne<{ sap_doc_entry: number | null }>(
    `SELECT sap_doc_entry FROM orders WHERE company_id = ? AND id = ? AND user_id = ?`,
    [companyId, orderId, user.id]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.sap_doc_entry) {
    return NextResponse.json({ error: "This order has already been pushed to SAP and can no longer be edited" }, { status: 409 });
  }

  const body = await request.json();
  const updates: string[] = [];
  const values: string[] = [];

  if (typeof body.contactPhone === "string") {
    updates.push("contact_phone = ?");
    values.push(body.contactPhone.trim());
  }
  if (typeof body.remark === "string") {
    updates.push("remark = ?");
    values.push(body.remark.trim());
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(companyId, String(orderId));
  await query(`UPDATE orders SET ${updates.join(", ")} WHERE company_id = ? AND id = ?`, values);
  return NextResponse.json({ success: true });
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const PATCH = audited({ action: "order_update", entityType: "order", entityParam: "id" }, PATCHHandler);
