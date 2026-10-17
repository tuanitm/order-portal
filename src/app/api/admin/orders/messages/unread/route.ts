import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { getUnreadCustomerMessageSummaryForAdmins } from "@/lib/orderMessages";
import { getOrderAllowedCustomerGroupCodes } from "@/lib/adminScope";

/**
 * GET /api/admin/orders/messages/unread — total unread customer messages
 * across orders visible to this admin user (scoped by customer group).
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "orders");
  if (guard.response) return guard.response;

  const allowed = await getOrderAllowedCustomerGroupCodes(guard.session);
  const summary = await getUnreadCustomerMessageSummaryForAdmins(allowed);
  return NextResponse.json(summary);
}
