import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * PATCH /api/admin/items/[code] — hide/unhide an individual item (e.g. an
 * item that doesn't belong in the catalog even though its item category is
 * otherwise sellable). This sets `is_manually_hidden`, a separate flag from
 * the sync-driven `is_active`, so it survives the next items sync — a
 * resync never silently un-hides an item an admin deliberately hid.
 * Body: { isActive: boolean } — true = visible, false = hidden.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const guard = await requireAdminPermission(request, "items");
  if (guard.response) return guard.response;

  const { code } = await params;
  const body = await request.json();
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive (boolean) is required" }, { status: 400 });
  }

  await query(`UPDATE items SET is_manually_hidden = ? WHERE sap_item_code = ?`, [!body.isActive, code]);
  return NextResponse.json({ success: true });
}
