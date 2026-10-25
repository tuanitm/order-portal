import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/adminSession";
import { logAuditEvent } from "@/lib/auditLog";

export async function POST(request: NextRequest) {
  const session = await getAdminSession(request);
  const response = NextResponse.json({ success: true });
  response.cookies.set("admin-token", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
  if (session) {
    await logAuditEvent({ actorType: "admin", actorId: session.adminId, actorLabel: session.email, action: "logout", request });
  }
  return response;
}

export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  const response = NextResponse.redirect(new URL("/vi/admin", request.url));
  response.cookies.set("admin-token", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
  if (session) {
    await logAuditEvent({ actorType: "admin", actorId: session.adminId, actorLabel: session.email, action: "logout", request });
  }
  return response;
}
