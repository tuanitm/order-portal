import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { syncPromotionDiscountsFromHana } from "@/lib/hana/sync";
import { audited } from "@/lib/auditLog";

/**
 * POST /api/admin/promotions/sync — pull the current Promotion Discount
 * snapshot straight from SAP HANA (promotion_program.sql) into the local
 * cache (full replace — see syncPromotionDiscountsFromHana). Replaces the
 * old SAP Service Layer SQLQueries attempt, which SAP B1's own "Query
 * Generator Authorization" blocks for these UDTs regardless of grants.
 */
async function POSTHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "promotions");
  if (guard.response) return guard.response;

  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only Super Admin can sync promotions" }, { status: 403 });
  }

  try {
    const result = await syncPromotionDiscountsFromHana();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Promotion HANA sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const POST = audited({ action: "sync_promotions", entityType: "sync" }, POSTHandler);
