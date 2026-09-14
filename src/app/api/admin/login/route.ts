import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * POST /api/admin/login — Admin authentication
 * Body: { email: string, password: string }
 * Uses credentials from config.json admin block
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

    // Load admin credentials from config.json and .env
    const configPath = join(process.cwd(), "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const adminConfig = config.admin;

    // Resolve admin email from ENV
    let adminEmail = adminConfig.email;
    if (adminEmail.startsWith("ENV:")) {
      const envKey = adminEmail.replace("ENV:", "");
      const envPath = join(process.cwd(), ".env");
      const envContent = readFileSync(envPath, "utf-8");
      const match = envContent.match(new RegExp(`${envKey}=[\"']?([^\"'\\r\\n]+)[\"']?`));
      adminEmail = match ? match[1] : "";
    }

    // Resolve admin password from ENV
    let adminPassword = adminConfig.password;
    if (adminPassword.startsWith("ENV:")) {
      const envKey = adminPassword.replace("ENV:", "");
      const envPath = join(process.cwd(), ".env");
      const envContent = readFileSync(envPath, "utf-8");
      const match = envContent.match(new RegExp(`${envKey}=(?:FERNET:)?[\"']?([^\"'\\r\\n]+)[\"']?`));
      const rawValue = match ? match[1] : "";

      if (rawValue.startsWith("gAAAAA")) {
        const keyPath = join(process.cwd(), "scripts", ".encryption_key");
        try {
          adminPassword = execSync(
            `python -c "import sys; from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${rawValue}').decode(), end='')"`,
            { encoding: "utf-8", timeout: 10000 }
          ).trim();
        } catch {
          console.error("[Admin] Failed to decrypt admin password");
          adminPassword = rawValue;
        }
      } else {
        adminPassword = rawValue;
      }
    }

    // Verify credentials
    if (email !== adminEmail || password !== adminPassword) {
      return NextResponse.json(
        { error: "Invalid admin credentials" },
        { status: 401 }
      );
    }

    // Set admin cookie
    const response = NextResponse.json({
      success: true,
      admin: { email: adminEmail },
    });

    response.cookies.set("admin-token", adminEmail, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60, // 8 hours
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
