import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db/connection";
import { requireAdminPermission } from "@/lib/auth/adminSession";

/**
 * GET /api/admin/users/[id]/customer-groups — codes currently assigned to
 * this admin user (see admin_user_customer_groups / getAllowedCustomerGroupCodes).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  const rows = await query<{ code: string }[]>(
    `SELECT cg.code FROM admin_user_customer_groups aucg
     JOIN customer_groups cg ON cg.id = aucg.customer_group_id
     WHERE aucg.admin_user_id = ?`,
    [adminUserId]
  );
  return NextResponse.json({ codes: rows.map((r) => r.code) });
}

/**
 * PUT /api/admin/users/[id]/customer-groups — replace this admin's whole
 * set of assigned customer groups in one go (admin page's comma-separated
 * textbox — see admin-users/page.tsx). Assigning a group also implicitly
 * grants every descendant underneath it — see getAllowedCustomerGroupCodes.
 * Body: { codes: string[] }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminPermission(request, "admin-users");
  if (guard.response) return guard.response;

  const { id } = await params;
  const adminUserId = parseInt(id, 10);
  if (isNaN(adminUserId)) return NextResponse.json({ error: "Invalid admin user ID" }, { status: 400 });

  const body = await request.json();
  if (!Array.isArray(body.codes)) {
    return NextResponse.json({ error: "codes (array) is required" }, { status: 400 });
  }
  const codes = [...new Set(body.codes.map((c: string) => c.trim()).filter(Boolean))] as string[];

  let groupIds: number[] = [];
  if (codes.length > 0) {
    const rows = await query<{ id: number; code: string }[]>(
      `SELECT id, code FROM customer_groups WHERE code IN (${codes.map(() => "?").join(",")})`,
      codes
    );
    const foundCodes = new Set(rows.map((r) => r.code));
    const unknown = codes.filter((c) => !foundCodes.has(c));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "Unknown customer group code(s)", message: `Not found: ${unknown.join(", ")} — check the Customer Groups page for valid codes.` },
        { status: 400 }
      );
    }
    groupIds = rows.map((r) => r.id);
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM admin_user_customer_groups WHERE admin_user_id = ?`, [adminUserId]);
    for (const groupId of groupIds) {
      await conn.execute(
        `INSERT INTO admin_user_customer_groups (admin_user_id, customer_group_id) VALUES (?, ?)`,
        [adminUserId, groupId]
      );
    }
    await conn.commit();
    return NextResponse.json({ success: true, codes });
  } catch (error) {
    await conn.rollback();
    console.error("[Admin] Admin user customer-group assignment failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}
