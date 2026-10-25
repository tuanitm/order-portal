import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getCustomerGroupsWithEffectiveActive } from "@/lib/customerGroups";
import { getAllowedCustomerGroupCodes } from "@/lib/adminScope";

/**
 * GET /api/admin/customer-groups — each row's `effective_active`/
 * `ancestor_active` account for parent groups switched off; see
 * getCustomerGroupsWithEffectiveActive. A scoped (non-root) admin only sees
 * rows within their assigned customer groups (and descendants) — see
 * getAllowedCustomerGroupCodes.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "customer-groups");
  if (guard.response) return guard.response;

  let rows = await getCustomerGroupsWithEffectiveActive();
  const allowed = await getAllowedCustomerGroupCodes(guard.session);
  if (allowed !== null) rows = rows.filter((r) => allowed.has(r.code));
  rows.sort((a, b) => (a.level - b.level) || a.code.localeCompare(b.code));
  return NextResponse.json({ customerGroups: rows });
}

/**
 * POST /api/admin/customer-groups — manually add a single customer group
 * row. Restructuring the hierarchy itself is root-only, not delegable by
 * scope — a scoped admin manages data WITHIN their assigned groups, not
 * the tree.
 * Body: { level: number, code: string, parent_code?: string, name?: string }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "customer-groups");
  if (guard.response) return guard.response;
  if (!guard.session.isSuperAdmin) {
    return NextResponse.json({ error: "Only root can add customer groups" }, { status: 403 });
  }

  const body = await request.json();
  const level = parseInt(body.level, 10);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const parentCode = typeof body.parent_code === "string" && body.parent_code.trim() ? body.parent_code.trim() : null;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  if (!level || level < 1 || level > 3) {
    return NextResponse.json({ error: "level must be 1-3" }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  await query(
    `INSERT INTO customer_groups (company_id, level, code, parent_code, name) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE parent_code = VALUES(parent_code), name = VALUES(name)`,
    [getCompanyId(), level, code, parentCode, name]
  );

  return NextResponse.json({ success: true });
}
