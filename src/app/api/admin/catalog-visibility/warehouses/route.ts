import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/catalog-visibility/warehouses — level-2 customer groups'
 * current warehouse mappings, plus every known warehouse code (so the admin
 * page can show which codes are valid, since the textbox is free-typed).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const warehouses = await query(
    `SELECT sap_warehouse_code, warehouse_name, is_included FROM warehouses ORDER BY warehouse_name ASC`
  );
  const mappings = await query(
    `SELECT customer_group_id, warehouse_code FROM customer_group_warehouses`
  );

  return NextResponse.json({ warehouses, mappings });
}

/**
 * PUT /api/admin/catalog-visibility/warehouses — replace one Customer
 * Group's whole set of mapped warehouses in one go (the admin page's
 * textbox holds a comma-separated list of codes, e.g. "1000, 1001, 1002",
 * for one group at a time — not a single add/remove).
 * Body: { customerGroupId: number, warehouseCodes: string[] }
 * customerGroupId must be a level-2 customer_groups row. Every code must
 * exist in `warehouses` (the table has a foreign key on it) — an unknown
 * code is rejected with a clear error instead of silently dropped, so a
 * typo doesn't just vanish.
 */
export async function PUT(request: NextRequest) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const body = await request.json();
  const { customerGroupId, warehouseCodes } = body;
  if (!customerGroupId || !Array.isArray(warehouseCodes)) {
    return NextResponse.json({ error: "customerGroupId and warehouseCodes (array) are required" }, { status: 400 });
  }

  const group = await query<{ level: number }[]>(`SELECT level FROM customer_groups WHERE id = ?`, [customerGroupId]);
  if (!group[0] || group[0].level !== 2) {
    return NextResponse.json({ error: "customerGroupId must be a level-2 customer group" }, { status: 400 });
  }

  const codes = [...new Set(warehouseCodes.map((c: string) => c.trim()).filter(Boolean))];

  if (codes.length > 0) {
    const known = await query<{ sap_warehouse_code: string }[]>(
      `SELECT sap_warehouse_code FROM warehouses WHERE sap_warehouse_code IN (${codes.map(() => "?").join(",")})`,
      codes
    );
    const knownSet = new Set(known.map((w) => w.sap_warehouse_code));
    const unknown = codes.filter((c) => !knownSet.has(c));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "Unknown warehouse code(s)", message: `Not found: ${unknown.join(", ")} — check the Warehouses page for valid codes.` },
        { status: 400 }
      );
    }
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM customer_group_warehouses WHERE customer_group_id = ?`, [customerGroupId]);
    for (const code of codes) {
      await conn.execute(
        `INSERT INTO customer_group_warehouses (customer_group_id, warehouse_code) VALUES (?, ?)`,
        [customerGroupId, code]
      );
    }
    await conn.commit();
    return NextResponse.json({ success: true, warehouseCodes: codes });
  } catch (error) {
    await conn.rollback();
    console.error("[Admin] Customer group warehouse mapping update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}
