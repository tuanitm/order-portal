import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { bulkSetItemGroupActive } from "@/lib/itemCategories";
import { getAllowedItemGroupCodes } from "@/lib/adminScope";

/**
 * POST /api/admin/item-groups/bulk-active — apply several Active/Inactive
 * toggles in one request (the admin UI's "select multiple rows, Save once"
 * flow, including per-level Select All/None). Body: { changes: { id: number, isActive: boolean }[] }
 * A scoped (non-root) admin's changes are silently dropped for any group
 * outside their assigned scope (see getAllowedItemGroupCodes) rather than
 * failing the whole batch — Select All under a partly-out-of-scope level
 * should still apply to the rows the admin IS allowed to touch.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "item-groups");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only Super Admin can activate or inactivate item groups" }, { status: 403 });
  }

  const body = await request.json();
  let changes: { id: number; isActive: boolean }[] = Array.isArray(body.changes)
    ? body.changes.filter(
        (c: unknown): c is { id: number; isActive: boolean } =>
          !!c &&
          typeof (c as { id?: unknown }).id === "number" &&
          typeof (c as { isActive?: unknown }).isActive === "boolean"
      )
    : [];

  if (changes.length === 0) {
    return NextResponse.json({ error: "changes (array of {id, isActive}) is required" }, { status: 400 });
  }

  const allowed = await getAllowedItemGroupCodes(guard.session);
  if (allowed !== null) {
    const rows = await query<{ id: number; code: string }[]>(
      `SELECT id, code FROM item_groups WHERE id IN (${changes.map(() => "?").join(",")})`,
      changes.map((c) => c.id)
    );
    const allowedIds = new Set(rows.filter((r) => allowed.has(r.code)).map((r) => r.id));
    changes = changes.filter((c) => allowedIds.has(c.id));
  }

  if (changes.length === 0) {
    return NextResponse.json({ error: "No changes within your assigned scope" }, { status: 403 });
  }

  const result = await bulkSetItemGroupActive(changes);
  return NextResponse.json({ success: true, ...result });
}
