import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { cascadeSetActiveDescendants } from "@/lib/customerGroups";

/**
 * PATCH /api/admin/customer-groups/[id] — name a customer group (mainly for
 * level 2/3 codes, whose names aren't available from SAP Service Layer),
 * and/or toggle it active (any level). Unlike item_groups, toggling active
 * here cascades to every descendant in BOTH directions — switching a group
 * off unticks its children, switching it back on re-ticks them too (see
 * cascadeSetActiveDescendants).
 * Body: { name?: string, isActive?: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "customer-groups");
  if (guard.response) return guard.response;

  const { id } = await params;
  const groupId = parseInt(id, 10);
  if (isNaN(groupId)) {
    return NextResponse.json({ error: "Invalid customer group ID" }, { status: 400 });
  }

  const body = await request.json();
  const updates: string[] = [];
  const values: (string | boolean | number | null)[] = [];

  if (typeof body.name === "string") {
    updates.push("name = ?");
    values.push(body.name.trim() || null);
  }
  if (typeof body.isActive === "boolean") {
    updates.push("is_active = ?");
    values.push(body.isActive);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(groupId);
  await query(`UPDATE customer_groups SET ${updates.join(", ")} WHERE id = ?`, values);

  if (typeof body.isActive === "boolean") {
    await cascadeSetActiveDescendants(groupId, body.isActive);
  }

  return NextResponse.json({ success: true });
}
