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
  // Back to the very first page (identify), in the user's language.
  const locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "vi";
  const response = NextResponse.redirect(new URL(`/${locale}/identify`, request.url));
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
