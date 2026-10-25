import { NextRequest, NextResponse } from "next/server";
import { isHttpsRequest } from "@/lib/auth/cookies";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { signAdminToken } from "@/lib/auth/adminSession";

interface AdminUserRow {
  id: number;
  email: string;
  password_hash: string;
  is_root: number;
  is_active: number;
}

/**
 * POST /api/admin/login — Admin authentication. One unified lookup against
 * `admin_users` (bcrypt-verified) — root is a real row there too
 * (is_root=TRUE, see scripts/migrate_root_admin.mjs), not a config.json
 * comparison; config.json/.env are no longer read here. Issues a signed JWT
 * in the `admin-token` cookie, with `adminId` always populated now (root
 * included), so getAdminSession can re-verify is_root/is_active against the
 * DB on every request rather than trusting an old JWT's claim for 8h.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const adminUser = await queryOne<AdminUserRow>(
      "SELECT id, email, password_hash, is_root, is_active FROM admin_users WHERE company_id = ? AND email = ? LIMIT 1",
      [getCompanyId(), email.trim().toLowerCase()]
    );
    if (!adminUser || !adminUser.is_active) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    }

    const passwordValid = await bcrypt.compare(password, adminUser.password_hash);
    if (!passwordValid) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    }

    const isSuperAdmin = !!adminUser.is_root;
    const token = signAdminToken({ email: adminUser.email, isSuperAdmin, adminId: adminUser.id });
    const response = NextResponse.json({
      success: true,
      admin: { email: adminUser.email, isSuperAdmin },
    });
    response.cookies.set("admin-token", token, {
      httpOnly: true,
      secure: isHttpsRequest(request),
      sameSite: "lax",
      maxAge: 8 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("[API] Admin login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
