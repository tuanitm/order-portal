import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryOne, query } from "@/lib/db/connection";

interface SyncScheduleRow {
  id: number;
  is_enabled: number;
  interval_hours: number;
  last_run_at: string | null;
  last_run_status: "success" | "partial" | "failed" | null;
  last_run_summary: string | null;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  const row = await queryOne<SyncScheduleRow>("SELECT * FROM sync_schedule_settings WHERE id = 1");
  return NextResponse.json({ schedule: row });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  const body = await request.json();
  const { isEnabled, intervalHours } = body;

  if (typeof isEnabled !== "boolean" || !Number.isInteger(intervalHours) || intervalHours < 1) {
    return NextResponse.json(
      { error: "isEnabled (boolean) and intervalHours (integer >= 1) are required" },
      { status: 400 }
    );
  }

  await query("UPDATE sync_schedule_settings SET is_enabled = ?, interval_hours = ? WHERE id = 1", [
    isEnabled,
    intervalHours,
  ]);

  const row = await queryOne<SyncScheduleRow>("SELECT * FROM sync_schedule_settings WHERE id = 1");
  return NextResponse.json({ success: true, schedule: row });
}
