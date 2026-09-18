import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { bulkSetItemGroupActive } from "@/lib/itemCategories";

/**
 * POST /api/admin/item-groups/bulk-active — apply several Active/Inactive
 * toggles in one request (the admin UI's "select multiple rows, Save once"
 * flow). Body: { changes: { id: number, isActive: boolean }[] }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "item-groups");
  if (guard.response) return guard.response;

  const body = await request.json();
  const changes = Array.isArray(body.changes)
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

  const result = await bulkSetItemGroupActive(changes);
  return NextResponse.json({ success: true, ...result });
}
