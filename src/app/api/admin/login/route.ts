import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { loadConfig, resolveEnvSecret } from "@/lib/config";
import { queryOne } from "@/lib/db/connection";
import { signAdminToken } from "@/lib/auth/adminSession";

interface AdminUserRow {
  id: number;
  email: string;
  password_hash: string;
  is_active: number;
}

/**
 * POST /api/admin/login — Admin authentication.
 * Accepts either the config.json bootstrap super-admin credential, or an
 * `admin_users` account (bcrypt-verified). Issues a signed JWT in the
 * `admin-token` cookie either way.
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

    // ── Bootstrap super-admin (config.json) ──
    const adminConfig = loadConfig().admin;
    const bootstrapEmail = adminConfig.email.startsWith("ENV:")
      ? resolveEnvSecret(adminConfig.email.replace("ENV:", ""))
      : adminConfig.email;
    const bootstrapPassword = adminConfig.password.startsWith("ENV:")
      ? resolveEnvSecret(adminConfig.password.replace("ENV:", ""))
      : adminConfig.password;

    if (email === bootstrapEmail && password === bootstrapPassword) {
      const token = signAdminToken({ email, isSuperAdmin: true });
      const response = NextResponse.json({
        success: true,
        admin: { email, isSuperAdmin: true },
      });
      response.cookies.set("admin-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60,
        path: "/",
      });
      return response;
    }

    // ── admin_users account ──
    const adminUser = await queryOne<AdminUserRow>(
      "SELECT id, email, password_hash, is_active FROM admin_users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!adminUser || !adminUser.is_active) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    }

    const passwordValid = await bcrypt.compare(password, adminUser.password_hash);
    if (!passwordValid) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    }

    const token = signAdminToken({ email: adminUser.email, isSuperAdmin: false, adminId: adminUser.id });
    const response = NextResponse.json({
      success: true,
      admin: { email: adminUser.email, isSuperAdmin: false },
    });
    response.cookies.set("admin-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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
