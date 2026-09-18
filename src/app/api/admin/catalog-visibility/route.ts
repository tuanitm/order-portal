import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/catalog-visibility — returns the dropdown options
 * (customer groups + item groups levels 1-3) and existing rules.
 * Starts blank — admin adds rules line by line.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const customerGroups = await query<{ id: number; level: number; code: string; parent_code: string | null; name: string | null }[]>(
    `SELECT id, level, code, parent_code, name FROM customer_groups ORDER BY level ASC, code ASC`
  );
  const itemGroups = await query<{ id: number; level: number; code: string; parent_code: string | null; name: string | null }[]>(
    `SELECT id, level, code, parent_code, name FROM item_groups WHERE level IN (1, 2, 3) ORDER BY level ASC, code ASC`
  );
  const rules = await query<
    { id: number; customer_group_id: number; item_category_level: number; item_category_code: string; is_visible: number }[]
  >(
    `SELECT cv.id, cv.customer_group_id, cv.item_category_level, cv.item_category_code, cv.is_visible,
            cg.code AS cg_code, cg.name AS cg_name, cg.level AS cg_level
     FROM catalog_visibility cv
     JOIN customer_groups cg ON cg.id = cv.customer_group_id
     ORDER BY cg.level ASC, cg.code ASC, cv.item_category_level ASC, cv.item_category_code ASC`
  );

  return NextResponse.json({ customerGroups, itemGroups, rules });
}

/**
 * POST /api/admin/catalog-visibility — add a single visibility rule.
 * Body: { customerGroupId: number, itemCategoryLevel: number, itemCategoryCode: string, isVisible: boolean }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const body = await request.json();
  const { customerGroupId, itemCategoryLevel, itemCategoryCode, isVisible } = body;

  if (!customerGroupId || !itemCategoryLevel || !itemCategoryCode) {
    return NextResponse.json({ error: "customerGroupId, itemCategoryLevel, and itemCategoryCode are required" }, { status: 400 });
  }

  await query(
    `INSERT INTO catalog_visibility (customer_group_id, item_category_level, item_category_code, is_visible)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE is_visible = VALUES(is_visible)`,
    [customerGroupId, itemCategoryLevel, itemCategoryCode, isVisible !== false]
  );

  return NextResponse.json({ success: true });
}

/**
 * PUT /api/admin/catalog-visibility — bulk upsert rules (kept for backward compatibility).
 * Body: { rules: { customerGroupId: number, itemCategoryLevel: number, itemCategoryCode: string, isVisible: boolean }[] }
 */
export async function PUT(request: NextRequest) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const body = await request.json();
  const rules = body.rules;
  if (!Array.isArray(rules)) {
    return NextResponse.json({ error: "rules (array) is required" }, { status: 400 });
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const rule of rules) {
      await conn.execute(
        `INSERT INTO catalog_visibility (customer_group_id, item_category_level, item_category_code, is_visible)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_visible = VALUES(is_visible)`,
        [rule.customerGroupId, rule.itemCategoryLevel, rule.itemCategoryCode, !!rule.isVisible]
      );
    }
    await conn.commit();
    return NextResponse.json({ success: true, rulesUpdated: rules.length });
  } catch (error) {
    await conn.rollback();
    console.error("[Admin] Catalog visibility update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}

/**
 * DELETE /api/admin/catalog-visibility — delete a single rule by id.
 * Body: { id: number }
 */
export async function DELETE(request: NextRequest) {
  const guard = await requireAdminPermission(request, "catalog-visibility");
  if (guard.response) return guard.response;

  const body = await request.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await query(`DELETE FROM catalog_visibility WHERE id = ?`, [id]);
  return NextResponse.json({ success: true });
}
