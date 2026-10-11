import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getItemCategoryPairsFromDB, getItemGroupsWithEffectiveActive } from "@/lib/itemCategories";
import { getAllowedItemGroupCodes } from "@/lib/adminScope";

/**
 * GET /api/admin/item-groups — the item_groups hierarchy (SAP
 * Items.U_ItemCat01-06), all 6 levels. Each row's `effective_active`
 * accounts for parent groups switched off — see getItemGroupsWithEffectiveActive.
 * A scoped (non-root) admin only sees rows within their assigned item
 * groups (and descendants) — see getAllowedItemGroupCodes.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "item-groups");
  if (guard.response) return guard.response;

  let rows = await getItemGroupsWithEffectiveActive();
  const allowed = await getAllowedItemGroupCodes(guard.session);
  if (allowed !== null) rows = rows.filter((r) => allowed.has(r.code));
  rows.sort((a, b) => (a.level - b.level) || a.code.localeCompare(b.code));
  const sellablePairCount = (await getItemCategoryPairsFromDB()).length;
  return NextResponse.json({ itemCategories: rows, sellablePairCount });
}

/**
 * POST /api/admin/item-groups — manually add a single item group row.
 * Restructuring the hierarchy itself is root-only, not delegable by scope —
 * a scoped admin manages data WITHIN their assigned groups, not the tree.
 * Body: { level: number, code: string, parent_code?: string, name?: string }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "item-groups");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only root can add item groups" }, { status: 403 });
  }

  const body = await request.json();
  const level = parseInt(body.level, 10);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const parentCode = typeof body.parent_code === "string" && body.parent_code.trim() ? body.parent_code.trim() : null;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  if (!level || level < 1 || level > 6) {
    return NextResponse.json({ error: "level must be 1-6" }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  await query(
    `INSERT INTO item_groups (level, code, parent_code, name) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE parent_code = VALUES(parent_code), name = VALUES(name)`,
    [level, code, parentCode, name]
  );

  return NextResponse.json({ success: true });
}
