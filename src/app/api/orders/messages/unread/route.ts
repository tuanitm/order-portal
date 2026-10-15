import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getUnreadMessageSummaryForUser } from "@/lib/orderMessages";

/**
 * GET /api/orders/messages/unread — total unread admin messages across
 * every order the current customer owns, plus a per-order breakdown
 * (latest message preview) for the storefront navbar's notification
 * dropdown. Read-only — nothing here is marked read; that only happens
 * when the customer actually opens an order's own thread (see
 * GET /api/orders/[id]/messages).
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const summary = await getUnreadMessageSummaryForUser(user.id);
  return NextResponse.json(summary);
}
