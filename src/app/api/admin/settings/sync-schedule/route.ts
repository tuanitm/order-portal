import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/adminSession";
import { queryOne, query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { audited } from "@/lib/auditLog";

interface SyncScheduleRow {
  company_id: string;
  is_enabled: number;
  interval_hours: number;
  post_so_mode: "draft" | "sales_order";
  so_approval_required: number;
  /** SO Approval shows only Sales Orders with DocDate on/after this (YYYY-MM-DD); null = all. */
  so_approval_from_date: string | null;
  last_run_at: string | null;
  last_run_status: "success" | "partial" | "failed" | null;
  last_run_summary: string | null;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  const row = await queryOne<SyncScheduleRow>(
    "SELECT *, DATE_FORMAT(so_approval_from_date, '%Y-%m-%d') AS so_approval_from_date FROM sync_schedule_settings WHERE company_id = ?",
    [getCompanyId()]
  );
  return NextResponse.json({ schedule: row });
}

async function PATCHHandler(request: NextRequest) {
  const guard = await requireAdminPermission(request, "settings");
  if (guard.response) return guard.response;

  const body = await request.json();
  const { isEnabled, intervalHours, postSoMode, soApprovalRequired, soApprovalFromDate } = body;
  // A real calendar date (2026-02-31 would pass the pattern but isn't one).
  const realDate = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  if (soApprovalFromDate !== undefined && soApprovalFromDate !== null && soApprovalFromDate !== ""
      && !(typeof soApprovalFromDate === "string" && realDate(soApprovalFromDate))) {
    return NextResponse.json({ error: "Approve SO from date must be YYYY-MM-DD" }, { status: 400 });
  }

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
  // SO Approval: only Sales Orders with DocDate on/after this date are listed (empty = all).
  if (soApprovalFromDate !== undefined) {
    await query(`UPDATE sync_schedule_settings SET so_approval_from_date = ? WHERE company_id = ?`, [soApprovalFromDate || null, companyId]);
  }
  // Legacy flag — no longer changes the push (SAP's approval procedure decides).
  if (typeof soApprovalRequired === "boolean") {
    await query(`UPDATE sync_schedule_settings SET so_approval_required = ? WHERE company_id = ?`, [soApprovalRequired, companyId]);
  }

  const row = await queryOne<SyncScheduleRow>(
    "SELECT *, DATE_FORMAT(so_approval_from_date, '%Y-%m-%d') AS so_approval_from_date FROM sync_schedule_settings WHERE company_id = ?",
    [companyId]
  );
  return NextResponse.json({ success: true, schedule: row });
}

// Every call is written to the audit log (who, role, target, request, outcome).
export const PATCH = audited({ action: "sync_schedule_update", entityType: "setting" }, PATCHHandler);
