import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryHanaInventoryByWarehouse } from "@/lib/hana/inventoryQuery";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { getAdminWarehouses } from "@/lib/adminWarehouses";
import { computeBatchShelfLifePct, parseSapBatchDate, todayUtcVN } from "@/lib/sap-b1/sync";
import { getSapClient } from "@/lib/sap-b1/client";

/** One batch (one bin of it, in a bin-managed warehouse) — the "By batch" view = report R403's columns. */
interface InventoryBatch {
  batch: string | null;
  lot: string | null;
  bin: string | null;
  binName: string | null;
  /** YYYY-MM-DD */
  mnfDate: string | null;
  expDate: string | null;
  /** Remaining shelf life %, 1 decimal (null = no dates). */
  pct: number | null;
  qty: number;
  /** NORMAL (> 50%) / CẬN DATE (≤ 50%) / HẾT HẠN (expired). */
  status: string;
  /** Remaining shelf life bucket (months): expired / 0-3 / 3-6 / 6-9 / 9-12 / 12+ (null = no expiry date). */
  bucket: Bucket | null;
}
type Bucket = "expired" | "0-3" | "3-6" | "6-9" | "9-12" | "12+";
const BUCKETS: Bucket[] = ["expired", "0-3", "3-6", "6-9", "9-12", "12+"];

/** Shelf life ≤ this % = "CẬN DATE" — same cut as SAP query Q688 (> 50% = NORMAL). */
const NEAR_DATE_PCT = 50;

const ymd = (s: string | null) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/** today + n calendar months (UTC midnight), like HANA ADD_MONTHS. */
function addMonths(ts: number, n: number): number {
  const d = new Date(ts);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay));
}

function bucketOf(expDate: string | null, today: number): Bucket | null {
  const exp = parseSapBatchDate(expDate);
  if (exp === null) return null;
  if (exp < today) return "expired";
  if (exp <= addMonths(today, 3)) return "0-3";
  if (exp <= addMonths(today, 6)) return "3-6";
  if (exp <= addMonths(today, 9)) return "6-9";
  if (exp <= addMonths(today, 12)) return "9-12";
  return "12+";
}

/** Item Group (OITB, without the "[G21]. " prefix) and Item Category 1 name, from HANA. */
async function itemInfo(codes: string[]): Promise<Map<string, { itemGroup: string | null; itemCat1: string | null }>> {
  const out = new Map<string, { itemGroup: string | null; itemCat1: string | null }>();
  if (codes.length === 0) return out;
  const S = `"${getHanaSchema()}"`;
  const CHUNK = 500;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const list = codes.slice(i, i + CHUNK).map((c) => `'${c.replace(/'/g, "''")}'`).join(",");
    const rows = await queryHana<{ code: string; grp: string | null; cat1: string | null }>(
      `SELECT I."ItemCode" AS "code", G."ItmsGrpNam" AS "grp", C1."Name" AS "cat1"
       FROM ${S}."OITM" I
       LEFT JOIN ${S}."OITB" G ON G."ItmsGrpCod" = I."ItmsGrpCod"
       LEFT JOIN ${S}."@MDM_ID_ITEMCAT01" C1 ON C1."Code" = I."U_ItemCat01"
       WHERE I."ItemCode" IN (${list})`
    );
    for (const r of rows) out.set(r.code, { itemGroup: r.grp ? r.grp.replace(/^\[[^\]]*\]\.\s*/, "") : null, itemCat1: r.cat1 });
  }
  return out;
}

/**
 * GET /api/admin/inventory?warehouses=1001,1003&page=1&limit=50&search=
 *
 * Runs the SAP QRM_Inventory by Warehouse query LIVE against HANA to get
 * OnHand, Committed (Open SO + Transfer Requests + Production Order components)
 * and Available per item per warehouse, plus every batch of the row
 * (report R403 columns: Sys. Batch, Lot No., bin, dates, remaining shelf
 * life %, lot status, month bucket) for the "By batch" view.
 *
 * Warehouses offered: this admin's warehouses (Admin Users → Warehouse; root =
 * every masterdata.wareHouse warehouse — see getAdminWarehouseCodes). Warehouse
 * Visibility doesn't apply here — it's the customers' rule. `warehouses` picks
 * any subset of them; omitted/empty = all of them.
 *
 * ?format=xlsx → Excel of every row the screen's filters match (all pages);
 * &view=batch → in the R403 layout (one row per batch).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "inventory");
  if (guard.response) return guard.response;

  const sp = request.nextUrl.searchParams;
  const requested = (sp.get("warehouses") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = Math.min(200, Math.max(10, parseInt(sp.get("limit") || "50", 10)));
  const search = (sp.get("search") || "").trim();
  const asExcel = sp.get("format") === "xlsx";
  const batchView = sp.get("view") === "batch";

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

    // Apply pagination in JS (HANA hdb driver doesn't support LIMIT/OFFSET in all cases).
    // Excel export = every matching row.
    const offset = (page - 1) * limit;
    const pageItems = asExcel ? allRows : allRows.slice(offset, offset + limit);

    // ── Batches of just this page's items, in the selected warehouses ──
    // Read through the Service Layer (SQLQueries), not HANA: the read-only HANA
    // user has no grant on the batch tables (OBTQ/OBTN/OBBQ). One saved query per
    // admin (+ chunk), so two admins can't overwrite each other's query text.
    const today = todayUtcVN();
    const batchesByRow = new Map<string, InventoryBatch[]>();
    const sap = getSapClient();
    const codes = [...new Set(pageItems.map((r) => r.item_code))];
    const CHUNK = 150;
    const chunks: string[][] = [];
    for (let i = 0; i < codes.length; i += CHUNK) chunks.push(codes.slice(i, i + CHUNK));
    const [batchRows, info] = await Promise.all([
      (async () => {
        const out = [];
        for (let i = 0; i < chunks.length; i++) {
          const suffix = asExcel ? `X${guard.session.adminId ?? 0}C${i}` : `I${guard.session.adminId ?? 0}`;
          out.push(...(await sap.getLiveBatchDetail(selected, chunks[i], suffix)));
        }
        return out;
      })(),
      itemInfo(codes).catch((e) => {
        console.warn("[Inventory] item group / category names:", e instanceof Error ? e.message : e);
        return new Map<string, { itemGroup: string | null; itemCat1: string | null }>();
      }),
    ]);
    for (const b of batchRows) {
      const raw = computeBatchShelfLifePct(b.mnf_date, b.exp_date);
      const pct = raw === null ? null : Math.round(raw * 10) / 10;
      const bucket = bucketOf(b.exp_date, today);
      const status = bucket === "expired" ? "HẾT HẠN" : pct !== null && pct <= NEAR_DATE_PCT ? "CẬN DATE" : "NORMAL";
      const key = `${b.item_code}|${b.warehouse_code}`;
      const list = batchesByRow.get(key) ?? [];
      list.push({
        batch: b.batch_no, lot: b.lot_no, bin: b.bin_code, binName: b.bin_name,
        mnfDate: ymd(b.mnf_date), expDate: ymd(b.exp_date), pct, qty: Number(b.qty), status, bucket,
      });
      batchesByRow.set(key, list);
    }

    const items = pageItems.map((r) => {
      // Lowest shelf life first (no dates last), then batch number.
      const batches = (batchesByRow.get(`${r.item_code}|${r.whs_code}`) ?? [])
        .sort((a, b) => (a.pct ?? 1e9) - (b.pct ?? 1e9) || String(a.batch).localeCompare(String(b.batch)));
      const dated = batches.filter((b) => b.pct !== null);
      const meta = info.get(r.item_code);
      return {
        ...r,
        item_group: meta?.itemGroup ?? null,
        item_cat1: meta?.itemCat1 ?? null,
        shelf_life_pct: dated.length ? dated[0].pct : null,
        batches,
      };
    });

    if (asExcel) return batchView ? r403Excel(items, warehouseRows, selected, search) : inventoryExcel(items, warehouseRows, selected, search);

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

type ExcelItem = {
  whs_code: string; whs_name: string | null; item_code: string; item_name: string | null; uom: string | null;
  item_group: string | null; item_cat1: string | null;
  on_hand: number | string; committed: number | string; available: number | string; shelf_life_pct: number | null; batches: InventoryBatch[];
};

function filtersLine(warehouses: { code: string; name: string | null }[], selected: string[], search: string) {
  return [
    `Warehouses: ${selected.length === warehouses.length ? `all (${selected.join(", ")})` : selected.join(", ")}`,
    search && `Search "${search}"`,
    `Exported ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh" })}`,
  ].filter(Boolean).join(" · ");
}

function xlsxResponse(ws: XLSX.WorkSheet, sheet: string, file: string): NextResponse {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}_${day}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Same columns as Admin → Inventory's table (+ every batch), for all matching rows. */
function inventoryExcel(items: ExcelItem[], warehouses: { code: string; name: string | null }[], selected: string[], search: string): NextResponse {
  const whsName = new Map(warehouses.map((w) => [w.code, w.name]));
  const head = ["#", "Item Code", "Item Name", "Warehouse", "Warehouse name", "UoM", "Shelf life % (lowest batch)", "OnHand", "Committed", "Available", "Batches (shelf life % × qty)"];
  const body = items.map((r, i) => [
    i + 1, r.item_code, r.item_name ?? "", r.whs_code, r.whs_name ?? whsName.get(r.whs_code) ?? "", r.uom ?? "",
    r.shelf_life_pct, Number(r.on_hand), Number(r.committed), Number(r.available),
    r.batches.map((b) => `${b.pct ?? "—"}% × ${b.qty}`).join("; "),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([["Inventory (SAP QRM_Inventory by Warehouse)"], [filtersLine(warehouses, selected, search)], [], head, ...body]);
  ws["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 48 }, { wch: 10 }, { wch: 24 }, { wch: 7 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 50 }];
  return xlsxResponse(ws, "Inventory", "Inventory");
}

/** Report R403 "Inventory by Remaining Shelf Life" layout: one row per batch (per bin). */
function r403Excel(items: ExcelItem[], warehouses: { code: string; name: string | null }[], selected: string[], search: string): NextResponse {
  const whsName = new Map(warehouses.map((w) => [w.code, w.name]));
  const head = ["#", "Warehouse", "Warehouse Name", "Bin Location", "Bin Location Name", "Item Group", "Item Category 1", "Item No.", "Item Description", "UoM",
    "Sys. Batch", "Lot No.", "Mfg. Date", "Exp. Date", "Rem. Shelf Life (%)", "Lot Status", "In-Stock", "Expired", "0 - 3", "3 - 6", "6 - 9", "9 - 12", "12+"];
  const dt = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : "");
  const body: unknown[][] = [];
  for (const r of items) {
    const rows = r.batches.length ? r.batches : [null];
    for (const b of rows) {
      const qty = b ? b.qty : Number(r.on_hand);
      body.push([
        body.length + 1, r.whs_code, r.whs_name ?? whsName.get(r.whs_code) ?? "", b?.bin ?? "", b?.binName ?? "", r.item_group ?? "", r.item_cat1 ?? "",
        r.item_code, r.item_name ?? "", r.uom ?? "", b?.batch ?? "", b?.lot ?? "", dt(b?.mnfDate ?? null), dt(b?.expDate ?? null),
        b?.pct == null ? "" : b.pct / 100, b?.status ?? "", qty,
        ...BUCKETS.map((k) => (b?.bucket === k ? qty : 0)),
      ]);
    }
  }
  const today = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Ho_Chi_Minh" });
  const ws = XLSX.utils.aoa_to_sheet([
    ["INVENTORY BY REMAINING SHELF LIFE REPORT"],
    [`To Date: ${today}`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Remaining Shelf Life (Months)"],
    [filtersLine(warehouses, selected, search)],
    head, ...body,
  ], { cellDates: true });
  // Dates dd/mm/yyyy, shelf life as %.
  for (let i = 0; i < body.length; i++) {
    const row = 5 + i; // 1-based Excel row (4 header rows above)
    for (const col of ["M", "N"]) { const c = ws[`${col}${row}`]; if (c && c.t === "d") c.z = "dd/mm/yyyy"; }
    const p = ws[`O${row}`]; if (p && p.t === "n") p.z = "0.00%";
  }
  ws["!cols"] = [{ wch: 5 }, { wch: 9 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 13 }, { wch: 44 }, { wch: 6 },
    { wch: 22 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 9 }];
  return xlsxResponse(ws, "R403", "R403_Inventory_by_Remaining_Shelf_Life");
}
