import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncItemGroupsFromHana } from "@/lib/itemCategories";

/**
 * POST /api/admin/item-groups/sync — pull the ItemCat01->06 name hierarchy
 * straight from SAP HANA (see syncItemGroupsFromHana; Service Layer
 * SQLQueries can't reach these UDTs at all) — the only sync path for this
 * table; the old manual SAP_Item_Group.xlsx upload has been removed.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "item-groups");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only root can sync item groups" }, { status: 403 });
  }

  try {
    const result = await syncItemGroupsFromHana();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Item group HANA sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
