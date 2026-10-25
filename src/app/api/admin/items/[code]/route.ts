import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getAllowedItemGroupCodes } from "@/lib/adminScope";

/**
 * PATCH /api/admin/items/[code] — per-item admin overrides, each a separate
 * flag/column from the sync-driven fields, so they survive the next items
 * sync (neither is in syncItems' column list — a resync never touches them).
 * A scoped (non-root) admin may only edit an item under one of their
 * assigned item groups (and descendants) — see getAllowedItemGroupCodes.
 * Body (either or both):
 *   - { isActive: boolean } — hide/unhide (true = visible, false = hidden).
 *     Sets `is_manually_hidden`, distinct from the sync-driven `is_active`.
 *   - { salesUom: string | null } — override the unit of measure shown to
 *     customers; null/empty clears the override back to the synced `uom`.
 *     Effective UOM anywhere customer-facing = COALESCE(sales_uom, uom).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const guard = await requireAdminPermission(request, "items");
  if (guard.response) return guard.response;

  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only Super Admin can modify items" }, { status: 403 });
  }

  const { code } = await params;
  const companyId = getCompanyId();

  const allowed = await getAllowedItemGroupCodes(guard.session);
  if (allowed !== null) {
    const target = await queryOne<{
      item_cat01: string | null; item_cat02: string | null; item_cat03: string | null;
      item_cat04: string | null; item_cat05: string | null; item_cat06: string | null;
    }>(
      `SELECT item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06 FROM items WHERE company_id = ? AND sap_item_code = ?`,
      [companyId, code]
    );
    const cats = target ? [target.item_cat01, target.item_cat02, target.item_cat03, target.item_cat04, target.item_cat05, target.item_cat06] : [];
    if (!cats.some((c) => c && allowed.has(c))) {
      return NextResponse.json({ error: "Forbidden — this item is outside your assigned scope" }, { status: 403 });
    }
  }

  const body = await request.json();

  if (typeof body.isActive !== "boolean" && !("salesUom" in body)) {
    return NextResponse.json({ error: "isActive (boolean) or salesUom (string | null) is required" }, { status: 400 });
  }

  if (typeof body.isActive === "boolean") {
    await query(`UPDATE items SET is_manually_hidden = ? WHERE company_id = ? AND sap_item_code = ?`, [!body.isActive, companyId, code]);
  }
  if ("salesUom" in body) {
    const salesUom = typeof body.salesUom === "string" ? body.salesUom.trim() : null;
    await query(`UPDATE items SET sales_uom = ? WHERE company_id = ? AND sap_item_code = ?`, [salesUom || null, companyId, code]);
  }

  return NextResponse.json({ success: true });
}
