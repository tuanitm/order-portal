import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getConfigItemGroupCodes } from "@/lib/adminScope";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { querySalesDetail, SALES_DETAIL_COLUMNS, SALES_DETAIL_NUMERIC, type SalesDetailRow, salesDetailScope } from "@/lib/hana/salesDetailQuery";

/**
 * GET /api/admin/sales-detail — SAP "Q202. Sales Details" (procedure
 * BTS_QRM_FIN_GROSSPROFIT_DETAIL), live from HANA.
 *
 * Always limited to config.json's channels (masterdata.customerGroup) and
 * brands = level-1 product groups (masterdata.itemGroup) — "All" means all of
 * those. Everyone but System Admin is further limited by their role's data
 * permissions: Channels / Customer Groups, Product Groups, Brands, and
 * Warehouses when the role has any (see salesDetailScope).
 *
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   bill date range ([%0] / [%1]; at most 92 days)
 *   ?grp1= ?grp2= ?grp3=             OCRD.U_CusGrp01/02/03 ([%2]..[%4])
 *   ?brand=D1                        brand = level-1 product group (config itemGroup)
 *   ?card=GTNO1904                   customer ([%6])
 *   ?format=xlsx                     → every row and every column of the query, as Excel
 *
 * JSON: totals, per-brand totals and the first MAX_ROWS lines (the Excel has all).
 * A run is cached for 2 minutes per filter + scope.
 */
const MAX_DAYS = 92;
const MAX_ROWS = 3000;
const CACHE_MS = 2 * 60 * 1000;
const g = globalThis as typeof globalThis & { __salesDetailCache?: Map<string, { at: number; rows: SalesDetailRow[] }> };
const cache: Map<string, { at: number; rows: SalesDetailRow[] }> = (g.__salesDetailCache ??= new Map());

const clean = (v: string | null, re: RegExp) => (v && re.test(v.trim()) ? v.trim() : "");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "sales-detail");
  if (guard.response) return guard.response;
  const sp = request.nextUrl.searchParams;
  const now = new Date();
  const from = clean(sp.get("from"), /^\d{4}-\d{2}-\d{2}$/) || iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = clean(sp.get("to"), /^\d{4}-\d{2}-\d{2}$/) || iso(now);
  if (from > to) return NextResponse.json({ error: "From date is after To date" }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_DAYS) {
    return NextResponse.json({ error: `Choose at most ${MAX_DAYS} days (for longer periods, export month by month)` }, { status: 400 });
  }
  const code = /^[\w.-]{1,50}$/;
  const grp1 = clean(sp.get("grp1"), code), grp2 = clean(sp.get("grp2"), code), grp3 = clean(sp.get("grp3"), code);
  const brand = clean(sp.get("brand"), code), card = clean(sp.get("card"), code);
  const format = sp.get("format");

  try {
    const scope = await salesDetailScope(guard.session);
    const t0 = Date.now();
    const list = (x: Set<string> | null) => (x === null ? "*" : [...x].sort());
    const key = JSON.stringify([from, to, grp1, grp2, grp3, brand, card, ...Object.values(scope).map(list)]);
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      hit = {
        at: Date.now(),
        rows: await querySalesDetail({
          fromDate: from, toDate: to, cusGrp01: grp1, cusGrp02: grp2, cusGrp03: grp3, productGroup: brand, cardCode: card, scope,
        }),
      };
      cache.set(key, hit);
      for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k);
    }
    const rows = hit.rows;

    if (format === "xlsx") {
      const filters = [`Bill date ${from} → ${to}`, grp1 && `Channel ${grp1}`, grp2 && `Group 2 ${grp2}`, grp3 && `Group 3 ${grp3}`,
        brand && `Brand ${brand}`, card && `Customer ${card}`, !guard.session.isSuperAdmin && "Limited to your data permissions"].filter(Boolean).join(" · ");
      const head = SALES_DETAIL_COLUMNS.map(([, l]) => l);
      const body = rows.map((r) => SALES_DETAIL_COLUMNS.map(([k]) => r[k] ?? null));
      const ws = XLSX.utils.aoa_to_sheet([["Q202. Sales Details (SAP)"], [filters], [], head, ...body]);
      ws["!cols"] = SALES_DETAIL_COLUMNS.map(([k]) => ({ wch: SALES_DETAIL_NUMERIC.has(k) ? 13 : /Name|Customer|Remarks|Notes|Addr/.test(k) ? 30 : 14 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sales Details");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="Sales_Detail_${from}_${to}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const byBrand = new Map<string, { brand: string; name: string | null; lines: number; qtySale: number; qtyPromo: number; salesAmt: number; focAmt: number }>();
    const customers = new Set<string>();
    const docs = new Set<string>();
    let salesAmt = 0, qtySale = 0, qtyPromo = 0, focAmt = 0;
    for (const r of rows) {
      const b = String(r.BrandCode ?? "—");
      const e = byBrand.get(b) ?? { brand: b, name: (r.BrandName as string | null) ?? null, lines: 0, qtySale: 0, qtyPromo: 0, salesAmt: 0, focAmt: 0 };
      e.lines++; e.qtySale += n(r.QtySale); e.qtyPromo += n(r.QtyPromo); e.salesAmt += n(r.SalesAmt); e.focAmt += n(r.FOCAmt);
      byBrand.set(b, e);
      salesAmt += n(r.SalesAmt); qtySale += n(r.QtySale); qtyPromo += n(r.QtyPromo); focAmt += n(r.FOCAmt);
      if (r.CustCode) customers.add(String(r.CustCode));
      if (r["Doc Internal"]) docs.add(String(r["Doc Internal"]));
    }

    // Filter choices: only what this user may see — customer groups levels 1–3 under config's channels (∩ role),
    // brands = config's level-1 product groups (∩ role Product Groups), in config order.
    const companyId = getCompanyId();
    const [groups, itemGroups] = await Promise.all([
      query<{ level: number; code: string; name: string | null }[]>(`SELECT level, code, name FROM customer_groups WHERE company_id = ? AND level IN (1, 2, 3) ORDER BY level, code`, [companyId]),
      query<{ code: string; name: string | null }[]>(`SELECT code, name FROM item_groups WHERE company_id = ? AND level = 1`, [companyId]),
    ]);
    const inScope = <T extends { code: string }>(l: T[]) => l.filter((x) => scope.customerGroupCodes?.has(x.code) ?? true);
    const brandOptions = getConfigItemGroupCodes()
      .filter((c) => !scope.productGroupCodes || scope.productGroupCodes.has(c))
      .map((code) => ({ code, name: itemGroups.find((g) => g.code === code)?.name ?? null }));

    return NextResponse.json({
      from, to, cachedAt: new Date(hit.at).toISOString(), ms: Date.now() - t0,
      totals: { lines: rows.length, docs: docs.size, customers: customers.size, salesAmt, qtySale, qtyPromo, focAmt },
      brands: [...byBrand.values()].sort((a, b) => b.salesAmt - a.salesAmt),
      columns: SALES_DETAIL_COLUMNS.map(([key, label]) => ({ key, label, numeric: SALES_DETAIL_NUMERIC.has(key) })),
      rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS, maxRows: MAX_ROWS,
      options: {
        grp1: inScope(groups.filter((x) => x.level === 1)), grp2: inScope(groups.filter((x) => x.level === 2)), grp3: inScope(groups.filter((x) => x.level === 3)),
        brands: brandOptions,
      },
      scope: { limited: !guard.session.isSuperAdmin, brands: brandOptions.map((b) => b.code), channels: inScope(groups.filter((x) => x.level === 1)).map((x) => x.code) },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Sales Detail] Failed:", msg);
    if (/insufficient privilege/i.test(msg)) {
      return NextResponse.json({ error: "The portal's SAP HANA user can't run the Q202 procedure yet — ask the DBA to GRANT EXECUTE ON BTS_QRM_FIN_GROSSPROFIT_DETAIL to it." }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to load Sales Details from SAP" }, { status: 500 });
  }
}
