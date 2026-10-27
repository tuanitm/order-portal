import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { logAuditEvent } from "@/lib/auditLog";
import { createOrdersFromLines } from "@/lib/orderCreate";
import {
  getCustomerForAdmin,
  findCustomerLogin,
  getOrderWarehouses,
  priceItemsForCustomer,
  buildOrderLines,
  type SelfCreateLineRequest,
} from "@/lib/adminOrderCreate";

const MAX_LINES = 300;

/**
 * POST /api/admin/orders/create — the "Self create" sales order dialog on
 * Admin → Orders: an admin places an order on behalf of a SAP customer (for
 * customers and distributors who don't order through the storefront
 * themselves). Every price is recomputed here from the customer's own
 * pricing; the result follows the normal flow — status 'submitted', then
 * "Confirm & Push to SAP" on the order page, which sends the chosen
 * addresses and Sales Supervisor along. Split into one order per brand, the
 * same as a storefront checkout.
 *
 * Body: { customer, warehouse, billTo?, shipTo?, supervisor?, remark?,
 *         lines: [{ sapItemCode, quantity, promotionCode?, giveawayKey? }] }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;
  const session = guard.session;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { customer: cardCode, warehouse, billTo, shipTo, supervisor, remark, lines } = body as {
    customer?: string; warehouse?: string; billTo?: string | null; shipTo?: string | null;
    supervisor?: string | null; remark?: string | null; lines?: SelfCreateLineRequest[];
  };

  if (!cardCode) return NextResponse.json({ error: "Select a customer" }, { status: 400 });
  if (!warehouse) return NextResponse.json({ error: "Select a warehouse" }, { status: 400 });
  if (!Array.isArray(lines) || lines.length === 0) return NextResponse.json({ error: "Add at least one item" }, { status: 400 });
  if (lines.length > MAX_LINES) return NextResponse.json({ error: `At most ${MAX_LINES} items per order` }, { status: 400 });
  const codes = lines.map((l) => String(l?.sapItemCode ?? "").trim());
  if (codes.some((c) => !c)) return NextResponse.json({ error: "Every line needs an item" }, { status: 400 });
  const duplicate = codes.find((c, i) => codes.indexOf(c) !== i);
  if (duplicate) return NextResponse.json({ error: `${duplicate} is on the order twice — change its quantity instead` }, { status: 400 });

  const companyId = getCompanyId();
  const customer = await getCustomerForAdmin(session, cardCode);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (!customer.is_enabled) {
    return NextResponse.json({ error: `${customer.sap_card_code} is blocked (SAP Customers → Enable) — no orders can be created for it` }, { status: 403 });
  }

  const warehouses = await getOrderWarehouses(session);
  if (!warehouses.some((w) => w.code === warehouse)) {
    return NextResponse.json({ error: `Warehouse ${warehouse} is not one of your warehouses (Admin Users → Warehouse)` }, { status: 400 });
  }

  const addresses = await query<{ address_type: string; address_name: string; full_address: string | null }[]>(
    `SELECT address_type, address_name, full_address FROM customer_addresses WHERE company_id = ? AND sap_card_code = ?`,
    [companyId, customer.sap_card_code]
  );
  const findAddress = (type: string, name: string | null | undefined) =>
    name ? addresses.find((a) => a.address_type === type && a.address_name === name) : undefined;
  const billing = findAddress("bill_to", billTo);
  const shipping = findAddress("ship_to", shipTo);
  if (billTo && !billing) return NextResponse.json({ error: `Bill-to address "${billTo}" not found for this customer` }, { status: 400 });
  if (shipTo && !shipping) return NextResponse.json({ error: `Ship-to address "${shipTo}" not found for this customer` }, { status: 400 });

  const supervisorRow = supervisor
    ? await queryOne<{ code: string; name: string | null }>(
        `SELECT code, name FROM sales_supervisors WHERE company_id = ? AND code = ?`, [companyId, supervisor])
    : null;
  if (supervisor && !supervisorRow) return NextResponse.json({ error: `Sales supervisor ${supervisor} not found` }, { status: 400 });

  try {
    const products = await priceItemsForCustomer(customer, warehouse, { codes });
    const { lines: orderLines, problems } = buildOrderLines(
      products,
      lines.map((l, i) => ({ ...l, sapItemCode: codes[i] }))
    );
    if (problems.length > 0) {
      return NextResponse.json({ error: "Some lines can't be ordered", problems }, { status: 400 });
    }

    const login = await findCustomerLogin(customer.sap_card_code);
    const created = await createOrdersFromLines(
      {
        companyId,
        userId: login?.id ?? null,
        sapCardCode: customer.sap_card_code,
        customerName: customer.card_name || customer.sap_card_code,
        deliveryAddress: shipping?.full_address ?? null,
        contactPhone: customer.phone || "",
        contactEmail: customer.email || login?.email || null,
        remark: remark?.trim() || null,
        language: login?.language ?? "vi",
        createdByAdminId: session.adminId,
        warehouseCode: warehouse,
        billToCode: billing?.address_name ?? null,
        billingAddress: billing?.full_address ?? null,
        shipToCode: shipping?.address_name ?? null,
        supervisorCode: supervisorRow?.code ?? null,
        supervisorName: supervisorRow?.name ?? null,
      },
      orderLines
    );

    await logAuditEvent({
      actorType: "admin", actorId: session.adminId, actorLabel: session.email,
      action: "order_self_create", entityType: "order", entityId: created[0]?.orderId ?? null,
      details: {
        customer: customer.sap_card_code, warehouse, attachedToLogin: login?.id ?? null,
        orders: created.map((o) => ({ orderId: o.orderId, orderNumber: o.orderNumber, grandTotal: o.grandTotal })),
      },
      request,
    });

    return NextResponse.json({ success: true, orders: created, attachedToLogin: !!login });
  } catch (error) {
    console.error("[Admin] Self-create order failed:", error);
    return NextResponse.json({ error: "Failed to create the order" }, { status: 500 });
  }
}
