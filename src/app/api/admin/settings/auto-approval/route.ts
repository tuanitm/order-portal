import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { listAccountantSettings } from "@/lib/soApproval/autoApproval";

/** GET /api/admin/settings/auto-approval — every Accountant's Auto SO Approval setting (System Admin, Settings page). */
export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;
  return NextResponse.json({ accountants: await listAccountantSettings() });
}
