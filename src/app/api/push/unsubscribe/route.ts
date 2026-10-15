import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { deleteSubscription } from "@/lib/webPush";

/**
 * POST /api/push/unsubscribe — removes a browser's push subscription (the
 * customer turned notifications off, or the subscription's permission was
 * revoked at the OS/browser level). Body: { endpoint }.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });

  await deleteSubscription(endpoint);
  return NextResponse.json({ success: true });
}
