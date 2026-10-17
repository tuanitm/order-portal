import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getOrderAllowedCustomerGroupCodes, orderGroupScopeClause } from "@/lib/adminScope";

/**
 * GET /api/admin/orders — list orders, optional status filter.
 * Scoped by admin user customer group visibility (or config.json masterdata.customerGroup for root).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const status   = searchParams.get("status")   || "";
  const brand    = searchParams.get("brand")    || "";   // partial match on brand name
  const customer = searchParams.get("customer") || "";   // partial match on sap_card_code OR card_name
  const docNo    = searchParams.get("docNo")    || "";   // matches portal order_number OR sap_doc_num OR sap_so_number
  const page  = Math.max(1, parseInt(searchParams.get("page")  || "1",  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  // Scoping:
  // - Superadmin sees all orders under config.json's masterdata.customerGroup
  // - Scoped (non-root) admin only sees orders under their assigned customer groups
  const allowedGroups = await getOrderAllowedCustomerGroupCodes(guard.session);
  const scope = orderGroupScopeClause(allowedGroups);
  whereClauses.push(scope.sql);
  params.push(...scope.params);

  if (status) {
    whereClauses.push("o.status = ?");
    params.push(status);
  }
  if (customer) {
    whereClauses.push("(u.sap_card_code LIKE ? OR c.card_name LIKE ? OR o.customer_name LIKE ?)");
    const p = `%${customer}%`;
    params.push(p, p, p);
  }
  if (docNo) {
    whereClauses.push("(o.order_number LIKE ? OR CAST(o.sap_doc_num AS CHAR) LIKE ? OR o.sap_so_number LIKE ?)");
    const p = `%${docNo}%`;
    params.push(p, p, p);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Brand filter: applied as a HAVING on the correlated subquery alias.
  // We wrap the base query in a subquery so HAVING can reference the alias.
  const brandHaving = brand ? "HAVING brand LIKE ?" : "";
  const brandParam  = brand ? [`%${brand}%`] : [];

  const countSql = brand
    ? `SELECT COUNT(*) AS cnt FROM (
         SELECT o.id,
           (SELECT GROUP_CONCAT(DISTINCT COALESCE(cc2.ocr_name, i2.brand_code) ORDER BY 1 SEPARATOR ', ')
            FROM order_lines ol2
            LEFT JOIN items i2 ON i2.sap_item_code = ol2.sap_item_code
            LEFT JOIN cost_centers cc2 ON cc2.ocr_code = i2.brand_code AND cc2.dimension = 1
            WHERE ol2.order_id = o.id AND ol2.is_gift_line = 0 AND i2.brand_code IS NOT NULL
           ) AS brand
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN customers c ON c.sap_card_code = u.sap_card_code
         ${whereSql}
         ${brandHaving}
       ) t`
    : `SELECT COUNT(*) AS cnt FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN customers c ON c.sap_card_code = u.sap_card_code
       ${whereSql}`;

  const totalRows = await query<{ cnt: number }[]>(countSql, [...params, ...brandParam]);
  const total = totalRows[0]?.cnt ?? 0;

  const orders = await query(
    `SELECT o.id, o.order_number, o.customer_name, o.subtotal, o.discount_total, o.grand_total,
            o.status, o.sap_doc_entry, o.sap_doc_num, o.sap_so_number, o.created_at,
            u.email AS customer_email, u.sap_card_code,
            c.card_name AS sap_card_name,
            (SELECT GROUP_CONCAT(DISTINCT COALESCE(cc2.ocr_name, i2.brand_code) ORDER BY 1 SEPARATOR ', ')
             FROM order_lines ol2
             LEFT JOIN items i2 ON i2.sap_item_code = ol2.sap_item_code
             LEFT JOIN cost_centers cc2 ON cc2.ocr_code = i2.brand_code AND cc2.dimension = 1
             WHERE ol2.order_id = o.id AND ol2.is_gift_line = 0 AND i2.brand_code IS NOT NULL
            ) AS brand
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     LEFT JOIN customers c ON c.sap_card_code = u.sap_card_code
     ${whereSql}
     ${brandHaving}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, ...brandParam, limit, offset]
  );

  return NextResponse.json({ orders, total, page, totalPages: Math.ceil(total / limit) });
}
