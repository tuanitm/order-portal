import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { runScheduledSync } from "@/lib/sap-b1/scheduledSync";

export async function POST(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  try {
    const result = await runScheduledSync();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Admin] Manual sync run failed:", error);
    return NextResponse.json(
      { error: "Sync run failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
