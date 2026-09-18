import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { cascadeDeactivateDescendants } from "@/lib/itemCategories";

/**
 * PATCH /api/admin/item-groups/[id] — name a category, toggle whether it's
 * sellable in the portal (level-1 rows only), and/or toggle it active
 * (any level — turning a group off drops it, and items under it, out of
 * the next items sync; see getItemCategoryPairsFromDB/syncItems). Switching
 * a group off also unticks every descendant group's own Active toggle
 * (cascadeDeactivateDescendants) — turning it back on does NOT re-tick them,
 * so the admin decides which children to bring back individually.
 * Body: { name?: string, isSellable?: boolean, isActive?: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "item-groups");
  if (guard.response) return guard.response;

  const { id } = await params;
  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) {
    return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
  }

  const body = await request.json();
  const updates: string[] = [];
  const values: (string | boolean | number | null)[] = [];

  if (typeof body.name === "string") {
    updates.push("name = ?");
    values.push(body.name.trim() || null);
  }
  if (typeof body.isSellable === "boolean") {
    updates.push("is_sellable = ?");
    values.push(body.isSellable);
  }
  if (typeof body.isActive === "boolean") {
    updates.push("is_active = ?");
    values.push(body.isActive);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(categoryId);
  await query(`UPDATE item_groups SET ${updates.join(", ")} WHERE id = ?`, values);

  if (body.isActive === false) {
    await cascadeDeactivateDescendants(categoryId);
  }

  return NextResponse.json({ success: true });
}
