import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getPromotionAllowedGroups, buildPromotionScopeFilter } from "@/lib/adminScope";
import { withTableLocks, TableLockBusyError } from "@/lib/db/tableLock";
import type { AdminSession } from "@/lib/auth/adminSession";

/** Who may set a program's priority: Admin, Accountant, System Admin (not Sales). */
function canEditPromotionPriority(session: AdminSession): boolean {
  return session.isSuperAdmin || session.kind === "admin" || session.kind === "account";
}

/**
 * GET /api/admin/promotions — the cached Promotion Discount rows (SAP
 * "@PM_HEADER" etc., synced straight from HANA — see src/lib/hana/sync.ts),
 * one row per Promotion -> BP/Group -> Item/Group combination. Optional filters:
 * search (promotion_code or promotion_name, partial match), bpCode (partial
 * match against bp_code OR bp_name), itemCode (partial match against
 * selling_item_code OR selling_item_name), activeOnly (begin_date/end_date
 * bracket today), type ("discount_pct" — disc_pct set, or "free_item" —
 * giving_item_code set), validDate (a row is included if this date falls
 * within its own begin_date/end_date window).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "promotions");
  if (guard.response) return guard.response;

  const { customerGroupCodes, itemGroupCodes } = await getPromotionAllowedGroups(guard.session);
  const scopeFilter = await buildPromotionScopeFilter(customerGroupCodes, itemGroupCodes);
  if (scopeFilter.sql === "1=0") {
    return NextResponse.json({ promotions: [], total: 0, page: 1, totalPages: 0 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const bpCode = searchParams.get("bpCode")?.trim();
  const itemCode = searchParams.get("itemCode")?.trim();
  const activeOnly = searchParams.get("activeOnly") === "true";
  const type = searchParams.get("type")?.trim();
  const validDate = searchParams.get("validDate")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = ["company_id = ?"];
  const params: (string | number)[] = [getCompanyId()];

  if (scopeFilter.sql !== "1=1") {
    whereClauses.push(scopeFilter.sql);
    params.push(...scopeFilter.params);
  }
  if (search) {
    whereClauses.push("(promotion_code LIKE ? OR promotion_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (bpCode) {
    whereClauses.push("(bp_code LIKE ? OR bp_name LIKE ?)");
    params.push(`%${bpCode}%`, `%${bpCode}%`);
  }
  if (itemCode) {
    whereClauses.push("(selling_item_code LIKE ? OR selling_item_name LIKE ?)");
    params.push(`%${itemCode}%`, `%${itemCode}%`);
  }
  if (type === "discount_pct") {
    whereClauses.push("disc_pct IS NOT NULL");
  } else if (type === "free_item") {
    whereClauses.push("giving_item_code IS NOT NULL");
  }
  if (activeOnly) {
    whereClauses.push("(begin_date IS NULL OR begin_date <= CURDATE()) AND (end_date IS NULL OR end_date >= CURDATE())");
  }
  if (validDate) {
    whereClauses.push("(begin_date IS NULL OR begin_date <= ?) AND (end_date IS NULL OR end_date >= ?)");
    params.push(validDate, validDate);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const canEditPriority = canEditPromotionPriority(guard.session);

  // view=program: one row per promotion program (where its priority is set).
  if (searchParams.get("view") === "program") {
    const totalRows = await query<{ cnt: number }[]>(`SELECT COUNT(DISTINCT promotion_code) AS cnt FROM promotion_discount ${whereSql}`, params);
    const total = Number(totalRows[0]?.cnt ?? 0);
    const programs = await query(
      `SELECT promotion_code, MAX(promotion_name) AS promotion_name, MIN(begin_date) AS begin_date, MAX(end_date) AS end_date,
              MIN(priority) AS priority, COUNT(*) AS row_count,
              COUNT(DISTINCT selling_item_code) AS item_count, COUNT(DISTINCT bp_code) AS bp_count,
              SUM(disc_pct IS NOT NULL) AS disc_rows, SUM(giving_item_code IS NOT NULL) AS free_rows
         FROM promotion_discount ${whereSql}
        GROUP BY promotion_code
        ORDER BY MIN(priority) IS NULL, MIN(priority), MIN(begin_date) DESC, promotion_code
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return NextResponse.json({ programs, total, page, totalPages: Math.ceil(total / limit), canEditPriority });
  }

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM promotion_discount ${whereSql}`,
    params
  );
  const total = totalRows[0]?.cnt ?? 0;

  const promotions = await query(
    `SELECT id, doc_entry, promotion_code, promotion_name, begin_date, end_date,
            bp_grp_code, bp_grp_name, bp_code, bp_name,
            selling_grp_code, selling_grp_name, selling_item_code, selling_item_name,
            disc_pct, selling_qty, giving_item_code, giving_item_name, giving_qty, priority, last_synced
     FROM promotion_discount ${whereSql}
     ORDER BY begin_date DESC, promotion_code, bp_code, selling_item_code
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ promotions, total, page, totalPages: Math.ceil(total / limit), canEditPriority });
}

/**
 * PATCH /api/admin/promotions — { promotionCode, priority } sets one
 * program's priority (every row of that promotion_code): a whole number
 * 1–9999, smaller = first when one selling item has more than one program;
 * null clears it. Only this column can be changed here — everything else
 * comes from SAP. Admin, Accountant and System Admin only.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireAdminPermission(request, "promotions");
  if (guard.response) return guard.response;
  if (!canEditPromotionPriority(guard.session)) {
    return NextResponse.json({ error: "Only Admin, Accountant and System Admin can change a promotion's priority" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { promotionCode?: unknown; priority?: unknown };
  const code = typeof body.promotionCode === "string" ? body.promotionCode.trim() : "";
  if (!code) return NextResponse.json({ error: "promotionCode is required" }, { status: 400 });
  let priority: number | null = null;
  if (body.priority !== null && body.priority !== undefined && body.priority !== "") {
    const raw = typeof body.priority === "string" ? body.priority.trim() : body.priority;
    const n = typeof raw === "number" ? raw : /^\d+$/.test(String(raw)) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      return NextResponse.json({ error: "Priority must be a whole number from 1 to 9999 (or empty for none)" }, { status: 400 });
    }
    priority = n;
  }

  // The program must be within the user's data permissions.
  const { customerGroupCodes, itemGroupCodes } = await getPromotionAllowedGroups(guard.session);
  const scopeFilter = await buildPromotionScopeFilter(customerGroupCodes, itemGroupCodes);
  const visible = scopeFilter.sql === "1=0" ? [] : await query<{ n: number }[]>(
    `SELECT 1 AS n FROM promotion_discount WHERE company_id = ? AND promotion_code = ?${scopeFilter.sql !== "1=1" ? ` AND ${scopeFilter.sql}` : ""} LIMIT 1`,
    [getCompanyId(), code, ...(scopeFilter.sql !== "1=1" ? scopeFilter.params : [])]
  );
  if (!visible.length) return NextResponse.json({ error: `Promotion ${code} not found` }, { status: 404 });

  try {
    // Same lock as the HANA sync (which carries priorities over to its fresh rows) — an edit never gets lost mid-sync.
    const updated = await withTableLocks(["promotion_discount"], async () => {
      const r = await query<{ affectedRows: number }>(
        `UPDATE promotion_discount SET priority = ? WHERE company_id = ? AND promotion_code = ?`, [priority, getCompanyId(), code]
      );
      return (r as unknown as { affectedRows: number }).affectedRows;
    }, { waitSeconds: 60 });
    return NextResponse.json({ promotionCode: code, priority, rows: updated });
  } catch (e) {
    if (e instanceof TableLockBusyError) return NextResponse.json({ error: "A promotion sync is running — try again in a minute" }, { status: 409 });
    throw e;
  }
}
