import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * PATCH /api/admin/warehouses/[code] — toggle whether a warehouse's stock
 * counts toward an item's storefront availability.
 * Body: { isIncluded: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const guard = await requireAdminPermission(request, "warehouses");
  if (guard.response) return guard.response;

  const { code } = await params;
  const body = await request.json();
  if (typeof body.isIncluded !== "boolean") {
    return NextResponse.json({ error: "isIncluded (boolean) is required" }, { status: 400 });
  }

  await query(`UPDATE warehouses SET is_included = ? WHERE sap_warehouse_code = ?`, [
    body.isIncluded,
    code,
  ]);

  return NextResponse.json({ success: true });
}
