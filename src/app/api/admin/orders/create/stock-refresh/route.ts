import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getOrderWarehouses } from "@/lib/adminOrderCreate";
import { refreshWarehouseStock } from "@/lib/stock/warehouseRefresh";

/**
 * POST /api/admin/orders/create/stock-refresh { warehouse } — refresh that
 * warehouse's stock from SAP (the 🔄 next to Warehouse in Create sales order
 * / Edit order). The dialog then re-prices its lines to show the new Avail Qty.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;
  const body = (await request.json().catch(() => ({}))) as { warehouse?: string };
  const wh = String(body.warehouse ?? "").trim();
  if (!wh) return NextResponse.json({ error: "Select a warehouse" }, { status: 400 });
  if (!(await getOrderWarehouses(guard.session)).some((w) => w.code === wh)) {
    return NextResponse.json({ error: `Warehouse ${wh} is not one of your warehouses` }, { status: 400 });
  }
  try {
    return NextResponse.json(await refreshWarehouseStock(wh));
  } catch (e) {
    console.error("[Admin] Warehouse stock refresh failed:", e);
    return NextResponse.json({ error: `Could not read the stock from SAP: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
