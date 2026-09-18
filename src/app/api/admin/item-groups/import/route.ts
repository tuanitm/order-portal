import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { importItemCategoriesFromFile } from "@/lib/itemCategories";

/**
 * POST /api/admin/item-groups/import — import codes/names from
 * SAP_Item_Group.xlsx at the project root (falls back to the legacy
 * itemgroup.json if the xlsx is not present).
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "item-groups");
  if (guard.response) return guard.response;

  try {
    const result = await importItemCategoriesFromFile();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Item category import failed:", error);
    return NextResponse.json(
      { error: "Import failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
