import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/audit-logs — root-only (see ROOT_ONLY_PERMISSIONS). Lists
 * audit_logs rows, most recent first, with optional filters. See
 * src/lib/auditLog.ts for what writes these rows and schema.sql's own
 * comment on the table for the column meanings.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "audit-logs");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const actorType = searchParams.get("actorType") || ""; // "admin" | "customer"
  const action = searchParams.get("action") || ""; // exact match
  const search = searchParams.get("search") || ""; // partial match on actor_label
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const companyId = getCompanyId();
  const whereClauses: string[] = ["company_id = ?"];
  const params: (string | number)[] = [companyId];

  if (actorType === "admin" || actorType === "customer") {
    whereClauses.push("actor_type = ?");
    params.push(actorType);
  }
  if (action) {
    whereClauses.push("action = ?");
    params.push(action);
  }
  if (search) {
    whereClauses.push("actor_label LIKE ?");
    params.push(`%${search}%`);
  }
  if (dateFrom) {
    whereClauses.push("created_at >= ?");
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    whereClauses.push("created_at <= ?");
    params.push(`${dateTo} 23:59:59`);
  }

  const whereSql = whereClauses.join(" AND ");

  const [logs, totalRows, actionRows] = await Promise.all([
    query<{
      id: number; actor_type: "admin" | "customer"; actor_id: number | null; actor_label: string | null;
      action: string; entity_type: string | null; entity_id: string | null;
      details: Record<string, unknown> | null; ip_address: string | null; user_agent: string | null; created_at: string;
    }[]>(
      `SELECT id, actor_type, actor_id, actor_label, action, entity_type, entity_id, details, ip_address, user_agent, created_at
       FROM audit_logs WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    query<{ cnt: number }[]>(`SELECT COUNT(*) AS cnt FROM audit_logs WHERE ${whereSql}`, params),
    // Distinct action names seen for this company — populates the filter dropdown without hardcoding the list here.
    query<{ action: string }[]>(`SELECT DISTINCT action FROM audit_logs WHERE company_id = ? ORDER BY action ASC`, [companyId]),
  ]);

  const total = totalRows[0]?.cnt ?? 0;
  return NextResponse.json({
    logs,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    actions: actionRows.map((r) => r.action),
  });
}
