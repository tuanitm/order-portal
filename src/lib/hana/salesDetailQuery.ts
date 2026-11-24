import { callHanaProcedure } from "@/lib/hana/client";
import { getAllowedCustomerGroupCodes, getAllowedItemGroupCodes, getAllowedBrandCodes, getConfigCustomerGroupCodes, getConfigItemGroupCodes } from "@/lib/adminScope";
import { getAdminWarehouseCodes } from "@/lib/adminWarehouses";
import type { AdminSession } from "@/lib/auth/adminSession";

/**
 * SAP Query Manager "Q202. Sales Details" (source: "SAP QRM_Q202_Sales_Detail.sql"
 * in the repo root — keep the two in step). The query only calls the SAP
 * procedure BTS_QRM_FIN_GROSSPROFIT_DETAIL and keeps rows with QType S1 / A2,
 * so the portal does the same: one row per sales line (A/R invoice, A/R credit
 * memo, journal entry) with brand, customer, item hierarchy, qty, price,
 * standard / contract / promotion discount, amount, warehouse and salesman.
 *
 * Needs EXECUTE on the procedure for the portal's HANA user
 * (GRANT EXECUTE ON "<schema>"."BTS_QRM_FIN_GROSSPROFIT_DETAIL" TO IMV_REPORT_RO).
 *
 * Portal additions (see SalesDetailScope): only config.json's channels
 * (masterdata.customerGroup) and level-1 product groups (masterdata.itemGroup),
 * and for everyone but System Admin also the role's data permissions —
 * Channels / Customer Groups, Product Groups, Brands and Warehouses. All are
 * applied on the report's own columns (AreaCode1/2/3 = the customer's
 * U_CusGrp01/02/03, verified to match), so customers not synced to the portal
 * are covered too.
 */
export const SALES_DETAIL_PROCEDURE = "BTS_QRM_FIN_GROSSPROFIT_DETAIL";
const REPORT_NAME = "Q202. Sales Details";

/** The query's output columns, in its order: [procedure column, label]. ("AddrName2" is listed twice in the query; once here.) */
export const SALES_DETAIL_COLUMNS: [string, string][] = [
  ["GpType", "Type"], ["BrandCode", "Brand"], ["BrandName", "Brand name"], ["Company", "Company"], ["Company Name", "Company name"],
  ["CatName1", "Category 1"], ["CatCode2", "Category 2"], ["DeptCode", "Dept"], ["DeptName", "Dept name"],
  ["AreaCode1", "Area 1"], ["AreaName1", "Area 1 name"], ["AreaCode2", "Area 2"], ["AreaName2", "Area 2 name"], ["AreaCode3", "Area 3"], ["AreaName3", "Area 3 name"],
  ["MidCode", "Mid"], ["MidName", "Mid name"], ["CustCode", "Cust code"], ["Cust NC", "Cust NC"], ["CustName", "Customer"], ["ShortName", "Short name"], ["Buyer", "Buyer"],
  ["BillDate", "Bill date"], ["Doc Internal", "Doc internal"], ["Invoice No", "Invoice no"], ["SINo", "SI no"], ["SONo", "SO no"],
  ["CodeLev1", "Code lev 1"], ["NameLev1", "Name lev 1"], ["CodeLev2", "Code lev 2"], ["NameLev2", "Name lev 2"], ["CodeLev3", "Code lev 3"], ["NameLev3", "Name lev 3"],
  ["CodeLev4", "Code lev 4"], ["NameLev4", "Name lev 4"], ["CodeLev5", "Code lev 5"], ["NameLev5", "Name lev 5"],
  ["InvCode", "Item code"], ["InvCode2", "Item code 2"], ["InvName", "Item name"], ["Unit", "Uom"],
  ["QtySale", "Qty sale"], ["QtyPromo", "Qty promo"], ["BasePrice", "Base price"], ["StdDisc", "STD disc %"], ["CtDisc", "CT disc %"],
  ["PromoCode", "PM code"], ["PromoDisc", "PM disc %"], ["TaxRate", "Tax %"], ["SalesPrice", "Sales price"], ["SalesAmt", "Sales amount"],
  ["WH.Code", "Whs"], ["WH.Name", "Whs name"], ["Remarks", "Remarks"], ["InvNotes", "Notes (Invoice)"], ["Note2", "Note 2"],
  ["SMCode", "Salesman"], ["SMName", "Salesman name"], ["Addrcode", "Address code"], ["AddrName", "Address"], ["AddrName2", "Address 2"],
  ["AreaCode", "Area"], ["AreaName", "Area name"], ["ProvinceCode", "Province"], ["ProvinceName", "Province name"],
  ["Reference No.", "Reference no"], ["CINo", "CI no"], ["FOCPrice", "FOC price"], ["FOCAmt", "FOC amount"], ["Reason", "Reason"],
  ["AccNo", "Acc no"], ["Interco", "Interco"], ["SysType", "Sys type"],
];
export const SALES_DETAIL_NUMERIC = new Set(["QtySale", "QtyPromo", "BasePrice", "StdDisc", "CtDisc", "PromoDisc", "TaxRate", "SalesPrice", "SalesAmt", "FOCPrice", "FOCAmt"]);

export interface SalesDetailOptions {
  /** [%0] / [%1] YYYY-MM-DD. */
  fromDate: string;
  toDate: string;
  /** [%2]..[%4] OCRD.U_CusGrp01/02/03, [%6] customer; "" = all (sent as "*"). */
  cusGrp01?: string; cusGrp02?: string; cusGrp03?: string; cardCode?: string;
  /**
   * Brand filter = a level-1 product group (config.json masterdata.itemGroup,
   * e.g. D1 PIGEON, L1 ETSUKO) — the report's CodeLev1. Applied here, not as the
   * procedure's [%5] (that is U_ProdBrand, e.g. N1 for L1 items).
   */
  productGroup?: string;
  /** Data permission — every rule is "null = no limit", a Set = the line must match it (empty Set = nothing). */
  scope: SalesDetailScope;
}

export interface SalesDetailScope {
  /** Customer groups (any level): the line's AreaCode1/2/3 (= the customer's U_CusGrp01/02/03) must hit one. */
  customerGroupCodes: Set<string> | null;
  /** Level-1 product groups (config masterdata.itemGroup): the line's CodeLev1 (else BrandCode) must be one. */
  level1ProductGroups: Set<string> | null;
  /** The role's Product Groups (any level): the line's CodeLev1..5 must hit one. */
  productGroupCodes: Set<string> | null;
  /** The role's Brands: the line's BrandCode (U_ProdBrand) must be one; lines without a brand pass. */
  brandCodes: Set<string> | null;
  /** The role's Warehouses: the line's WH.Code must be one; lines without a warehouse (journal entries) pass. */
  warehouseCodes: Set<string> | null;
}

const inter = (a: Set<string>, b: Set<string> | null) => (b === null ? a : new Set([...a].filter((x) => b.has(x))));

/** The data limits of one staff member for this report (see SalesDetailScope). */
export async function salesDetailScope(session: AdminSession): Promise<SalesDetailScope> {
  const configGroups = await getConfigCustomerGroupCodes();
  const configBrands = new Set(getConfigItemGroupCodes());
  if (session.isSuperAdmin) {
    // System Admin: config's brandList (null only when none is configured).
    return { customerGroupCodes: configGroups, level1ProductGroups: configBrands, productGroupCodes: null, brandCodes: getAllowedBrandCodes(session), warehouseCodes: null };
  }
  const [groups, itemGroups, warehouses] = await Promise.all([
    getAllowedCustomerGroupCodes(session), getAllowedItemGroupCodes(session), getAdminWarehouseCodes(session),
  ]);
  return {
    customerGroupCodes: inter(configGroups, groups ?? new Set()),
    level1ProductGroups: configBrands,
    productGroupCodes: itemGroups ?? new Set(),
    brandCodes: getAllowedBrandCodes(session) ?? new Set(),
    // Warehouses are optional on a role: only a role that has some is limited to them.
    warehouseCodes: session.scope.warehouses.length ? new Set(warehouses) : null,
  };
}

export type SalesDetailRow = Record<string, string | number | null>;

const clean = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "number" ? v : String(v);
};

export async function querySalesDetail(o: SalesDetailOptions): Promise<SalesDetailRow[]> {
  // "*" = all, as in Query Manager — an empty filter matches NOTHING in the procedure (verified 2026-11-24).
  const all = (v: string | undefined) => (v && v.trim() ? v.trim() : "*");
  const raw = await callHanaProcedure(SALES_DETAIL_PROCEDURE, [
    o.fromDate, o.toDate, all(o.cusGrp01), all(o.cusGrp02), all(o.cusGrp03), "*", all(o.cardCode),
    // pGpType "" = AR + ARC + JE; pUserID must be numeric or "" ($[USER] in Query Manager — no effect on rows seen); pReportName.
    "", "", REPORT_NAME,
  ]);
  const sc = o.scope;
  const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  const level1 = (r: Record<string, unknown>) => str(r.CodeLev1) ?? str(r.BrandCode);
  const keep = (r: Record<string, unknown>) =>
    (!o.productGroup || level1(r) === o.productGroup)
    && (!sc.customerGroupCodes || [r.AreaCode1, r.AreaCode2, r.AreaCode3].some((g) => str(g) && sc.customerGroupCodes!.has(String(g))))
    && (!sc.level1ProductGroups || (level1(r) !== null && sc.level1ProductGroups.has(level1(r)!)))
    && (!sc.productGroupCodes || [r.CodeLev1, r.CodeLev2, r.CodeLev3, r.CodeLev4, r.CodeLev5].some((g) => str(g) && sc.productGroupCodes!.has(String(g))))
    && (!sc.brandCodes || !str(r.BrandCode) || sc.brandCodes.has(String(r.BrandCode)))
    && (!sc.warehouseCodes || !str(r["WH.Code"]) || sc.warehouseCodes.has(String(r["WH.Code"])));
  const rows: SalesDetailRow[] = raw
    .filter((r) => ["S1", "A2"].includes(String(r.QType ?? "")) && keep(r))
    .map((r) => {
      const out: SalesDetailRow = {};
      for (const [k] of SALES_DETAIL_COLUMNS) {
        const v = clean(r[k]);
        out[k] = SALES_DETAIL_NUMERIC.has(k) && v !== null ? Number(v) : v;
      }
      return out;
    });
  // BillDate comes back as text "dd/MM/yyyy" — sort on yyyyMMdd, then Doc Internal (the query's ORDER BY).
  const ymd = (v: unknown) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? "")); return m ? `${m[3]}${m[2]}${m[1]}` : String(v ?? ""); };
  rows.sort((a, b) => ymd(a.BillDate).localeCompare(ymd(b.BillDate)) || String(a["Doc Internal"] ?? "").localeCompare(String(b["Doc Internal"] ?? "")));
  return rows;
}
