import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncCustomerRequiredShelfLife } from "@/lib/sap-b1/sync";
import { audited } from "@/lib/auditLog";

/**
 * POST /api/admin/contract-discounts/shelf-life/sync — pull Customer
 * Required Shelf Life (SAP CSL headers + lines) into `customer_require_shelflife`,
 * scoped to known customer_groups/item_groups — see syncCustomerRequiredShelfLife.
 */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "contract-discounts");
  if (guard.response) return guard.response;

  try {
    const result = await syncCustomerRequiredShelfLife();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Customer required shelf life sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const POST = audited({ action: "sync_shelf_life", entityType: "sync" }, POSTHandler);
