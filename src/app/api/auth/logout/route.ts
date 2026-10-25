import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auditLog";

/**
 * POST /api/auth/logout — clears the httpOnly `auth-token` cookie
 * server-side (a client can't clear an httpOnly cookie via
 * `document.cookie` — see Navbar.tsx's handleLogout, which now calls this
 * instead of only clearing its own React state) and logs the event.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  const response = NextResponse.json({ success: true });
  response.cookies.set("auth-token", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
  if (user) {
    await logAuditEvent({ actorType: "customer", actorId: user.id, actorLabel: user.email || user.fullName, action: "logout", request });
  }
  return response;
}
