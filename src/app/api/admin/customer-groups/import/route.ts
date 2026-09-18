import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { importCustomerGroupsFromFile } from "@/lib/customerGroups";

/**
 * POST /api/admin/customer-groups/import — import codes/names from
 * SAP_Customer_Group.xlsx at the project root (falls back to the legacy
 * custgroup.json if the xlsx is not present).
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "customer-groups");
  if (guard.response) return guard.response;

  try {
    const result = await importCustomerGroupsFromFile();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Customer group import failed:", error);
    return NextResponse.json(
      { error: "Import failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
