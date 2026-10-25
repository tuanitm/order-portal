import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryOne, query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

interface SyncScheduleRow {
  company_id: string;
  is_enabled: number;
  interval_hours: number;
  post_so_mode: "draft" | "sales_order";
  last_run_at: string | null;
  last_run_status: "success" | "partial" | "failed" | null;
  last_run_summary: string | null;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  const row = await queryOne<SyncScheduleRow>(
    "SELECT * FROM sync_schedule_settings WHERE company_id = ?",
    [getCompanyId()]
  );
  return NextResponse.json({ schedule: row });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  const body = await request.json();
  const { isEnabled, intervalHours, postSoMode } = body;

  if (typeof isEnabled !== "boolean" || !Number.isInteger(intervalHours) || intervalHours < 1) {
    return NextResponse.json(
      { error: "isEnabled (boolean) and intervalHours (integer >= 1) are required" },
      { status: 400 }
    );
  }
  const soMode = postSoMode === "sales_order" ? "sales_order" : "draft";
  const companyId = getCompanyId();

  // One row per company (company_id is the PRIMARY KEY — see schema.sql) —
  // this company's row may not exist yet, so upsert rather than UPDATE.
  await query(
    `INSERT INTO sync_schedule_settings (company_id, is_enabled, interval_hours, post_so_mode)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), interval_hours = VALUES(interval_hours), post_so_mode = VALUES(post_so_mode)`,
    [companyId, isEnabled, intervalHours, soMode]
  );

  const row = await queryOne<SyncScheduleRow>(
    "SELECT * FROM sync_schedule_settings WHERE company_id = ?",
    [companyId]
  );
  return NextResponse.json({ success: true, schedule: row });
}
