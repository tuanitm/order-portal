import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncCustomerGroupsFromHana } from "@/lib/customerGroups";

/**
 * POST /api/admin/customer-groups/sync — pull the CustGrp01->02->03 name
 * hierarchy straight from SAP HANA (see syncCustomerGroupsFromHana;
 * Service Layer SQLQueries can't reach these UDTs at all) — the only sync
 * path for this table; the old manual SAP_Customer_Group.xlsx upload has
 * been removed.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "customer-groups");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only root can sync customer groups" }, { status: 403 });
  }

  try {
    const result = await syncCustomerGroupsFromHana();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Customer group SAP sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
