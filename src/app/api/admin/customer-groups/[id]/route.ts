import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { cascadeSetActiveDescendants } from "@/lib/customerGroups";
import { getAllowedCustomerGroupCodes } from "@/lib/adminScope";

/**
 * PATCH /api/admin/customer-groups/[id] — name a customer group (mainly for
 * level 2/3 codes, whose names aren't available from SAP Service Layer),
 * and/or toggle it active (any level). Unlike item_groups, toggling active
 * here cascades to every descendant in BOTH directions — switching a group
 * off unticks its children, switching it back on re-ticks them too (see
 * cascadeSetActiveDescendants). A scoped (non-root) admin may only edit a
 * group within their assigned customer groups (and descendants) — see
 * getAllowedCustomerGroupCodes.
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

  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only Super Admin can modify customer groups" }, { status: 403 });
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
