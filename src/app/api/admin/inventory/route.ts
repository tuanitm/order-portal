import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { loadConfig } from "@/lib/config";
import { getAdminWarehouses } from "@/lib/adminWarehouses";
import { computeBatchShelfLifePct } from "@/lib/sap-b1/sync";
import { getSapClient } from "@/lib/sap-b1/client";

const sqlString = (v: string) => `'${v.replace(/'/g, "''")}'`;

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
  const selectedSql = selected.map(sqlString).join(",");

  // ── Run the SAP QRM_Inventory by Warehouse query against HANA ───────
  try {
    const schema = getHanaSchema();
    const itemGroupFilter = loadConfig().masterdata.itemGroup;   // e.g. 'D1','L1'

    // SAP QRM_Inventory by Warehouse — Committed = Open SO + Transfer Requests + Production Order components
    const sql = `
      SELECT *
      FROM (
        SELECT
          T3."WhsCode"  AS "whs_code",
          T3."WhsName"  AS "whs_name",
          T1."ItemCode"  AS "item_code",
          T1."ItemName"  AS "item_name",
          T1."InvntryUom" AS "uom",
          T0."OnHand"    AS "on_hand",
          IFNULL(T4."OpenQty",0) + IFNULL(T5."TRQty",0) + IFNULL(T6."POQty",0) AS "committed",
          T0."OnHand" - (IFNULL(T4."OpenQty",0) + IFNULL(T5."TRQty",0) + IFNULL(T6."POQty",0)) AS "available"
        FROM "${schema}"."OITW" T0
        JOIN "${schema}"."OITM" T1 ON T0."ItemCode" = T1."ItemCode"
        JOIN "${schema}"."OITB" T2 ON T1."ItmsGrpCod" = T2."ItmsGrpCod"
        JOIN "${schema}"."OWHS" T3 ON T0."WhsCode" = T3."WhsCode"
        LEFT JOIN (
          -- Open Sales Orders
          SELECT
            l."ItemCode",
            l."WhsCode",
            SUM(l."OpenQty") AS "OpenQty"
          FROM "${schema}"."RDR1" l
          INNER JOIN "${schema}"."ORDR" h ON h."DocEntry" = l."DocEntry"
          WHERE h."DocStatus" = 'O' AND h."CANCELED" = 'N'
          GROUP BY l."ItemCode", l."WhsCode"
        ) T4 ON T0."ItemCode" = T4."ItemCode" AND T0."WhsCode" = T4."WhsCode"
        LEFT JOIN (
          -- Transfer Requests
          SELECT t1."ItemCode",
                 t1."FromWhsCod" AS "WhsCode",
                 SUM(t1."OpenQty") AS "TRQty"
          FROM "${schema}"."OWTQ" t0
          JOIN "${schema}"."WTQ1" t1 ON t0."DocEntry" = t1."DocEntry"
          WHERE t0."DocStatus" = 'O'
          GROUP BY t1."ItemCode", t1."FromWhsCod"
        ) T5 ON T0."ItemCode" = T5."ItemCode" AND T0."WhsCode" = T5."WhsCode"
        LEFT JOIN (
          -- Production Order components
          SELECT t1."ItemCode",
                 t1."wareHouse" AS "WhsCode",
                 SUM(GREATEST(t1."PlannedQty" - t1."IssuedQty", 0)) AS "POQty"
          FROM "${schema}"."OWOR" t0
          JOIN "${schema}"."WOR1" t1 ON t0."DocEntry" = t1."DocEntry"
          WHERE t0."Status" IN ('P','R')
          GROUP BY t1."ItemCode", t1."wareHouse"
        ) T6 ON T0."ItemCode" = T6."ItemCode" AND T0."WhsCode" = T6."WhsCode"
        WHERE T1."InvntItem" = 'Y'
          AND (T1."U_ItemCat01" IN (${itemGroupFilter}) OR T1."U_ItemCat02" IN (${itemGroupFilter}))
          AND T0."WhsCode" IN (${selectedSql})
      ) X
      WHERE (X."on_hand" <> 0 OR X."committed" <> 0)
        ${search ? `AND (X."item_code" LIKE ${sqlString(`%${search}%`)} OR X."item_name" LIKE ${sqlString(`%${search}%`)})` : ""}
      ORDER BY X."item_code", X."whs_code"
    `;

    interface HanaRow {
      whs_code: string;
      whs_name: string;
      item_code: string;
      item_name: string | null;
      uom: string | null;
      on_hand: number;
      committed: number;
      available: number;
    }

    const allRows = await queryHana<HanaRow>(sql);
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
