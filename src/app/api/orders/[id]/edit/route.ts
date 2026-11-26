import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { audited, logAuditEvent } from "@/lib/auditLog";
import { getCustomerAddressBook } from "@/lib/customerAddresses";
import { postOrderMessage } from "@/lib/orderMessages";
import { loadOrderForEdit, fullEditLock, orderBrandOf, customerEditPricer, saveOrderEdit, editNote, OrderEditError, type OrderEditInput } from "@/lib/orderEdit";

/**
 * Order Edit for the customer who placed the order (see lib/orderEdit.ts).
 *
 * GET  /api/orders/[id]/edit                 → { editable, lock, brand, billTo[], shipTo[] }
 * GET  /api/orders/[id]/edit?search=<text>   → { items } SKUs of the order's brand the customer can order (storefront rules)
 * GET  /api/orders/[id]/edit?codes=a,b       → { items } today's prices of those SKUs (lines already on the order even if out of stock)
 * PUT  /api/orders/[id]/edit  { billTo, shipTo, contactPhone, remark, lines: [{ sapItemCode, quantity, promotionCode, giveawayKey }] }
 *
 * Only while the order is not yet in SAP and not AR Approved.
 */
type Ctx = { error: NextResponse; user?: never; order?: never } | { error?: never; user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>; order: NonNullable<Awaited<ReturnType<typeof loadOrderForEdit>>> };
async function context(request: NextRequest, params: Promise<{ id: string }>): Promise<Ctx> {
  const user = await getSessionUser(request);
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const orderId = parseInt((await params).id, 10);
  if (isNaN(orderId)) return { error: NextResponse.json({ error: "Invalid order ID" }, { status: 400 }) };
  const order = await loadOrderForEdit(orderId, user.id);
  if (!order) return { error: NextResponse.json({ error: "Order not found" }, { status: 404 }) };
  return { user, order };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(request, params);
  if (ctx.error) return ctx.error;
  const { user, order } = ctx;
  const sp = request.nextUrl.searchParams;
  const brand = await orderBrandOf(order.id);
  try {
    if (sp.has("search") || sp.has("codes")) {
      const pricer = await customerEditPricer(user, order.id, brand);
      const codes = sp.has("codes") ? (sp.get("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 300) : undefined;
      return NextResponse.json({ items: await pricer(codes ? { codes } : { search: sp.get("search") ?? "" }) });
    }
    const lock = fullEditLock(order);
    const book = await getCustomerAddressBook(order.sap_card_code);
    return NextResponse.json({ editable: !lock, lock, brand, billTo: book.billTo, shipTo: book.shipTo });
  } catch (e) {
    console.error("[Orders] edit lookup failed:", e);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

async function PUTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(request, params);
  if (ctx.error) return ctx.error;
  const { user, order } = ctx;
  const vi = user.language !== "en";
  const lock = fullEditLock(order);
  if (lock) {
    return NextResponse.json({ error: vi ? "Đơn hàng đã được xác nhận / đẩy sang SAP nên không thể chỉnh sửa. Vui lòng liên hệ nhân viên phụ trách." : `${lock} — it can no longer be edited. Please contact our staff.` }, { status: 409 });
  }
  const body = (await request.json().catch(() => null)) as OrderEditInput | null;
  if (!body || !Array.isArray(body.lines)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const pricer = await customerEditPricer(user, order.id, await orderBrandOf(order.id));
    // A customer changes only their own header fields — warehouse / supervisor stay staff-only.
    const result = await saveOrderEdit(order, { billTo: body.billTo, shipTo: body.shipTo, contactPhone: body.contactPhone, remark: body.remark, lines: body.lines }, { pricer });
    const who = user.sapCardName || user.fullName || user.email || "customer";
    await postOrderMessage(order.id, "customer", who, editNote(result, who, vi ? "vi" : "en")).catch(() => undefined);
    await logAuditEvent({
      actorType: "customer", actorId: user.id, actorLabel: user.email || user.fullName, action: "order_edit_full", entityType: "order", entityId: order.id,
      details: { previousTotal: result.previousTotal, grandTotal: result.grandTotal, added: result.added, removed: result.removed, lines: body.lines }, request,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    if (e instanceof OrderEditError) return NextResponse.json({ error: e.message, problems: e.problems }, { status: e.status });
    console.error("[Orders] edit failed:", e);
    return NextResponse.json({ error: "Failed to save the order" }, { status: 500 });
  }
}

export const PUT = audited({ action: "order_edit_full", entityType: "order", entityParam: "id", failuresOnly: true }, PUTHandler);
