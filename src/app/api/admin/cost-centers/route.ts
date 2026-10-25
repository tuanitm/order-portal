import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/cost-centers?dimension=2 — list synced Distribution Rule
 * codes for one dimension (see cost_centers in schema.sql). Used by the
 * Admin Users page to populate the Department Code dropdown (dimension 2).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const dimension = parseInt(new URL(request.url).searchParams.get("dimension") || "", 10);
  if (isNaN(dimension)) return NextResponse.json({ error: "dimension query param is required" }, { status: 400 });

  const costCenters = await query(
    `SELECT ocr_code, ocr_name, is_active FROM cost_centers WHERE company_id = ? AND dimension = ? ORDER BY ocr_name, ocr_code`,
    [getCompanyId(), dimension]
  );
  return NextResponse.json({ costCenters });
}
