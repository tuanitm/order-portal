import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { loadStaffSession, hasPermission } from "@/lib/auth/adminSession";
import { getSapCredentialStatus } from "@/lib/sap-b1/userCredentials";
import {
  parseStockSyncWindows, validateStockSyncWindows, findActiveStockSyncWindow, vnMinuteOfDay, type StockSyncWindow,
} from "@/lib/stockSyncWindows";
import { listApprovalQueue, getApprovalDetail, decideApproval, docsWithUndo, DecisionError } from "@/lib/soApproval/service";

/**
 * Auto SO Approval — per Accountant. On the Accountant's time windows
 * (Vietnam time, each with its interval in minutes — same rules as the
 * Inventory Stock schedule; outside every window it doesn't run), the
 * portal goes through the SOs waiting for THAT Accountant's decision (their
 * own SO Approval queue: their SAP approval lines / stages and data
 * permissions — never another Accountant's), re-runs the six checks and:
 *   - all six pass        → approves it as the Accountant (method "auto",
 *                           their own SAP user — exactly like clicking Approve)
 *   - any step not a pass → leaves it pending, logs which steps and why
 *   - error               → logs it (failed)
 * SOs whose approval was ever undone are left to a person. Each run is a
 * so_auto_approval_runs row; each SO a so_auto_approval_log row (an
 * identical repeated "skipped" only bumps last_checked_at / check_count).
 * The Accountant sets it on Credit Control → Auto SO Approval; System Admin
 * sees and edits everyone's on Settings.
 */
export interface AutoApprovalSetting {
  adminUserId: number;
  enabled: boolean;
  windows: StockSyncWindow[];
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
  updatedAt: string | null;
}

export interface AccountantAutoRow extends AutoApprovalSetting {
  userid: string | null;
  fullName: string | null;
  isActive: boolean;
  roleName: string | null;
  sapUserCode: string | null;
  hasSapPassword: boolean;
}

export interface AutoCheck { key: string; step: number; title: string; status: string; summary: string }

export interface AutoLogRow {
  id: number;
  runId: number;
  adminUserId: number;
  docEntry: number;
  docNo: string | null;
  cardCode: string | null;
  cardName: string | null;
  outcome: "approved" | "skipped" | "failed";
  reason: string | null;
  checks: AutoCheck[];
  approvalOutcome: string | null;
  checkCount: number;
  createdAt: string;
  lastCheckedAt: string;
}

export interface AutoRunRow {
  id: number;
  adminUserId: number;
  trigger: "schedule" | "manual";
  status: string;
  checked: number;
  approved: number;
  skipped: number;
  failed: number;
  summary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export class AutoApprovalError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const parseJson = <T,>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "string") return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

/** Is this staff user an Accountant (role kind "account")? */
async function accountantRow(adminUserId: number) {
  return queryOne<{ id: number; kind: string | null; is_active: number }>(
    `SELECT a.id, r.kind, a.is_active FROM admin_users a LEFT JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id
      WHERE a.company_id = ? AND a.id = ?`,
    [getCompanyId(), adminUserId]
  );
}

export async function getAutoSetting(adminUserId: number): Promise<AutoApprovalSetting> {
  const r = await queryOne<{ is_enabled: number; windows: unknown; last_run_at: string | null; last_run_status: string | null; last_run_summary: string | null; updated_at: string | null }>(
    `SELECT is_enabled, windows, last_run_at, last_run_status, last_run_summary, updated_at FROM so_auto_approval_settings WHERE company_id = ? AND admin_user_id = ?`,
    [getCompanyId(), adminUserId]
  );
  return {
    adminUserId, enabled: !!r?.is_enabled, windows: parseStockSyncWindows(r?.windows ?? null),
    lastRunAt: r?.last_run_at ?? null, lastRunStatus: r?.last_run_status ?? null, lastRunSummary: r?.last_run_summary ?? null, updatedAt: r?.updated_at ?? null,
  };
}

/** Every Accountant (role kind account) with their Auto SO Approval setting — for System Admin. */
export async function listAccountantSettings(): Promise<AccountantAutoRow[]> {
  const rows = await query<{
    id: number; userid: string | null; full_name: string | null; is_active: number; role_name: string | null; sap_user_code: string | null; sap_password_enc: string | null;
    is_enabled: number | null; windows: unknown; last_run_at: string | null; last_run_status: string | null; last_run_summary: string | null; updated_at: string | null;
  }[]>(
    `SELECT a.id, a.userid, a.full_name, a.is_active, r.name AS role_name, a.sap_user_code, a.sap_password_enc,
            s.is_enabled, s.windows, s.last_run_at, s.last_run_status, s.last_run_summary, s.updated_at
       FROM admin_users a
       JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id AND r.kind = 'account'
       LEFT JOIN so_auto_approval_settings s ON s.company_id = a.company_id AND s.admin_user_id = a.id
      WHERE a.company_id = ?
      ORDER BY a.is_active DESC, a.userid`,
    [getCompanyId()]
  );
  return rows.map((r) => ({
    adminUserId: r.id, userid: r.userid, fullName: r.full_name, isActive: !!r.is_active, roleName: r.role_name,
    sapUserCode: r.sap_user_code, hasSapPassword: !!r.sap_password_enc,
    enabled: !!r.is_enabled, windows: parseStockSyncWindows(r.windows ?? null),
    lastRunAt: r.last_run_at, lastRunStatus: r.last_run_status, lastRunSummary: r.last_run_summary, updatedAt: r.updated_at,
  }));
}

/** Save an Accountant's setting (by themselves or by System Admin). */
export async function saveAutoSetting(adminUserId: number, input: { enabled: unknown; windows: unknown }, byAdminId: number): Promise<AutoApprovalSetting> {
  const u = await accountantRow(adminUserId);
  if (!u) throw new AutoApprovalError("User not found", 404);
  if (u.kind !== "account") throw new AutoApprovalError("Auto SO Approval is only for Accountant users", 403);
  if (typeof input.enabled !== "boolean") throw new AutoApprovalError("enabled must be true or false");
  const err = validateStockSyncWindows(input.windows);
  if (err) throw new AutoApprovalError(err);
  const windows = input.windows as StockSyncWindow[];
  if (input.enabled && windows.length === 0) throw new AutoApprovalError("Add at least one time window — outside every window Auto SO Approval doesn't run");
  await query(
    `INSERT INTO so_auto_approval_settings (company_id, admin_user_id, is_enabled, windows, updated_by) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), windows = VALUES(windows), updated_by = VALUES(updated_by)`,
    [getCompanyId(), adminUserId, input.enabled, JSON.stringify(windows), byAdminId]
  );
  return getAutoSetting(adminUserId);
}

export async function listAutoLog(adminUserId: number | null, opts: { limit?: number; outcome?: string; runId?: number } = {}): Promise<AutoLogRow[]> {
  const where = ["company_id = ?"];
  const params: unknown[] = [getCompanyId()];
  if (adminUserId !== null) { where.push("admin_user_id = ?"); params.push(adminUserId); }
  if (opts.outcome && ["approved", "skipped", "failed"].includes(opts.outcome)) { where.push("outcome = ?"); params.push(opts.outcome); }
  if (opts.runId) { where.push("run_id = ?"); params.push(opts.runId); }
  const rows = await query<{
    id: number; run_id: number; admin_user_id: number; sap_doc_entry: number; doc_no: string | null; card_code: string | null; card_name: string | null;
    outcome: AutoLogRow["outcome"]; reason: string | null; checks: unknown; approval_outcome: string | null; check_count: number; created_at: string; last_checked_at: string;
  }[]>(
    `SELECT id, run_id, admin_user_id, sap_doc_entry, doc_no, card_code, card_name, outcome, reason, checks, approval_outcome, check_count, created_at, last_checked_at
       FROM so_auto_approval_log WHERE ${where.join(" AND ")} ORDER BY last_checked_at DESC, id DESC LIMIT ${Math.min(500, Math.max(1, opts.limit ?? 100))}`,
    params
  );
  return rows.map((r) => ({
    id: r.id, runId: r.run_id, adminUserId: r.admin_user_id, docEntry: Number(r.sap_doc_entry), docNo: r.doc_no, cardCode: r.card_code, cardName: r.card_name,
    outcome: r.outcome, reason: r.reason, checks: parseJson<AutoCheck[]>(r.checks, []), approvalOutcome: r.approval_outcome,
    checkCount: r.check_count, createdAt: r.created_at, lastCheckedAt: r.last_checked_at,
  }));
}

export async function listAutoRuns(adminUserId: number, limit = 20): Promise<AutoRunRow[]> {
  const rows = await query<{ id: number; admin_user_id: number; trigger_type: AutoRunRow["trigger"]; status: string; checked_count: number; approved_count: number; skipped_count: number; failed_count: number; summary: string | null; started_at: string; finished_at: string | null }[]>(
    `SELECT id, admin_user_id, trigger_type, status, checked_count, approved_count, skipped_count, failed_count, summary, started_at, finished_at
       FROM so_auto_approval_runs WHERE company_id = ? AND admin_user_id = ? ORDER BY id DESC LIMIT ${Math.min(100, Math.max(1, limit))}`,
    [getCompanyId(), adminUserId]
  );
  return rows.map((r) => ({
    id: r.id, adminUserId: r.admin_user_id, trigger: r.trigger_type, status: r.status, checked: r.checked_count, approved: r.approved_count,
    skipped: r.skipped_count, failed: r.failed_count, summary: r.summary, startedAt: r.started_at, finishedAt: r.finished_at,
  }));
}

// ── The run ────────────────────────────────────────────────────────────

const g = globalThis as typeof globalThis & { __soAutoApprovalRunning?: Set<number> };
const running: Set<number> = (g.__soAutoApprovalRunning ??= new Set());
export const isAutoRunning = (adminUserId: number) => running.has(adminUserId);

async function writeLog(adminUserId: number, runId: number, e: {
  docEntry: number; docNo: string | null; cardCode: string | null; cardName: string | null;
  outcome: AutoLogRow["outcome"]; reason: string | null; checks: AutoCheck[]; approvalOutcome?: string | null;
}) {
  const companyId = getCompanyId();
  const checksJson = JSON.stringify(e.checks);
  if (e.outcome === "skipped") {
    // Same SO, same result as last time → don't add a row every few minutes; count it.
    const last = await queryOne<{ id: number; outcome: string; reason: string | null; checks: unknown }>(
      `SELECT id, outcome, reason, checks FROM so_auto_approval_log WHERE company_id = ? AND admin_user_id = ? AND sap_doc_entry = ? ORDER BY id DESC LIMIT 1`,
      [companyId, adminUserId, e.docEntry]
    );
    const sameChecks = last && JSON.stringify(parseJson<AutoCheck[]>(last.checks, []).map((c) => [c.key, c.status, c.summary]))
      === JSON.stringify(e.checks.map((c) => [c.key, c.status, c.summary]));
    if (last && last.outcome === "skipped" && last.reason === e.reason && sameChecks) {
      await query(`UPDATE so_auto_approval_log SET run_id = ?, check_count = check_count + 1, last_checked_at = NOW() WHERE id = ?`, [runId, last.id]);
      return;
    }
  }
  await query(
    `INSERT INTO so_auto_approval_log (company_id, admin_user_id, run_id, sap_doc_entry, doc_no, card_code, card_name, outcome, reason, checks, approval_outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, adminUserId, runId, e.docEntry, e.docNo, e.cardCode, e.cardName?.slice(0, 255) ?? null, e.outcome, e.reason, checksJson, e.approvalOutcome ?? null]
  );
}

export interface AutoRunResult { runId: number | null; status: "success" | "partial" | "failed" | "skipped"; checked: number; approved: number; skipped: number; failed: number; summary: string }

/**
 * One Auto SO Approval run for this Accountant (scheduled, or "Run now").
 * Works only on their own queue — the SOs waiting for their decision now.
 */
export async function runAutoApproval(adminUserId: number, trigger: "schedule" | "manual", triggeredBy: number | null = null): Promise<AutoRunResult> {
  if (running.has(adminUserId)) return { runId: null, status: "skipped", checked: 0, approved: 0, skipped: 0, failed: 0, summary: "A run is already in progress for this user." };
  running.add(adminUserId);
  const companyId = getCompanyId();
  let runId: number | null = null;
  const counts = { checked: 0, approved: 0, skipped: 0, failed: 0 };
  const finish = async (status: AutoRunResult["status"], summary: string): Promise<AutoRunResult> => {
    if (runId) {
      await query(
        `UPDATE so_auto_approval_runs SET status = ?, checked_count = ?, approved_count = ?, skipped_count = ?, failed_count = ?, summary = ?, finished_at = NOW() WHERE id = ?`,
        [status, counts.checked, counts.approved, counts.skipped, counts.failed, summary, runId]
      );
    }
    await query(
      `INSERT INTO so_auto_approval_settings (company_id, admin_user_id, last_run_at, last_run_status, last_run_summary) VALUES (?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE last_run_at = NOW(), last_run_status = VALUES(last_run_status), last_run_summary = VALUES(last_run_summary)`,
      [companyId, adminUserId, status, summary]
    );
    return { runId, status, ...counts, summary };
  };
  try {
    const ins = await query<{ insertId: number }>(
      `INSERT INTO so_auto_approval_runs (company_id, admin_user_id, trigger_type, triggered_by) VALUES (?, ?, ?, ?)`,
      [companyId, adminUserId, trigger, triggeredBy]
    );
    runId = (ins as unknown as { insertId: number }).insertId;

    const session = await loadStaffSession(adminUserId);
    if (!session) return await finish("failed", "The user is inactive or no longer exists.");
    if (session.kind !== "account") return await finish("failed", "Auto SO Approval is only for Accountant users.");
    if (!hasPermission(session, "so-approval")) return await finish("failed", "The user's role doesn't have SO Approval.");
    if (!(await getSapCredentialStatus(adminUserId)).hasPassword) return await finish("failed", "No SAP password saved (My Profile → SAP account) — approving needs it.");

    const queue = await listApprovalQueue(session, { status: "pending" });
    // Only what's waiting for THIS Accountant's decision now.
    const mine = queue.rows.filter((r) => r.status === "pending" && r.sapApproval.waitingOnMe);
    const undone = await docsWithUndo(mine.map((r) => r.docEntry));
    for (const r of mine) {
      counts.checked++;
      const head = { docEntry: r.docEntry, docNo: r.docNo ?? String(r.docNum), cardCode: r.cardCode, cardName: r.customerName };
      if (undone.has(r.docEntry)) {
        counts.skipped++;
        await writeLog(adminUserId, runId, { ...head, outcome: "skipped", reason: "Its approval was undone earlier — it must be approved manually.", checks: [] });
        continue;
      }
      try {
        const d = await getApprovalDetail(session, r.docEntry, true);
        const checks: AutoCheck[] = (d?.checks ?? []).map((c) => ({ key: c.key, step: c.step, title: c.title, status: c.status, summary: c.summary }));
        if (!d) {
          counts.skipped++;
          await writeLog(adminUserId, runId, { ...head, outcome: "skipped", reason: "Not visible to this user any more.", checks });
          continue;
        }
        if (!d.decide.canDecide) {
          counts.skipped++;
          await writeLog(adminUserId, runId, { ...head, outcome: "skipped", reason: d.decide.reason ?? "Not waiting for this user's decision.", checks });
          continue;
        }
        if (checks.length < 6) {
          counts.skipped++;
          await writeLog(adminUserId, runId, { ...head, outcome: "skipped", reason: `Only ${checks.length} of the 6 checks could run — approve manually.`, checks });
          continue;
        }
        const notPass = checks.filter((c) => c.status !== "pass");
        if (notPass.length) {
          counts.skipped++;
          await writeLog(adminUserId, runId, {
            ...head, outcome: "skipped", checks,
            reason: `Not auto-approved — ${notPass.length} step(s) not passed:\n${notPass.map((c) => `${c.step}. ${c.title} — ${c.status.toUpperCase()}: ${c.summary}`).join("\n")}`,
          });
          continue;
        }
        const res = await decideApproval(session, r.docEntry, "approved",
          `Auto SO Approval (run #${runId}, ${trigger === "manual" ? "run now" : "scheduled"}) — all 6 checks passed.`, {}, "auto");
        counts.approved++;
        await writeLog(adminUserId, runId, {
          ...head, outcome: "approved", checks, approvalOutcome: res.outcome,
          reason: [
            res.outcome === "approved" ? `Approved and released in SAP as ${res.sapUser} (U_DataStatus C).`
              : `Stage approved as ${res.sapUser}; waiting for ${res.waitingFor.join(", ") || "the next stage"}.`,
            res.requestNo ? `SAP request #${res.requestNo}.` : null,
            res.warning,
          ].filter(Boolean).join(" "),
        });
      } catch (e) {
        counts.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await writeLog(adminUserId, runId, { ...head, outcome: "failed", reason: msg.slice(0, 2000), checks: [] });
        // The saved SAP password stopped working: no point trying the rest.
        if (e instanceof DecisionError && e.status === 428) {
          return await finish("failed", `Stopped: ${msg}`);
        }
      }
    }
    const summary = counts.checked === 0 ? "Nothing waiting for this user's approval."
      : `${counts.checked} SO(s) checked — ${counts.approved} approved, ${counts.skipped} left for manual review, ${counts.failed} failed.`;
    return await finish(counts.failed ? (counts.approved ? "partial" : "failed") : "success", summary);
  } catch (e) {
    console.error(`[AutoApproval] user ${adminUserId} run failed:`, e);
    return await finish("failed", `Run failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running.delete(adminUserId);
  }
}

/**
 * Called every minute by the scheduler (instrumentation.ts): runs, one after
 * another, every enabled Accountant whose current time window's interval has
 * passed since their last run.
 */
export async function pollAutoApprovals(now = new Date()): Promise<void> {
  const rows = await query<{ admin_user_id: number; windows: unknown; last_run_at: string | null }[]>(
    `SELECT s.admin_user_id, s.windows, s.last_run_at FROM so_auto_approval_settings s
       JOIN admin_users a ON a.company_id = s.company_id AND a.id = s.admin_user_id AND a.is_active = 1
      WHERE s.company_id = ? AND s.is_enabled = 1`,
    [getCompanyId()]
  );
  const minute = vnMinuteOfDay(now);
  for (const r of rows) {
    const active = findActiveStockSyncWindow(parseStockSyncWindows(r.windows), minute);
    if (!active) continue;
    const dueAt = r.last_run_at ? new Date(r.last_run_at).getTime() + active.intervalMinutes * 60 * 1000 : 0;
    // 30 s slack: the poll fires every 60 s (see the stock sync poller).
    if (now.getTime() < dueAt - 30 * 1000) continue;
    const res = await runAutoApproval(r.admin_user_id, "schedule");
    if (res.status === "failed") console.error(`[AutoApproval] user ${r.admin_user_id}: ${res.summary}`);
    else if (res.checked) console.log(`[AutoApproval] user ${r.admin_user_id}: ${res.summary}`);
  }
}

/** Everything the Auto SO Approval panel shows for one Accountant. */
export async function autoApprovalDetail(adminUserId: number, opts: { outcome?: string; runId?: number; limit?: number } = {}) {
  const [setting, runs, log, sap] = await Promise.all([
    getAutoSetting(adminUserId), listAutoRuns(adminUserId), listAutoLog(adminUserId, opts), getSapCredentialStatus(adminUserId),
  ]);
  return { setting, runs, log, running: isAutoRunning(adminUserId), sap: { userCode: sap.sapUserCode, hasPassword: sap.hasPassword } };
}

/** "Run now": starts in the background (a run re-checks every waiting SO live in SAP); the panel polls. */
export function startAutoApprovalRun(adminUserId: number, byAdminId: number): boolean {
  if (isAutoRunning(adminUserId)) return false;
  void runAutoApproval(adminUserId, "manual", byAdminId).catch((e) => console.error("[AutoApproval] manual run failed:", e));
  return true;
}
