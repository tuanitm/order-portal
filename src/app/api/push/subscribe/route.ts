import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { saveSubscription } from "@/lib/webPush";

/**
 * POST /api/push/subscribe — saves the browser's PushSubscription (from
 * PushManager.subscribe() on the client) for the logged-in customer — see
 * src/lib/webPush.ts. Body: the PushSubscription's own JSON shape:
 * { endpoint, keys: { p256dh, auth } }.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "A valid PushSubscription (endpoint, keys.p256dh, keys.auth) is required" }, { status: 400 });
  }

  await saveSubscription(user.id, endpoint, p256dh, auth);
  return NextResponse.json({ success: true });
}
