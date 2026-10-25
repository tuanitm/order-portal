import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getVisibleWarehousesForCustomerGroup } from "@/lib/warehouseVisibility";
import { isOrderInAdminScope } from "@/lib/adminScope";

/**
 * GET /api/admin/orders/[id]/warehouses — the warehouses this order's
 * customer can see ("Warehouse Visibility": their level-2 group's
 * customer_group_warehouses mapping if any, else every Included
 * warehouse — see getVisibleWarehousesForCustomerGroup). Populates the
 * warehouse dropdown on the admin Order Review page; the page auto-selects
 * the first one returned and fetches live stock for it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });

  if (!(await isOrderInAdminScope(guard.session, orderId))) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const order = await queryOne<{ sap_cus_grp02: string | null }>(
    `SELECT u.sap_cus_grp02 FROM orders o LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id WHERE o.company_id = ? AND o.id = ?`,
    [getCompanyId(), orderId]
  );
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const warehouses = await getVisibleWarehousesForCustomerGroup(order.sap_cus_grp02);
  return NextResponse.json({ warehouses });
}
