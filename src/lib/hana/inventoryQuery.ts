import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { loadConfig } from "@/lib/config";

/** One item × warehouse row of SAP's "QRM_Inventory by Warehouse" query. */
export interface HanaInventoryRow {
  whs_code: string;
  whs_name: string;
  item_code: string;
  item_name: string | null;
  uom: string | null;
  on_hand: number | string;
  committed: number | string;
  available: number | string;
  /** OITW.OnOrder — informational only (Admin → Warehouses), not part of Available. */
  ordered: number | string;
}

/** config.json masterdata.wareHouse ("'1010','1020'") as plain codes. */
export function configWarehouseCodes(): string[] {
  return loadConfig().masterdata.wareHouse
    .split(",")
    .map((w) => w.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

const sqlString = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * LIVE per-item, per-warehouse stock straight from HANA — SAP's own
 * "QRM_Inventory by Warehouse" query: Committed = open Sales Orders + open
 * Transfer Requests (from that warehouse) + unissued Production Order
 * components; Available = OnHand − Committed. Scoped to config.json's
 * masterdata.itemGroup. Only rows with OnHand or Committed ≠ 0.
 *
 * Shared by Admin → Inventory and BOTH storefront stock options — the
 * scheduled stock sync (syncInventoryStock, option 1) and live stock
 * (src/lib/stock/liveStock.ts, option 2) — so all three show the same
 * numbers. Source: "SAP QRM_Inventory by Warehouse.sql" in the repo root.
 */
export async function queryHanaInventoryByWarehouse(
  warehouseCodes: string[],
  search?: string,
  /**
   * Also keep rows where only OnOrder ≠ 0 (OnHand = Committed = 0) — the
   * scheduled stock sync stores them so Admin → Warehouses still shows the
   * On Order qty; their Available is 0, so the storefront is unaffected.
   * Off (default) = exactly the .sql file's filter, as Admin → Inventory.
   */
  options: {
    includeOnOrderOnly?: boolean;
    /** Just these items, whatever their item group (SO Approval of a Sales Order made in SAP). */
    itemCodes?: string[];
    /** Role Data Permission (Admin → Inventory): only items of these brands (OITM.U_ProdBrand). Omitted = no limit. */
    brandCodes?: string[];
    /** Role Data Permission: only items with one of these codes at any category level (U_ItemCat01..06). Omitted = no limit. */
    itemGroupCodes?: string[];
  } = {}
): Promise<HanaInventoryRow[]> {
  if (warehouseCodes.length === 0) return [];
  if (options.brandCodes?.length === 0 || options.itemGroupCodes?.length === 0) return [];
  const schema = getHanaSchema();
  const itemGroupFilter = loadConfig().masterdata.itemGroup; // e.g. 'D1','L1'
  const whsSql = warehouseCodes.map(sqlString).join(",");

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
        T0."OnHand" - (IFNULL(T4."OpenQty",0) + IFNULL(T5."TRQty",0) + IFNULL(T6."POQty",0)) AS "available",
        T0."OnOrder"   AS "ordered"
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
        AND ${options.itemCodes?.length
          ? `T1."ItemCode" IN (${options.itemCodes.map(sqlString).join(",")})`
          : `(T1."U_ItemCat01" IN (${itemGroupFilter}) OR T1."U_ItemCat02" IN (${itemGroupFilter}))`}
        AND T0."WhsCode" IN (${whsSql})
        ${options.brandCodes ? `AND T1."U_ProdBrand" IN (${options.brandCodes.map(sqlString).join(",")})` : ""}
        ${options.itemGroupCodes ? `AND (${["01", "02", "03", "04", "05", "06"].map((n) => `T1."U_ItemCat${n}" IN (${options.itemGroupCodes!.map(sqlString).join(",")})`).join(" OR ")})` : ""}
    ) X
    WHERE (X."on_hand" <> 0 OR X."committed" <> 0${options.includeOnOrderOnly ? ` OR X."ordered" <> 0` : ""})
      ${search ? `AND (X."item_code" LIKE ${sqlString(`%${search}%`)} OR X."item_name" LIKE ${sqlString(`%${search}%`)})` : ""}
    ORDER BY X."item_code", X."whs_code"
  `;

  return queryHana<HanaInventoryRow>(sql);
}
