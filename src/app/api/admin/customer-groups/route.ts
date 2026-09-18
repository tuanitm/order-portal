import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getCustomerGroupsWithEffectiveActive } from "@/lib/customerGroups";

/**
 * GET /api/admin/customer-groups — each row's `effective_active`/
 * `ancestor_active` account for parent groups switched off; see
 * getCustomerGroupsWithEffectiveActive.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "customer-groups");
  if (guard.response) return guard.response;

  const rows = await getCustomerGroupsWithEffectiveActive();
  rows.sort((a, b) => (a.level - b.level) || a.code.localeCompare(b.code));
  return NextResponse.json({ customerGroups: rows });
}

/**
 * POST /api/admin/customer-groups — manually add a single customer group row.
 * Body: { level: number, code: string, parent_code?: string, name?: string }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "customer-groups");
  if (guard.response) return guard.response;

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
    `INSERT INTO customer_groups (level, code, parent_code, name) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE parent_code = VALUES(parent_code), name = VALUES(name)`,
    [level, code, parentCode, name]
  );

  return NextResponse.json({ success: true });
}
