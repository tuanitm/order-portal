import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { query } from "@/lib/db/connection";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { loadConfig } from "@/lib/config";
import { getAllowedCustomerGroupCodes } from "@/lib/adminScope";
import type { AdminSession } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/inventory?warehouse=<code>&page=1&limit=50&search=
 *
 * Runs the SAP QRM_Inventory by Warehouse query LIVE against HANA to get
 * OnHand, Committed (Open SO + Transfer Requests + Production Order components),
 * and Available per item per warehouse.
 *
 * Non-root admins only see warehouses mapped to the customer groups they manage
 * (via admin_user_customer_groups → customer_group_warehouses).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "inventory");
  if (guard.response) return guard.response;

  const sp = request.nextUrl.searchParams;
  const warehouseCode = sp.get("warehouse") || "";
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = Math.min(200, Math.max(10, parseInt(sp.get("limit") || "50", 10)));
  const search = (sp.get("search") || "").trim();

  // ── Resolve which warehouses this admin can see ──────────────────────
  const { masterdata } = loadConfig();
  const warehouseRows = await getAdminVisibleWarehouses(guard.session, masterdata.wareHouse);

  if (warehouseRows.length === 0) {
    return NextResponse.json({ warehouses: [], items: [], total: 0 });
  }

  // Auto-select first allowed warehouse if requested one is missing or not allowed
  const targetWarehouse =
    warehouseCode && warehouseRows.some((w) => w.code === warehouseCode)
      ? warehouseCode
      : warehouseRows[0].code;

  // ── Run the SAP QRM_Inventory by Warehouse query against HANA ───────
  try {
    const schema = getHanaSchema();
    const itemGroupFilter = masterdata.itemGroup;   // e.g. 'D1','L1'
    const warehouseFilter = masterdata.wareHouse;    // e.g. '1001','1003',...

    // SAP QRM_Inventory by Warehouse — Committed = Open SO + Transfer Requests + Production Order components
    // Scoped by masterdata.itemGroup (U_ItemCat01/02) and masterdata.wareHouse
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
          AND T0."WhsCode" IN (${warehouseFilter})
      ) X
      WHERE (X."on_hand" <> 0 OR X."committed" <> 0)
        AND X."whs_code" = '${targetWarehouse.replace(/'/g, "''")}'
        ${search ? `AND (X."item_code" LIKE '%${search.replace(/'/g, "''")}%' OR X."item_name" LIKE '%${search.replace(/'/g, "''")}%')` : ""}
      ORDER BY X."item_code"
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

    return NextResponse.json({
      warehouses: warehouseRows,
      selectedWarehouse: targetWarehouse,
      items: pageItems,
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

// ── Helper: get warehouses visible to this admin ───────────────────────

async function getAdminVisibleWarehouses(
  session: AdminSession,
  configWarehouses: string
): Promise<{ code: string; name: string | null }[]> {
  // Superadmin sees all included warehouses that are inside masterdata.wareHouse
  if (session.isSuperAdmin) {
    const rows = await query<{ sap_warehouse_code: string; warehouse_name: string | null }[]>(
      `SELECT sap_warehouse_code, warehouse_name FROM warehouses
       WHERE sap_warehouse_code IN (${configWarehouses}) AND is_included = TRUE
       ORDER BY sap_warehouse_code`
    );
    return rows.map((r) => ({ code: r.sap_warehouse_code, name: r.warehouse_name }));
  }

  // Non-root admin: must have customer groups assigned
  if (!session.adminId) return [];

  const assigned = await query<{ customer_group_id: number }[]>(
    `SELECT customer_group_id FROM admin_user_customer_groups WHERE admin_user_id = ?`,
    [session.adminId]
  );
  if (assigned.length === 0) return [];

  // Load customer group hierarchy to resolve Level 2 codes
  const allGroups = await query<{ id: number; level: number; code: string; parent_code: string | null }[]>(
    `SELECT id, level, code, parent_code FROM customer_groups`
  );

  const assignedIds = new Set(assigned.map((a) => a.customer_group_id));
  const byId = new Map(allGroups.map((g) => [g.id, g]));
  const byCodeAndLevel = new Map(allGroups.map((g) => [`${g.level}:${g.code}`, g]));

  const level2GroupCodes = new Set<string>();
  for (const id of assignedIds) {
    let cur = byId.get(id);
    if (!cur) continue;
    if (cur.level === 2) {
      level2GroupCodes.add(cur.code);
    } else if (cur.level > 2) {
      // Walk up to level 2
      while (cur && cur.level > 2 && cur.parent_code) {
        cur = byCodeAndLevel.get(`${cur.level - 1}:${cur.parent_code}`);
      }
      if (cur && cur.level === 2) {
        level2GroupCodes.add(cur.code);
      }
    } else if (cur.level === 1) {
      // Walk down to level 2
      for (const g of allGroups) {
        if (g.level === 2 && g.parent_code === cur.code) {
          level2GroupCodes.add(g.code);
        }
      }
    }
  }

  if (level2GroupCodes.size === 0) return [];

  // Query customer_group_warehouses scoped to Level 2 groups and masterdata.wareHouse
  const placeholders = [...level2GroupCodes].map(() => "?").join(",");
  const mapped = await query<{ warehouse_code: string; warehouse_name: string | null }[]>(
    `SELECT DISTINCT cgw.warehouse_code, w.warehouse_name
     FROM customer_group_warehouses cgw
     JOIN customer_groups cg ON cg.id = cgw.customer_group_id
     LEFT JOIN warehouses w ON w.sap_warehouse_code = cgw.warehouse_code
     WHERE cg.level = 2
       AND cg.code IN (${placeholders})
       AND cgw.warehouse_code IN (${configWarehouses})
     ORDER BY cgw.warehouse_code`,
    [...level2GroupCodes]
  );

  return mapped.map((m) => ({ code: m.warehouse_code, name: m.warehouse_name }));
}
