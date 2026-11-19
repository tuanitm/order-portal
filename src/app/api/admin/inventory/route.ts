import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryHanaInventoryByWarehouse } from "@/lib/hana/inventoryQuery";
import { getAdminWarehouses } from "@/lib/adminWarehouses";
import { computeBatchShelfLifePct } from "@/lib/sap-b1/sync";
import { getSapClient } from "@/lib/sap-b1/client";

/**
 * GET /api/admin/inventory?warehouses=1001,1003&page=1&limit=50&search=
 *
 * Runs the SAP QRM_Inventory by Warehouse query LIVE against HANA to get
 * OnHand, Committed (Open SO + Transfer Requests + Production Order components)
 * and Available per item per warehouse, plus each row's remaining shelf life
 * (worst batch, with every batch listed for the tooltip).
 *
 * Warehouses offered: this admin's warehouses (Admin Users → Warehouse; root =
 * every masterdata.wareHouse warehouse — see getAdminWarehouseCodes). Warehouse
 * Visibility doesn't apply here — it's the customers' rule. `warehouses` picks
 * any subset of them; omitted/empty = all of them.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "inventory");
  if (guard.response) return guard.response;

  const sp = request.nextUrl.searchParams;
  const requested = (sp.get("warehouses") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = Math.min(200, Math.max(10, parseInt(sp.get("limit") || "50", 10)));
  const search = (sp.get("search") || "").trim();

  // ── Which warehouses this admin can see (Admin Users → Warehouse) ─────
  const warehouseRows = await getAdminWarehouses(guard.session);

  if (warehouseRows.length === 0) {
    return NextResponse.json({ warehouses: [], selectedWarehouses: [], items: [], total: 0 });
  }

  const allowed = new Set(warehouseRows.map((w) => w.code));
  const picked = requested.filter((c) => allowed.has(c));
  const selected = picked.length > 0 ? picked : warehouseRows.map((w) => w.code);

  // ── Run the SAP QRM_Inventory by Warehouse query against HANA ───────
  try {
    // Shared with the storefront's live stock mode — see queryHanaInventoryByWarehouse.
    const allRows = await queryHanaInventoryByWarehouse(selected, search);
    const total = allRows.length;

    // Apply pagination in JS (HANA hdb driver doesn't support LIMIT/OFFSET in all cases)
    const offset = (page - 1) * limit;
    const pageItems = allRows.slice(offset, offset + limit);

    // ── Shelf life %: batches of just this page's items, in the selected warehouses ──
    // Read through the Service Layer (SQLQueries), not HANA: the read-only HANA
    // user has no grant on the batch tables (OBTQ/OBTN). One saved query per
    // admin + warehouse, so two admins viewing the same warehouse can't
    // overwrite each other's query text.
    const batchesByRow = new Map<string, { pct: number; qty: number }[]>();
    const sap = getSapClient();
    await Promise.all(selected.map(async (whs) => {
      const codes = [...new Set(pageItems.filter((r) => r.whs_code === whs).map((r) => r.item_code))];
      if (codes.length === 0) return;
      const batchRows = await sap.getLiveBatchStock(whs, codes, `I${guard.session.adminId ?? 0}W${whs}`);
      for (const b of batchRows) {
        const pct = computeBatchShelfLifePct(b.mnf_date, b.exp_date);
        if (pct === null) continue;
        const key = `${b.item_code}|${b.warehouse_code}`;
        const list = batchesByRow.get(key) ?? [];
        list.push({ pct: Math.round(pct * 10) / 10, qty: Number(b.qty) });
        batchesByRow.set(key, list);
      }
    }));

    const items = pageItems.map((r) => {
      const batches = (batchesByRow.get(`${r.item_code}|${r.whs_code}`) ?? []).sort((a, b) => a.pct - b.pct);
      return { ...r, shelf_life_pct: batches.length ? batches[0].pct : null, batches };
    });

    return NextResponse.json({
      warehouses: warehouseRows,
      selectedWarehouses: selected,
      items,
      total,
    });
  } catch (error) {
    console.error("[Inventory] HANA query failed:", error);
    return NextResponse.json(
      { error: "Failed to query inventory from SAP", message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
