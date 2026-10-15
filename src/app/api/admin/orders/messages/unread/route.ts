import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getUnreadCustomerMessageSummaryForAdmins } from "@/lib/orderMessages";

/**
 * GET /api/admin/orders/messages/unread — total unread customer messages
 * across every order (global, not per-admin — see
 * getUnreadCustomerMessageSummaryForAdmins), plus a per-order breakdown for
 * the admin portal's top-right notification dropdown. Read-only — nothing
 * here is marked read; that only happens when an admin actually opens an
 * order's own thread (see GET /api/admin/orders/[id]/messages).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const summary = await getUnreadCustomerMessageSummaryForAdmins();
  return NextResponse.json(summary);
}
