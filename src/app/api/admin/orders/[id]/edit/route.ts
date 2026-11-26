import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { isOrderInAdminScope } from "@/lib/adminScope";
import { getOrderWarehouses } from "@/lib/adminOrderCreate";
import { recalculateLinkedGiftQty } from "@/lib/orderGifts";
import { recalculateOrderTotals } from "@/lib/orderTotals";
import { canEditOrders, NON_EDITABLE_STATUSES, resolveSapOrderTarget } from "@/lib/orderSapUpdate";
import { audited, logAuditEvent } from "@/lib/auditLog";
import { getCustomerForAdmin } from "@/lib/adminOrderCreate";
import { loadOrderForEdit, fullEditLock, orderBrandOf, staffEditPricer, saveOrderEdit, editNote, OrderEditError, type OrderEditInput } from "@/lib/orderEdit";
import { postOrderMessage } from "@/lib/orderMessages";

interface EditBody {
  warehouse?: string;
  billTo?: string | null;
  shipTo?: string | null;
  supervisor?: string | null;
  remark?: string | null;
  contactPhone?: string | null;
  /** New quantity of buy lines (gift lines follow their buy line's promotion ratio). */
  lines?: { lineId: number; qty: number }[];
}

/**
 * PATCH /api/admin/orders/[id]/edit — "Edit order" on the order page
 * (Admin, Accountant, System Admin). Changes the header (warehouse,
 * bill-to / ship-to, Sales Supervisor, remark, phone) and the quantities of
 * existing lines; the customer stays the same and no items are added or
 * removed. A staff edit is final: changed quantities need no customer
 * Accept/Reject. Prices and discounts are recalculated by the totals helper;
 * the SAP discount / gift lines are rebuilt when the order is pushed / updated.
 *
 * For an order already in SAP the SAP document must still be changeable (open,
 * not delivered / invoiced); the edit marks the order "not yet in SAP"
 * (sap_outdated_at) until "Update SAP" (POST .../confirm?mode=update).
 */
async function PATCHHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;
  const session = guard.session;
  if (!canEditOrders(session)) {
    return NextResponse.json({ error: "Only Admin, Accountant and System Admin users can edit orders" }, { status: 403 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  if (!(await isOrderInAdminScope(session, orderId))) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as EditBody | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const companyId = getCompanyId();
  const order = await queryOne<{ id: number; order_number: string; status: string; sap_doc_entry: number | null; sap_card_code: string | null; ar_status: string | null }>(
    `SELECT o.id, o.order_number, o.status, o.sap_doc_entry, COALESCE(o.sap_card_code, u.sap_card_code) AS sap_card_code, o.ar_status
       FROM orders o LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id
      WHERE o.company_id = ? AND o.id = ?`,
    [companyId, orderId]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (NON_EDITABLE_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: `A ${order.status} order can't be edited` }, { status: 409 });
  }
  if (order.ar_status === "approved") return NextResponse.json({ error: "This order is AR Approved — it can't be edited" }, { status: 409 });
  if (order.sap_doc_entry) {
    try {
      await resolveSapOrderTarget(order);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  }

  // ── Header ──
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); values.push(v); };

  if (body.warehouse !== undefined) {
    const wh = String(body.warehouse || "").trim();
    if (!wh) return NextResponse.json({ error: "Select a warehouse" }, { status: 400 });
    if (!(await getOrderWarehouses(session)).some((w) => w.code === wh)) {
      return NextResponse.json({ error: `Warehouse ${wh} is not one of your warehouses (Roles → Warehouses)` }, { status: 400 });
    }
    set("warehouse_code", wh);
  }
  if (body.billTo !== undefined || body.shipTo !== undefined) {
    const addresses = await query<{ address_type: string; address_name: string; full_address: string | null }[]>(
      `SELECT address_type, address_name, full_address FROM customer_addresses WHERE company_id = ? AND sap_card_code = ?`,
      [companyId, order.sap_card_code]
    );
    const find = (type: string, name: string) => addresses.find((a) => a.address_type === type && a.address_name === name);
    if (body.billTo !== undefined) {
      const name = body.billTo ? String(body.billTo) : null;
      const a = name ? find("bill_to", name) : null;
      if (name && !a) return NextResponse.json({ error: `Bill-to address "${name}" not found for this customer` }, { status: 400 });
      set("bill_to_code", a?.address_name ?? null);
      set("billing_address", a?.full_address ?? null);
    }
    if (body.shipTo !== undefined) {
      const name = body.shipTo ? String(body.shipTo) : null;
      const a = name ? find("ship_to", name) : null;
      if (name && !a) return NextResponse.json({ error: `Ship-to address "${name}" not found for this customer` }, { status: 400 });
      set("ship_to_code", a?.address_name ?? null);
      set("delivery_address", a?.full_address ?? null);
    }
  }
  if (body.supervisor !== undefined) {
    const code = body.supervisor ? String(body.supervisor) : null;
    const row = code ? await queryOne<{ code: string; name: string | null }>(`SELECT code, name FROM sales_supervisors WHERE company_id = ? AND code = ?`, [companyId, code]) : null;
    if (code && !row) return NextResponse.json({ error: `Sales supervisor ${code} not found` }, { status: 400 });
    set("supervisor_code", row?.code ?? null);
    set("supervisor_name", row?.name ?? null);
  }
  if (body.remark !== undefined) set("remark", String(body.remark ?? "").trim().slice(0, 1000) || null);
  if (body.contactPhone !== undefined) set("contact_phone", String(body.contactPhone ?? "").trim().slice(0, 50));

  // ── Quantities ──
  const lineEdits = Array.isArray(body.lines) ? body.lines : [];
  const current = await query<{ id: number; confirm_qty: number; is_gift_line: number; source_line_id: number | null }[]>(
    `SELECT id, confirm_qty, is_gift_line, source_line_id FROM order_lines WHERE company_id = ? AND order_id = ?`,
    [companyId, orderId]
  );
  const byId = new Map(current.map((l) => [l.id, l]));
  for (const e of lineEdits) {
    const line = byId.get(Number(e?.lineId));
    if (!line) return NextResponse.json({ error: `Line ${e?.lineId} is not on this order` }, { status: 400 });
    if (line.is_gift_line) return NextResponse.json({ error: "Free item quantities follow their buy line — change the buy line instead" }, { status: 400 });
    const qty = Number(e.qty);
    if (!Number.isInteger(qty) || qty < 0) return NextResponse.json({ error: "Quantities must be whole numbers, 0 or more" }, { status: 400 });
  }
  const finalQty = new Map(current.filter((l) => !l.is_gift_line).map((l) => [l.id, Number(l.confirm_qty)]));
  for (const e of lineEdits) finalQty.set(Number(e.lineId), Number(e.qty));
  if (![...finalQty.values()].some((q) => q > 0)) {
    return NextResponse.json({ error: "At least one item must keep a quantity above 0 — use Cancel Order to cancel the whole order" }, { status: 400 });
  }

  if (sets.length === 0 && lineEdits.length === 0) return NextResponse.json({ success: true, changed: false });

  // A staff edit is final — no customer Accept/Reject (gift lines that follow included).
  for (const e of lineEdits) {
    const lineId = Number(e.lineId);
    const qty = Number(e.qty);
    await query(`UPDATE order_lines SET confirm_qty = ?, customer_confirm_status = 'accepted' WHERE company_id = ? AND id = ?`, [qty, companyId, lineId]);
    const gifts = await recalculateLinkedGiftQty(lineId, qty);
    if (gifts.length) {
      await query(
        `UPDATE order_lines SET customer_confirm_status = 'accepted' WHERE company_id = ? AND id IN (${gifts.map(() => "?").join(",")})`,
        [companyId, ...gifts.map((g) => g.lineId)]
      );
    }
  }
  const totals = lineEdits.length ? await recalculateOrderTotals(orderId) : null;

  await query(
    `UPDATE orders SET ${[...sets, "edited_at = NOW()", "edited_by_admin_id = ?", "sap_outdated_at = IF(sap_doc_entry IS NULL, NULL, NOW())"].join(", ")}
      WHERE company_id = ? AND id = ?`,
    [...values, session.adminId, companyId, orderId]
  );

  return NextResponse.json({ success: true, changed: true, totals, sapOutdated: !!order.sap_doc_entry });
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const PATCH = audited({ action: "order_edit", entityType: "order", entityParam: "id" }, PATCHHandler);

/**
 * PUT /api/admin/orders/[id]/edit — full Order Edit while the order is not
 * yet in SAP (see lib/orderEdit.ts): header + lines (add / remove / change
 * SKU, quantity, program), every line re-priced with today's setup.
 * Body: { warehouse, billTo, shipTo, supervisor, remark, contactPhone, lines: [{ sapItemCode, quantity, promotionCode, giveawayKey }] }.
 * Any staff role with Orders, for orders within their data permissions (Sales too).
 */
async function PUTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;
  const session = guard.session;
  const orderId = parseInt((await params).id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  if (!(await isOrderInAdminScope(session, orderId))) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = await loadOrderForEdit(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const lock = fullEditLock(order, "staff");
  if (lock) return NextResponse.json({ error: `${lock} — it can't be edited` }, { status: 409 });
  if (order.sap_doc_entry) {
    // In SAP: only staff who can Update SAP, and only while the SAP document is still open (not delivered / invoiced).
    if (!canEditOrders(session)) return NextResponse.json({ error: "This order is in SAP — only Admin, Accountant and System Admin can edit it" }, { status: 403 });
    try {
      await resolveSapOrderTarget(order);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  }
  const body = (await request.json().catch(() => null)) as OrderEditInput | null;
  if (!body || !Array.isArray(body.lines)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const customer = order.sap_card_code ? await getCustomerForAdmin(session, order.sap_card_code) : null;
  if (!customer) return NextResponse.json({ error: "This order's customer is outside your customer groups" }, { status: 403 });
  const warehouse = String(body.warehouse ?? order.warehouse_code ?? "").trim();
  if (!warehouse) return NextResponse.json({ error: "Select a warehouse" }, { status: 400 });
  try {
    const pricer = await staffEditPricer(session, orderId, customer, warehouse, await orderBrandOf(orderId));
    const result = await saveOrderEdit(order, { ...body, warehouse }, { pricer, staff: session });
    const who = session.fullName || session.userid || session.email || "staff";
    await postOrderMessage(orderId, "admin", who, editNote(result, who, "vi")).catch(() => undefined);
    await logAuditEvent({
      actorType: "admin", actorId: session.adminId, actorLabel: session.email, action: "order_edit_full", entityType: "order", entityId: orderId,
      details: { previousTotal: result.previousTotal, grandTotal: result.grandTotal, added: result.added, removed: result.removed, lines: body.lines }, request,
    });
    return NextResponse.json({ success: true, ...result, sapOutdated: !!order.sap_doc_entry });
  } catch (e) {
    if (e instanceof OrderEditError) return NextResponse.json({ error: e.message, problems: e.problems }, { status: e.status });
    console.error("[Admin] Order edit failed:", e);
    return NextResponse.json({ error: "Failed to save the order" }, { status: 500 });
  }
}

export const PUT = audited({ action: "order_edit_full", entityType: "order", entityParam: "id", failuresOnly: true }, PUTHandler);
