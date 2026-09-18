import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/orders — list orders, optional status filter.
 * Note: order creation (POST /api/orders → MySQL + SAP draft push) is still
 * a TODO stub — this only manages whatever rows already exist.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const params: string[] = [];
  if (status) {
    whereClauses.push("o.status = ?");
    params.push(status);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRows = await query<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM orders o ${whereSql}`,
    params
  );
  const total = totalRows[0]?.cnt ?? 0;

  const orders = await query(
    `SELECT o.id, o.order_number, o.customer_name, o.subtotal, o.discount_total, o.grand_total,
            o.status, o.sap_doc_entry, o.sap_doc_num, o.created_at, u.email AS customer_email
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     ${whereSql}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ orders, total, page, totalPages: Math.ceil(total / limit) });
}
