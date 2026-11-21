import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getOrderAllowedCustomerGroupCodes, getAllowedBrandCodes } from "@/lib/adminScope";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import {
  queryArAging, summarizeArAging, todayIso, AR_AGING_BUCKETS, AR_AGING_BUCKET_LABELS,
  type ArAgingRow, type ArAgingBucket, type ArAgingCustomerTotal,
} from "@/lib/hana/arAgingQuery";

/**
 * GET /api/admin/ar-aging — SAP "QRM_Q504_AR_Aging2", live from HANA, within
 * the caller's data permissions (role → Channels / Customer Groups levels 1–3
 * on the customer, Brands on each line; Super Admin = config customer groups,
 * all brands).
 *
 *   ?date=YYYY-MM-DD   as-of date ([%0], default today)
 *   ?channel=GT        OCRD.U_CusGrp01 ([%3])
 *   ?brand=D1          profit centre / brand ([%4])
 *   ?account=131100    control account ([%2])
 *   ?card=GTNO1904     → that customer's aging lines (drill-down)
 *   ?format=xlsx       → Excel of what the screen shows: sheet "Customers"
 *                        (also honours ?search= and ?overdueOnly=1) and
 *                        sheet "Lines" for those customers (or just ?card=)
 *
 * Without card / format: per-customer totals + grand totals. The full run
 * (~3–4 s company-wide) is cached for 2 minutes per filter + scope, so
 * opening customers' lines afterwards is instant.
 */
const CACHE_MS = 2 * 60 * 1000;
const g = globalThis as typeof globalThis & { __arAgingCache?: Map<string, { at: number; rows: ArAgingRow[] }> };
const cache: Map<string, { at: number; rows: ArAgingRow[] }> = (g.__arAgingCache ??= new Map());

const clean = (v: string | null, re: RegExp) => (v && re.test(v.trim()) ? v.trim() : "");

/** The customer filter the page applies on top of the server data (search box + "Overdue only"). */
function matchesScreen(c: ArAgingCustomerTotal, search: string, overdueOnly: boolean): boolean {
  if (overdueOnly && c.overdueLines === 0) return false;
  const q = search.toLowerCase();
  return !q || c.custCode.toLowerCase().includes(q) || (c.custName ?? "").toLowerCase().includes(q) || (c.ssName ?? "").toLowerCase().includes(q);
}

const sortCustomers = (list: ArAgingCustomerTotal[]) => list.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);

function excel(
  customers: ArAgingCustomerTotal[], rows: ArAgingRow[],
  meta: { refDate: string; channel: string; brand: string; account: string; search: string; overdueOnly: boolean; scopeBrands: string[] | null; card: string }
): NextResponse {
  const wb = XLSX.utils.book_new();
  const filters = [
    `As of ${meta.refDate}`,
    meta.channel && `Channel ${meta.channel}`, meta.brand && `Brand ${meta.brand}`, meta.account && `Control account ${meta.account}`,
    meta.search && `Search "${meta.search}"`, meta.overdueOnly && "Overdue only", meta.card && `Customer ${meta.card}`,
    meta.scopeBrands && `Your brands: ${meta.scopeBrands.join(", ")}`,
  ].filter(Boolean).join(" · ");

  // Sheet 1 — the customer table, same columns as the screen.
  const head = ["Customer code", "Customer", "Salesman", "Credit limit", "Balance", ...AR_AGING_BUCKETS.map((b) => AR_AGING_BUCKET_LABELS[b]), "Oldest overdue (days)", "Lines"];
  const body = customers.map((c) => [
    c.custCode, c.custName ?? "", c.ssName ?? "", c.creditLimit || null, c.balance,
    ...AR_AGING_BUCKETS.map((b) => c.buckets[b]), c.overdueLines ? c.maxAge : null, c.lines,
  ]);
  const totals = ["Total", `${customers.length} customers`, "", null, customers.reduce((s, c) => s + c.balance, 0),
    ...AR_AGING_BUCKETS.map((b) => customers.reduce((s, c) => s + c.buckets[b], 0)), null, customers.reduce((s, c) => s + c.lines, 0)];
  const ws1 = XLSX.utils.aoa_to_sheet([["AR Aging (SAP QRM_Q504_AR_Aging2)"], [filters], [], head, ...body, totals]);
  ws1["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 32 }, { wch: 14 }, { wch: 16 }, ...AR_AGING_BUCKETS.map(() => ({ wch: 14 })), { wch: 12 }, { wch: 7 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Customers");

  // Sheet 2 — the lines (what opening a customer shows), oldest first per customer.
  const order = new Map(customers.map((c, i) => [c.custCode, i]));
  const lines = rows
    .filter((r) => order.has(r.custCode))
    .sort((a, b) => order.get(a.custCode)! - order.get(b.custCode)! || (b.ages ?? -99999) - (a.ages ?? -99999));
  const lineHead = ["Customer code", "Customer", "Type", "Doc no", "Invoice no", "SO no", "Reference no", "Inv. date", "Due date",
    "Age (days)", "Amount", "Not reconciled", ...AR_AGING_BUCKETS.map((b) => AR_AGING_BUCKET_LABELS[b]), "Brand", "Salesman", "Control account", "Notes", "Notes (additional)"];
  const lineBody = lines.map((r) => [
    r.custCode, r.custName ?? "", r.docType, r.docNo ?? r.docNum ?? "", r.invNo ?? "", r.soNo ?? "", r.referenceNo ?? "",
    r.invDate ?? "", r.dueDate ?? "", r.ages, r.invAmt, r.invBal, ...AR_AGING_BUCKETS.map((b) => r[b] || null),
    r.brCode ?? "", r.ssName ?? "", r.controlAccount ?? "", r.notes ?? "", r.addlNotes ?? "",
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([lineHead, ...lineBody]);
  ws2["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 16 }, { wch: 15 }, { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 11 }, { wch: 11 },
    { wch: 9 }, { wch: 15 }, { wch: 15 }, ...AR_AGING_BUCKETS.map(() => ({ wch: 13 })), { wch: 7 }, { wch: 30 }, { wch: 12 }, { wch: 40 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Lines");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="AR_Aging_${meta.refDate}${meta.card ? `_${meta.card}` : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "ar-aging");
  if (guard.response) return guard.response;
  const sp = request.nextUrl.searchParams;
  const refDate = clean(sp.get("date"), /^\d{4}-\d{2}-\d{2}$/) || todayIso();
  const channel = clean(sp.get("channel"), /^[\w.-]{1,50}$/);
  const brand = clean(sp.get("brand"), /^[\w.-]{1,50}$/);
  const account = clean(sp.get("account"), /^[\w.-]{1,50}$/);
  const card = clean(sp.get("card"), /^[\w.-]{1,50}$/);
  const search = (sp.get("search") || "").trim().slice(0, 100);
  const overdueOnly = sp.get("overdueOnly") === "1";
  const format = sp.get("format");

  try {
    // Data permissions: customers by Channels / Customer Groups (levels 1–3), lines by Brands.
    const scope = await getOrderAllowedCustomerGroupCodes(guard.session);
    const brandScope = getAllowedBrandCodes(guard.session);
    const t0 = Date.now();
    const key = JSON.stringify([refDate, channel, brand, account, [...scope].sort(), brandScope === null ? "*" : [...brandScope].sort()]);
    const opts = { refDate, cusGrp01: channel, prodBrand: brand, acctCode: account, scopeGroupCodes: scope, scopeBrandCodes: brandScope };

    // One customer: from the cached full run when there is one, else its own (fast) run.
    if (card && format !== "xlsx") {
      const hit = cache.get(key);
      const rows = hit && Date.now() - hit.at < CACHE_MS
        ? hit.rows.filter((r) => r.custCode === card)
        : await queryArAging({ ...opts, cardCodes: [card] });
      return NextResponse.json({ asOf: refDate, card, lines: rows, ms: Date.now() - t0 });
    }

    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      hit = { at: Date.now(), rows: await queryArAging(opts) };
      cache.set(key, hit);
      for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k);
    }
    const rows = hit.rows;
    const customers = sortCustomers(summarizeArAging(rows));
    const scopeBrands = brandScope === null ? null : [...brandScope].sort();

    if (format === "xlsx") {
      const shown = card ? customers.filter((c) => c.custCode === card) : customers.filter((c) => matchesScreen(c, search, overdueOnly));
      return excel(shown, rows, { refDate, channel, brand, account, search: card ? "" : search, overdueOnly: !card && overdueOnly, scopeBrands, card });
    }

    const buckets = Object.fromEntries(AR_AGING_BUCKETS.map((b) => [b, 0])) as Record<ArAgingBucket, number>;
    let balance = 0, overdue = 0;
    for (const c of customers) {
      balance += c.balance;
      overdue += c.overdue;
      for (const b of AR_AGING_BUCKETS) buckets[b] += c.buckets[b];
    }

    // Filter choices: the caller's channels (level-1 groups in scope) and brands (cost centres, dimension 1, in scope).
    const companyId = getCompanyId();
    const [channels, brands] = await Promise.all([
      query<{ code: string; name: string | null }[]>(
        `SELECT code, name FROM customer_groups WHERE company_id = ? AND level = 1 ORDER BY code`, [companyId]
      ),
      query<{ code: string; name: string | null }[]>(
        `SELECT ocr_code AS code, MAX(ocr_name) AS name FROM cost_centers WHERE company_id = ? AND dimension = 1 GROUP BY ocr_code ORDER BY ocr_code`, [companyId]
      ).catch(() => []),
    ]);

    return NextResponse.json({
      asOf: refDate,
      cachedAt: new Date(hit.at).toISOString(),
      totals: {
        customers: customers.length, lines: rows.length, balance, overdue, buckets,
        overdueCustomers: customers.filter((c) => c.overdueLines > 0).length,
      },
      customers,
      options: {
        channels: channels.filter((c) => scope.has(c.code)),
        brands: brandScope === null ? brands : brands.filter((b) => brandScope.has(b.code)),
      },
      scope: { brands: scopeBrands },
      ms: Date.now() - t0,
    });
  } catch (error) {
    console.error("[AR Aging] Query failed:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `AR aging query failed: ${msg.slice(0, 300)}` }, { status: 500 });
  }
}
