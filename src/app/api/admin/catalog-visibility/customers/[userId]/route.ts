import { NextRequest, NextResponse } from "next/server";
import { getPool, query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/** GET /api/admin/catalog-visibility/customers/[userId] — one customer's overrides. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const { userId } = await params;
  const id = parseInt(userId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });

  const customer = await queryOne(
    `SELECT id, full_name, sap_card_code, sap_cus_grp01, sap_cus_grp02, sap_cus_grp03 FROM users WHERE id = ?`,
    [id]
  );
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const overrides = await query(
    `SELECT item_category_level, item_category_code, is_visible FROM customer_item_group_overrides WHERE user_id = ?`,
    [id]
  );

  return NextResponse.json({ customer, overrides });
}

/**
 * PUT /api/admin/catalog-visibility/customers/[userId] — bulk upsert
 * per-customer overrides. Body: { overrides: { itemCategoryLevel: number, itemCategoryCode: string, isVisible: boolean }[] }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const { userId } = await params;
  const id = parseInt(userId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });

  const body = await request.json();
  const overrides = body.overrides;
  if (!Array.isArray(overrides)) {
    return NextResponse.json({ error: "overrides (array) is required" }, { status: 400 });
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const o of overrides) {
      await conn.execute(
        `INSERT INTO customer_item_group_overrides (user_id, item_category_level, item_category_code, is_visible)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_visible = VALUES(is_visible)`,
        [id, o.itemCategoryLevel, o.itemCategoryCode, !!o.isVisible]
      );
    }
    await conn.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    await conn.rollback();
    console.error("[Admin] Customer override update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}
