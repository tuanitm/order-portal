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
  // A RELATIVE Location: behind the reverse proxy (https://order.imv.com.vn) request.url is the
  // server's own address (http://0.0.0.0:5005), so an absolute URL built from it sent users there.
  // The browser resolves "/vi/identify" against the address it is actually on.
  const response = new NextResponse(null, { status: 303, headers: { Location: `/${locale}/identify` } });
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
