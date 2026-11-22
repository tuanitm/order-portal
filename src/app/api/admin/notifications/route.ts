import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/adminSession";
import { listNotifications, markNotificationsRead } from "@/lib/staffNotifications";
import { syncApprovalToDo } from "@/lib/soApproval/service";

/**
 * /api/admin/notifications — the signed-in staff member's own inbox (any staff role).
 *   GET  ?limit= — { items, unread }
 *   POST { ids?: number[], all?: true, docEntry?, orderId? } — mark read
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session?.adminId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limit = Number(request.nextUrl.searchParams.get("limit")) || 30;
  // Accountant: keep "to approve" equal to the live Pending queue — refreshed in the background, at most
  // every 2 minutes (the next poll shows it).
  if (session.kind === "account") {
    const id = session.adminId;
    void syncApprovalToDo(id, 2 * 60 * 1000).catch((e) => console.warn(`[Notifications] to-do sync for user ${id} failed:`, e));
  }
  return NextResponse.json(await listNotifications(session.adminId, limit));
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session?.adminId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 200) : undefined;
  await markNotificationsRead(session.adminId, {
    ids, all: body.all === true,
    docEntry: Number.isInteger(body.docEntry) ? body.docEntry : undefined,
    orderId: Number.isInteger(body.orderId) ? body.orderId : undefined,
  });
  return NextResponse.json({ success: true, unread: (await listNotifications(session.adminId, 1)).unread });
}
