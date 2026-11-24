import { query, queryOne, getPool } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import type { AdminSession } from "@/lib/auth/adminSession";
import { getOrderAllowedCustomerGroupCodes, getAllowedBrandCodes } from "@/lib/adminScope";
import { getSapSoHeaders, getArSummaries, type SapSoHeader, type ArSummary } from "@/lib/soApproval/sapData";
import { loadOrderForChecks, loadSapSoForChecks, runApprovalChecks, type CheckResult } from "@/lib/soApproval/checks";
import { userSapRequest, getUserSapSession, SapSessionExpiredError } from "@/lib/sap-b1/userSession";
import { ensureUserSapSession, getSapCredentialStatus, sapRequestAsUser, SapPasswordInvalidError } from "@/lib/sap-b1/userCredentials";
import { getSapClient } from "@/lib/sap-b1/client";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import {
  notifyApprovalNeeded, notifySubmitters, notifySafely, markNotificationsRead, unreadDocEntries, markApprovalProcessed, markProcessedExcept,
  docsWithOpenRequest,
} from "@/lib/staffNotifications";
import { loadStaffSession } from "@/lib/auth/adminSession";
import {
  actionableStages, isAuthorizerOf, progressForPortalOrder,
  type ProcedureProgress, type StageDecision,
} from "@/lib/soApproval/sapProcedure";
import {
  getSoApprovalRequests, progressFromRequest, arStatusOf, myPendingLine, approvalCompletes, searchSoApprovals,
  getSoScopeFacts, getSoLinesForDisplay, searchSoHeaders, type SoDisplayLine, type SapApprovalRequest, type SoApprovalListRow,
} from "@/lib/soApproval/sapApprovalRequests";

/**
 * SO Approval (AR / Credit Control) — SAP's own Sales Order approval
 * requests, worked on like SAP's Approval Status / Decision Report:
 *
 * - The list is every SAP Sales Order approval request (created in SAP by a
 *   salesperson, or pushed from the portal — the push creates the SO with
 *   U_DataStatus I and then updates it to C, which raises the request when an
 *   Approval Template applies), with DocDate on/after Settings → "Approve SO
 *   from date", inside the user's data permissions (customer groups via
 *   OCRD.U_CusGrp01/02/03, brands via ORDR.U_ProdBrand / line brands).
 * - An Accountant (admin_users.sap_user_code) sees the requests that have a
 *   line for their SAP user; "Pending" = waiting for their decision in the
 *   current stage. Super Admin sees all, read only.
 * - Approve / Reject = a decision on the SAP request as the Accountant's own
 *   SAP user (saved login, My Profile); after the final approval the drafted
 *   change (U_DataStatus C) is applied to the Sales Order.
 * - Everything is keyed by SAP DocEntry; a portal order (orders.sap_doc_entry)
 *   is linked when there is one — its ar_status mirrors the request.
 * - Undo approval: the final approver (or Super Admin) can take an approval
 *   back while the SO isn't on an AR Invoice — U_DataStatus goes back to I and
 *   the SO waits in the same stage again. An SAP request can't be un-approved
 *   through the Service Layer, so an undone SAP request is "reopened" in the
 *   portal (so_approvals rows with its wdd_code): the stage's authorizers
 *   decide again here, and approving sets U_DataStatus C directly.
 */
export type ArStatus = "pending" | "approved" | "rejected";
export type QueueStatus = ArStatus | "all";
/** How a decision was made: one SO screen, the multi-SO bar, Auto SO Approval, or in the SAP client. */
export type DecisionMethod = "manual" | "bulk" | "auto";

export interface ProcedureSummary {
  state: "approved" | "pending" | "rejected";
  templates: string[];
  stage: string | null;
  waitingFor: string[];
  waitingOnMe: boolean;
  noTemplate: boolean;
  warning: string | null;
  requestNo: number | null;
}

const lc = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

async function mySapUserCode(session: AdminSession): Promise<string | null> {
  if (!session.adminId) return null;
  const r = await queryOne<{ sap_user_code: string | null }>(
    `SELECT sap_user_code FROM admin_users WHERE company_id = ? AND id = ?`, [getCompanyId(), session.adminId]
  );
  return r?.sap_user_code?.trim() || null;
}

async function approvalFromDate(): Promise<string | null> {
  const r = await queryOne<{ d: string | null }>(
    `SELECT DATE_FORMAT(so_approval_from_date, '%Y-%m-%d') AS d FROM sync_schedule_settings WHERE company_id = ?`, [getCompanyId()]
  ).catch(() => null);
  return r?.d ?? null;
}

function summarize(req: SapApprovalRequest | null, p: ProcedureProgress, me: string | null): ProcedureSummary {
  const cur = p.templates.filter((t) => t.current).map((t) => `${t.current!.name} (${t.current!.sortId}/${t.stages.length})`);
  return {
    state: p.state, templates: p.templates.map((t) => t.name), stage: cur.length ? cur.join(", ") : null,
    waitingFor: p.waitingFor, waitingOnMe: !!myPendingLine(req, me), noTemplate: p.noTemplate, warning: null,
    requestNo: req?.wddCode ?? null,
  };
}

/** Portal orders linked to these SAP Sales Orders (by DocEntry). */
async function portalOrdersFor(docEntries: number[]) {
  if (docEntries.length === 0) return new Map<number, { id: number; order_number: string; ar_status: ArStatus | null }>();
  const rows = await query<{ id: number; order_number: string; ar_status: ArStatus | null; sap_doc_entry: number }[]>(
    `SELECT id, order_number, ar_status, sap_doc_entry FROM orders WHERE company_id = ? AND sap_doc_entry IN (${docEntries.map(() => "?").join(",")})`,
    [getCompanyId(), ...docEntries]
  );
  return new Map(rows.map((r) => [Number(r.sap_doc_entry), r]));
}

/** Keep a linked portal order's ar_status in step with the SO's live approval state (it may have been decided in SAP itself). */
async function syncPortalStatus(order: { id: number; ar_status: ArStatus | null } | undefined | null, live: ArStatus | null) {
  if (!order || !live) return;
  if (live === order.ar_status) return;
  await query(
    `UPDATE orders SET ar_status = ?, ar_decided_at = IF(? = 'pending', NULL, COALESCE(ar_decided_at, NOW())) WHERE company_id = ? AND id = ?`,
    [live, live, getCompanyId(), order.id]
  );
  order.ar_status = live;
}

// ── Portal-run approval (portal orders) ────────────────────────────────
// SAP doesn't raise approval requests for Service Layer updates with
// query-based templates, so for a portal order whose push matched SAP
// templates (orders.sap_approval_templates) the portal runs those templates'
// stages itself: decisions in so_approvals (wtm/wst; superseded = an earlier
// round that ended in rejection, or an undone approval), stages / authorizers
// / MaxReqr read live from SAP; the final approval sets U_DataStatus C as the
// deciding user.

interface PortalRun { id: number; order_number: string; ar_status: ArStatus | null; sap_doc_entry: number; templates: number[] }

const parseCodes = (v: unknown): number[] => {
  try {
    const a = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch { return []; }
};

/** Portal orders whose approval the portal runs (newest first), optionally just these SAP DocEntries. */
async function portalRunOrders(docEntries?: number[]): Promise<Map<number, PortalRun>> {
  if (docEntries && docEntries.length === 0) return new Map();
  const rows = await query<{ id: number; order_number: string; ar_status: ArStatus | null; sap_doc_entry: number; sap_approval_templates: unknown }[]>(
    `SELECT id, order_number, ar_status, sap_doc_entry, sap_approval_templates FROM orders
      WHERE company_id = ? AND sap_doc_entry IS NOT NULL AND sap_approval_templates IS NOT NULL AND ar_status IS NOT NULL
        ${docEntries ? `AND sap_doc_entry IN (${docEntries.map(() => "?").join(",")})` : ""}
      ORDER BY id DESC LIMIT 500`,
    [getCompanyId(), ...(docEntries ?? [])]
  );
  const out = new Map<number, PortalRun>();
  for (const r of rows) {
    const de = Number(r.sap_doc_entry);
    if (!out.has(de)) out.set(de, { id: r.id, order_number: r.order_number, ar_status: r.ar_status, sap_doc_entry: de, templates: parseCodes(r.sap_approval_templates) });
  }
  return out;
}

/** This round's stage decisions per SO (superseded = 0), plus who ever decided on it. */
async function loadDecisions(docEntries: number[]): Promise<Map<number, { current: StageDecision[]; deciders: Set<number> }>> {
  const out = new Map<number, { current: StageDecision[]; deciders: Set<number> }>();
  if (docEntries.length === 0) return out;
  const rows = await query<{ sap_doc_entry: number; wtm_code: number | null; wst_code: number | null; decision: "approved" | "rejected"; sap_user_code: string | null; admin_label: string | null; admin_user_id: number | null; superseded: number; created_at: string }[]>(
    `SELECT sap_doc_entry, wtm_code, wst_code, decision, sap_user_code, admin_label, admin_user_id, superseded, created_at
       FROM so_approvals WHERE company_id = ? AND sap_doc_entry IN (${docEntries.map(() => "?").join(",")}) ORDER BY id`,
    [getCompanyId(), ...docEntries]
  );
  for (const r of rows) {
    const de = Number(r.sap_doc_entry);
    let e = out.get(de);
    if (!e) { e = { current: [], deciders: new Set() }; out.set(de, e); }
    if (r.admin_user_id) e.deciders.add(r.admin_user_id);
    if (!r.superseded) e.current.push({ wtmCode: r.wtm_code, wstCode: r.wst_code, decision: r.decision, sapUserCode: r.sap_user_code, adminLabel: r.admin_label, at: r.created_at });
  }
  return out;
}

function summarizePortal(p: ProcedureProgress, me: string | null): ProcedureSummary {
  const cur = p.templates.filter((t) => t.current).map((t) => `${t.current!.name} (${t.current!.sortId}/${t.stages.length})`);
  return {
    state: p.state, templates: p.templates.map((t) => t.name), stage: cur.length ? cur.join(", ") : null,
    waitingFor: p.waitingFor, waitingOnMe: actionableStages(p, me).length > 0, noTemplate: p.noTemplate, warning: null, requestNo: null,
  };
}

async function decideInfoPortal(me: string | null, run: PortalRun, current: StageDecision[], p: ProcedureProgress): Promise<DecideInfo> {
  const none = (reason: string): DecideInfo => ({ canDecide: false, reason, stages: [], completes: false, override: false, requestNo: null });
  if (run.ar_status !== "pending" && run.ar_status !== "rejected") return none(run.ar_status === "approved" ? "Already approved." : "This order isn't waiting for approval.");
  if (p.noTemplate) return none("The SAP approval template recorded for this order no longer exists (or isn't active) in SAP.");
  const stages = actionableStages(p, me);
  if (stages.length) {
    const after = await progressForPortalOrder(run.templates, current.concat(stages.map((st) => ({
      wtmCode: st.wtmCode, wstCode: st.wstCode, decision: "approved" as const, sapUserCode: me, adminLabel: null, at: "",
    }))));
    return { canDecide: true, reason: null, stages, completes: after.state === "approved", override: false, requestNo: null };
  }
  if (!me) return none("No SAP user is linked to your account.");
  return none(p.waitingFor.length ? `Waiting for ${p.waitingFor.join(", ")} (current stage).` : "You have already decided in this stage.");
}

// ── Reopened SAP requests (an SAP-approved SO whose approval was undone) ──

interface SapModeRow {
  id: number; sap_doc_entry: number; wdd_code: number | null; wtm_code: number | null; wst_code: number | null;
  decision: "approved" | "rejected"; method: string; admin_user_id: number; admin_label: string | null;
  sap_user_code: string | null; undone_at: Date | string | null; created_at: Date | string;
}

/** Run `fn` in one DB transaction (all its writes, or none). */
async function inTransaction<T>(fn: (q: (sql: string, params: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(async (sql, params) => (await conn.execute(sql, params as (string | number | boolean | null)[]))[0]);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}

const ms = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : 0);

/**
 * The portal rows of SAP request `req`: those recorded with its wdd_code, and
 * decisions saved before wdd_code existed (NULL) for the same template from
 * the day the request was created.
 */
function rowsOfRequest(req: SapApprovalRequest, rows: SapModeRow[]): SapModeRow[] {
  const since = req.createdAt ? ms(`${req.createdAt.slice(0, 10)}T00:00:00Z`) - 24 * 3600 * 1000 : 0;
  return rows.filter((r) => r.wdd_code !== null
    ? Number(r.wdd_code) === req.wddCode
    : r.wtm_code === req.wtmCode && ms(r.created_at) >= since);
}

/** Portal rows that may belong to SAP approval requests, per SO, oldest first. */
async function sapModeRows(docEntries: number[]): Promise<Map<number, SapModeRow[]>> {
  const out = new Map<number, SapModeRow[]>();
  if (docEntries.length === 0) return out;
  const rows = await query<SapModeRow[]>(
    `SELECT id, sap_doc_entry, wdd_code, wtm_code, wst_code, decision, method, admin_user_id, admin_label, sap_user_code, undone_at, created_at
       FROM so_approvals WHERE company_id = ? AND sap_doc_entry IN (${docEntries.map(() => "?").join(",")}) ORDER BY id`,
    [getCompanyId(), ...docEntries]
  );
  for (const r of rows) {
    const de = Number(r.sap_doc_entry);
    if (!out.has(de)) out.set(de, []);
    out.get(de)!.push(r);
  }
  return out;
}

/**
 * A reopened SAP request: approved in SAP, its final approval undone in the
 * portal. The stage it was undone in needs as many new approvals as were
 * undone (so MaxReqr still holds: approvals still standing keep counting),
 * from authorizers who aren't already standing approvers; a rejection after
 * the undo is final, as for an SAP request.
 */
interface Reopen {
  wddCode: number; wstCode: number; state: ArStatus;
  /** Approvals needed after the undo (= approvals undone). */
  needed: number;
  /** SAP users who approved in the portal since the undo. */
  reApprovedBy: string[];
  /** SAP users whose approval of that stage still stands (not undone). */
  standing: string[];
}

function reopenOf(req: SapApprovalRequest | null, allRows: SapModeRow[]): Reopen | null {
  if (!req || arStatusOf(req) !== "approved") return null;
  const rs = rowsOfRequest(req, allRows);
  const undone = rs.filter((r) => r.undone_at);
  if (undone.length === 0) return null;
  // The latest undo action (one undo marks / inserts its rows with the same undone_at).
  const lastAt = Math.max(...undone.map((r) => ms(r.undone_at)));
  const batch = undone.filter((r) => Math.abs(ms(r.undone_at) - lastAt) < 2000);
  const wstCode = batch[batch.length - 1].wst_code ?? req.currStep;
  const batchMaxId = Math.max(...batch.map((b) => b.id));
  const after = rs.filter((r) => r.id > batchMaxId && !r.undone_at && (r.wst_code ?? wstCode) === wstCode);
  const undoneUsers = new Set(undone.filter((r) => (r.wst_code ?? wstCode) === wstCode).map((r) => lc(r.sap_user_code)));
  const reApprovedBy = after.filter((r) => r.decision === "approved").map((r) => r.sap_user_code ?? "");
  const reSet = new Set(reApprovedBy.map(lc));
  const standing = [...new Set(req.lines
    .filter((l) => l.stepCode === wstCode && l.status === "Y" && !undoneUsers.has(lc(l.userCode)) && !reSet.has(lc(l.userCode)))
    .map((l) => l.userCode))];
  const state: ArStatus = after.some((r) => r.decision === "rejected") ? "rejected"
    : reApprovedBy.length >= batch.length ? "approved" : "pending";
  return { wddCode: req.wddCode, wstCode, state, needed: batch.length, reApprovedBy, standing };
}

function reopenProgress(req: SapApprovalRequest, ro: Reopen): ProcedureProgress {
  const p = progressFromRequest(req);
  if (ro.state === "approved") return p;
  const t = p.templates[0];
  const done = new Set([...ro.standing, ...ro.reApprovedBy].map(lc));
  const authorizers = [...new Set(req.lines.filter((l) => l.stepCode === ro.wstCode && !done.has(lc(l.userCode))).map((l) => l.userCode))];
  const stages = t.stages.map((st) => st.wstCode === ro.wstCode
    ? { ...st, approvals: st.approvals.filter((a) => done.has(lc(a.sapUserCode))), state: ro.state === "pending" ? "current" as const : "rejected" as const }
    : st);
  return {
    ...p, state: ro.state, waitingFor: ro.state === "pending" ? authorizers : [],
    templates: [{ ...t, stages, state: ro.state, current: stages.find((x) => x.state === "current") ?? null }],
  };
}

function decideInfoReopened(me: string | null, req: SapApprovalRequest, ro: Reopen, p: ProcedureProgress): DecideInfo {
  const none = (reason: string): DecideInfo => ({ canDecide: false, reason, stages: [], completes: false, override: false, requestNo: req.wddCode });
  if (ro.state === "approved") return none("Already approved.");
  if (ro.state === "rejected") return none("Rejected after its approval was undone — the rejection is final.");
  if (!me) return none("No SAP user is linked to your account.");
  if (!p.waitingFor.some((u) => lc(u) === lc(me))) {
    return none(req.lines.some((l) => l.stepCode === ro.wstCode && lc(l.userCode) === lc(me))
      ? "Your approval in this stage still stands — waiting for another authorizer."
      : `Waiting for ${p.waitingFor.join(", ")} — the approval was undone.`);
  }
  const st = p.templates[0]?.stages.find((x) => x.wstCode === ro.wstCode);
  return {
    canDecide: true, reason: null, override: false, requestNo: req.wddCode, completes: ro.reApprovedBy.length + 1 >= ro.needed,
    stages: [{ wtmCode: req.wtmCode, wstCode: ro.wstCode, templateName: req.templateName ?? `Template ${req.wtmCode}`, stageName: st?.name ?? `Stage ${ro.wstCode}` }],
  };
}

/** SOs whose approval was ever undone — Auto SO Approval leaves those to a person. */
export async function docsWithUndo(docEntries: number[]): Promise<Set<number>> {
  if (docEntries.length === 0) return new Set();
  const rows = await query<{ sap_doc_entry: number }[]>(
    `SELECT DISTINCT sap_doc_entry FROM so_approvals WHERE company_id = ? AND undone_at IS NOT NULL AND sap_doc_entry IN (${docEntries.map(() => "?").join(",")})`,
    [getCompanyId(), ...docEntries]
  );
  return new Set(rows.map((r) => Number(r.sap_doc_entry)));
}

export interface QueueFilters {
  status: QueueStatus;
  brand?: string;
  dateFrom?: string;
  dateTo?: string;
  soNo?: string;
  bp?: string;
  creator?: string;
}

export interface QueueRow {
  docEntry: number;
  docNum: number;
  docNo: string | null;
  docDate: string | null;
  status: ArStatus;
  requestedAt: string | null;
  cardCode: string;
  customerName: string | null;
  mstCode: string | null;
  brands: string[];
  creator: string | null;
  creatorName: string | null;
  totalExclTax: number;
  totalInclTax: number;
  remarks: string | null;
  sapDataStatus: string | null;
  portalOrder: { id: number; orderNumber: string } | null;
  ar: { openInvoices: number; overdueInvoices: number; overdueAmount: number; oldestOverdueDays: number; creditAvailable: number | null } | null;
  sapApproval: ProcedureSummary;
  /** The approval was undone earlier (it's waiting again / was decided again). */
  reopened: boolean;
  /** An unread notification about this SO for the viewer (flashing NEW). */
  isNew?: boolean;
}

export interface QueueResult {
  rows: QueueRow[];
  fromDate: string | null;
  /** Filter choices: the user's brands, and the creators found in this result. */
  options: { brands: string[] | null; creators: { code: string; name: string | null }[] };
  me: string | null;
  /** The user's SAP login is saved (or live) — approving needs it. */
  sapReady: boolean;
}

export async function listApprovalQueue(session: AdminSession, filters: QueueFilters): Promise<QueueResult> {
  const me = await mySapUserCode(session);
  const fromDate = await approvalFromDate();
  const brands = getAllowedBrandCodes(session);
  const sapReady = !!session.adminId && (!!getUserSapSession(session.adminId) || (await getSapCredentialStatus(session.adminId)).hasPassword);
  const empty: QueueResult = { rows: [], fromDate, options: { brands: brands && [...brands].sort(), creators: [] }, me, sapReady };
  // Not a Super Admin: only via SAP approval lines, so a linked SAP user is needed.
  if (!session.isSuperAdmin && !me) return empty;
  const groups = await getOrderAllowedCustomerGroupCodes(session);
  if (groups.size === 0) return empty;
  const headFilters = {
    fromDate, dateFrom: filters.dateFrom, dateTo: filters.dateTo, brand: filters.brand, soNo: filters.soNo, bp: filters.bp,
    creator: filters.creator, groupCodes: groups, brandCodes: brands,
  };

  // SAP requests approved in SAP whose approval was undone in the portal — they follow the portal's state.
  // Every SO with an undone approval (no cap — an SO missing here would show SAP's "approved" while it's
  // back at I). A failed SAP lookup fails the list rather than showing wrong states.
  const undoneDocs = (await query<{ sap_doc_entry: number }[]>(
    `SELECT DISTINCT sap_doc_entry FROM so_approvals WHERE company_id = ? AND undone_at IS NOT NULL AND sap_doc_entry IS NOT NULL`,
    [getCompanyId()]
  )).map((r) => Number(r.sap_doc_entry));
  const [undoneReqs, undoneRows] = await Promise.all([getSoApprovalRequests(undoneDocs), sapModeRows(undoneDocs)]);
  const reopened = new Map<number, { req: SapApprovalRequest; ro: Reopen; p: ProcedureProgress }>();
  for (const de of undoneDocs) {
    const req = undoneReqs.get(de) ?? null;
    const ro = reopenOf(req, undoneRows.get(de) ?? []);
    if (req && ro) reopened.set(de, { req, ro, p: reopenProgress(req, ro) });
  }

  const list = (await searchSoApprovals({
    ...headFilters, status: filters.status,
    sapUserCode: session.isSuperAdmin ? null : me,
    // Super Admin: config customer groups (getOrderAllowedCustomerGroupCodes), all brands.
  })).filter((r) => !reopened.has(r.docEntry));

  const reopenCands = [...reopened.entries()].filter(([, e]) => filters.status === "all" || e.ro.state === filters.status).map(([de]) => de);
  const reopenHeads = (await searchSoHeaders(reopenCands, headFilters)).filter((h) => {
    if (session.isSuperAdmin) return true;
    const e = reopened.get(h.docEntry)!;
    return e.ro.state === "pending" ? e.p.waitingFor.some((u) => lc(u) === lc(me)) : e.req.lines.some((l) => lc(l.userCode) === lc(me));
  });

  // Portal orders whose approval the portal runs (no SAP request) — same filters.
  const runs = await portalRunOrders();
  // An SO that SAP itself has an approval request for (e.g. it was set to C in the SAP client) follows
  // SAP's request — it's listed from there, not twice.
  const withSapRequest = await getSoApprovalRequests([...runs.keys()]).catch(() => new Map<number, SapApprovalRequest>());
  const runCands = [...runs.values()].filter((r) => !withSapRequest.has(r.sap_doc_entry) && (filters.status === "all" || r.ar_status === filters.status));
  const portalHeads = await searchSoHeaders(runCands.map((r) => r.sap_doc_entry), headFilters);
  const decs = await loadDecisions(portalHeads.map((h) => h.docEntry));
  const portalEntries: { r: SoApprovalListRow; run: PortalRun; p: ProcedureProgress }[] = [];
  for (const h of portalHeads) {
    const run = runs.get(h.docEntry)!;
    const dec = decs.get(h.docEntry) ?? { current: [], deciders: new Set<number>() };
    const p = await progressForPortalOrder(run.templates, dec.current);
    const visible = session.isSuperAdmin
      || (run.ar_status === "pending" ? actionableStages(p, me).length > 0
        : isAuthorizerOf(p, me) || (!!session.adminId && dec.deciders.has(session.adminId)));
    if (visible) portalEntries.push({ r: h, run, p });
  }
  const undoneEver = await docsWithUndo(portalEntries.map((e) => e.r.docEntry));

  const docs = [...list.map((r) => r.docEntry), ...reopenHeads.map((h) => h.docEntry)];
  const [reqs, portal, ar] = await Promise.all([
    getSoApprovalRequests(list.map((r) => r.docEntry)),
    portalOrdersFor(docs),
    getArSummaries([...list, ...reopenHeads, ...portalEntries.map((e) => e.r)].map((r) => r.cardCode), false, brands).catch(() => new Map<string, ArSummary>()),
  ]);
  const arOf = (card: string) => {
    const a = ar.get(card);
    return a ? { openInvoices: a.openInvoiceCount, overdueInvoices: a.overdueInvoiceCount, overdueAmount: a.overdueAmount, oldestOverdueDays: a.oldestOverdueDays, creditAvailable: a.creditAvailable } : null;
  };
  const baseRow = (r: SoApprovalListRow) => ({
    docEntry: r.docEntry, docNum: r.docNum, docNo: r.docNo, docDate: r.docDate,
    requestedAt: r.requestedAt, cardCode: r.cardCode, customerName: r.cardName, mstCode: r.taxCode, brands: r.brands,
    creator: r.creator, creatorName: r.creatorName, totalExclTax: r.totalExclTax, totalInclTax: r.totalInclTax,
    remarks: r.comments, sapDataStatus: r.dataStatus, ar: arOf(r.cardCode),
  });
  const rows: QueueRow[] = [];
  for (const r of list) {
    const req = reqs.get(r.docEntry) ?? null;
    const po = portal.get(r.docEntry);
    await syncPortalStatus(po, req ? arStatusOf(req) : null);
    rows.push({
      ...baseRow(r), status: req ? arStatusOf(req) : "pending",
      portalOrder: po ? { id: po.id, orderNumber: po.order_number } : null,
      sapApproval: summarize(req, progressFromRequest(req), me), reopened: false,
    });
  }
  for (const h of reopenHeads) {
    const e = reopened.get(h.docEntry)!;
    const po = portal.get(h.docEntry);
    await syncPortalStatus(po, e.ro.state);
    const s = summarize(e.req, e.p, me);
    rows.push({
      ...baseRow(h), status: e.ro.state,
      portalOrder: po ? { id: po.id, orderNumber: po.order_number } : null,
      sapApproval: { ...s, waitingOnMe: e.ro.state === "pending" && e.p.waitingFor.some((u) => lc(u) === lc(me)) }, reopened: true,
    });
  }
  for (const e of portalEntries) {
    rows.push({
      ...baseRow(e.r), status: (e.run.ar_status ?? "pending") as ArStatus,
      portalOrder: { id: e.run.id, orderNumber: e.run.order_number },
      sapApproval: summarizePortal(e.p, me), reopened: undoneEver.has(e.r.docEntry),
    });
  }
  rows.sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? "") || b.docEntry - a.docEntry);
  if (session.adminId) {
    const fresh = await unreadDocEntries(session.adminId, rows.map((r) => r.docEntry)).catch(() => new Set<number>());
    for (const r of rows) r.isNew = fresh.has(r.docEntry);
    // The full Pending list (no other filter) is the truth of what waits for this user: the bell's
    // "to approve" items are made to match it — done ones off, and any SO waiting for them that has no
    // notification yet (pushed before notifications, approved in no other way…) added.
    const unfiltered = !filters.brand && !filters.dateFrom && !filters.dateTo && !filters.soNo && !filters.bp && !filters.creator;
    if (filters.status === "pending" && unfiltered && !session.isSuperAdmin && me) {
      const waiting = rows.filter((r) => r.status === "pending" && r.sapApproval.waitingOnMe).map((r) => r.docEntry);
      await markProcessedExcept(session.adminId, waiting).catch(() => undefined);
      const have = await docsWithOpenRequest(session.adminId, waiting).catch(() => new Set<number>(waiting));
      for (const de of waiting.filter((d) => !have.has(d))) {
        await notifyApprovalNeeded(de, [me], { reason: "Waiting for your approval" }).catch(() => 0);
      }
      lastToDoSync.set(session.adminId, Date.now());
    }
  }
  const creators = new Map<string, string | null>();
  for (const r of rows) if (r.creator && !creators.has(r.creator)) creators.set(r.creator, r.creatorName);
  return {
    rows: rows.slice(0, 500), fromDate, me, sapReady,
    options: { brands: brands && [...brands].sort(), creators: [...creators].map(([code, name]) => ({ code, name })).sort((x, y) => x.code.localeCompare(y.code)) },
  };
}

/** Can this user decide on the SO now, in which stage, and would it release it? */
export interface DecideInfo {
  canDecide: boolean;
  reason: string | null;
  stages: { wtmCode: number; wstCode: number; templateName: string; stageName: string }[];
  /** Approving now completes the request, so SAP applies U_DataStatus C to the Sales Order. */
  completes: boolean;
  /** Always false (deciding is the SAP authorizers'); kept for the screen's shape. */
  override: boolean;
  requestNo: number | null;
}

function decideInfo(session: AdminSession, me: string | null, req: SapApprovalRequest | null, p: ProcedureProgress): DecideInfo {
  const none = (reason: string): DecideInfo => ({ canDecide: false, reason, stages: [], completes: false, override: false, requestNo: req?.wddCode ?? null });
  if (!req) return none("No SAP approval request for this Sales Order.");
  if (req.status !== "W") return none(`The SAP approval request #${req.wddCode} is ${arStatusOf(req) === "approved" ? "approved" : req.status === "C" ? "cancelled" : "not approved"}.`);
  const line = myPendingLine(req, me);
  if (line) {
    const st = p.templates[0]?.stages.find((x) => x.wstCode === req.currStep);
    return {
      canDecide: true, reason: null, override: false, requestNo: req.wddCode, completes: approvalCompletes(req),
      stages: [{ wtmCode: req.wtmCode, wstCode: req.currStep, templateName: req.templateName ?? `Template ${req.wtmCode}`, stageName: st?.name ?? `Stage ${req.currStep}` }],
    };
  }
  if (!me) return none(session.isSuperAdmin ? `Waiting for ${p.waitingFor.join(", ")} in SAP — only the stage's SAP authorizers can decide.` : "No SAP user is linked to your account.");
  return none(p.waitingFor.length ? `Waiting for ${p.waitingFor.join(", ")} (current stage in SAP).` : "You have already decided in this stage.");
}

/** The SO is inside the user's data permissions (customer groups + brands)? */
async function soInScope(session: AdminSession, docEntry: number) {
  const facts = await getSoScopeFacts(docEntry);
  if (!facts) return null;
  const groups = await getOrderAllowedCustomerGroupCodes(session);
  if (!facts.groups.some((g) => groups.has(g))) return null;
  const brands = getAllowedBrandCodes(session);
  if (brands && !facts.brands.some((b) => brands.has(b))) return null;
  return facts;
}

// ── Undo approval ──────────────────────────────────────────────────────

export interface UndoInfo {
  canUndo: boolean;
  /** Why not (when canUndo is false and the SO is approved). */
  reason: string | null;
  /** Who made the final approval (portal user / SAP user). */
  approvedBy: string | null;
  /** AR Invoices the SO is copied to (directly or through a Delivery). */
  invoices: number[];
}

/** SAP-side state that blocks an undo: AR Invoices made from the SO (directly or via a Delivery), closed / cancelled SO. */
async function soInvoiceState(docEntry: number): Promise<{ invoices: number[]; docStatus: string | null; canceled: boolean; dataStatus: string | null }> {
  const s = `"${getHanaSchema()}"`;
  const de = Number(docEntry);
  const [head] = await queryHana<Record<string, unknown>>(
    `SELECT "DocStatus", "CANCELED", "U_DataStatus" FROM ${s}."ORDR" WHERE "DocEntry" = ${de}`
  );
  const inv = await queryHana<Record<string, unknown>>(
    `SELECT DISTINCT H."DocNum" FROM ${s}."INV1" I JOIN ${s}."OINV" H ON H."DocEntry" = I."DocEntry"
      WHERE H."CANCELED" = 'N'
        AND ((I."BaseType" = 17 AND I."BaseEntry" = ${de})
          OR (I."BaseType" = 15 AND I."BaseEntry" IN (SELECT D."DocEntry" FROM ${s}."DLN1" D WHERE D."BaseType" = 17 AND D."BaseEntry" = ${de})))`
  );
  return {
    invoices: inv.map((r) => Number(r.DocNum)),
    docStatus: head ? String(head.DocStatus) : null,
    canceled: head ? String(head.CANCELED) !== "N" : false,
    dataStatus: head?.U_DataStatus == null ? null : String(head.U_DataStatus),
  };
}

/** Who made the SO's final approval — what an undo takes back. */
interface FinalApproval {
  mode: "portal" | "sap_portal" | "sap_client";
  adminUserId: number | null;
  label: string;
  sapUserCode: string | null;
  wtmCode: number | null;
  wstCode: number | null;
  /** portal: the approver's rows of this round; sap_portal: the one row. */
  rowIds: number[];
  wddCode: number | null;
}

async function adminIdForSapUser(code: string | null): Promise<number | null> {
  if (!code) return null;
  const r = await queryOne<{ id: number }>(`SELECT id FROM admin_users WHERE company_id = ? AND LOWER(sap_user_code) = LOWER(?)`, [getCompanyId(), code]);
  return r?.id ?? null;
}

async function finalApprovalOf(docEntry: number, req: SapApprovalRequest | null, run: PortalRun | undefined, sapRows: SapModeRow[]): Promise<FinalApproval | null> {
  if (!req && run) {
    if (run.ar_status !== "approved") return null;
    const rows = await query<{ id: number; admin_user_id: number; admin_label: string | null; sap_user_code: string | null; wtm_code: number | null; wst_code: number | null; created_at: Date | string }[]>(
      `SELECT id, admin_user_id, admin_label, sap_user_code, wtm_code, wst_code, created_at FROM so_approvals
        WHERE company_id = ? AND sap_doc_entry = ? AND superseded = 0 AND decision = 'approved' AND undone_at IS NULL ORDER BY id`,
      [getCompanyId(), docEntry]
    );
    const last = rows[rows.length - 1];
    if (!last) return null;
    // Only the final decision: the last approver's row(s) of that decision — the same stage, or the other
    // templates' stages decided in the same action — never their approvals of earlier stages.
    return {
      mode: "portal", adminUserId: last.admin_user_id, label: last.admin_label ?? last.sap_user_code ?? `user ${last.admin_user_id}`,
      sapUserCode: last.sap_user_code, wtmCode: last.wtm_code, wstCode: last.wst_code, wddCode: null,
      rowIds: rows.filter((r) => r.admin_user_id === last.admin_user_id
        && ((r.wtm_code === last.wtm_code && r.wst_code === last.wst_code) || Math.abs(ms(r.created_at) - ms(last.created_at)) < 2000)).map((r) => r.id),
    };
  }
  if (!req || arStatusOf(req) !== "approved") return null;
  const ro = reopenOf(req, sapRows);
  if (ro && ro.state !== "approved") return null;
  // The request's last stage — only an approval there is the final one.
  const lastStage = [...req.stages].sort((a, b) => b.sortId - a.sortId)[0];
  const step = lastStage?.wstCode ?? req.currStep;
  // Approved in the portal: its latest approved row, if that is in the last stage.
  const mine = rowsOfRequest(req, sapRows);
  const last = mine[mine.length - 1];
  if (last && last.decision === "approved" && !last.undone_at && (last.wst_code ?? step) === step) {
    return {
      mode: "sap_portal", adminUserId: last.admin_user_id, label: last.admin_label ?? last.sap_user_code ?? `user ${last.admin_user_id}`,
      sapUserCode: last.sap_user_code, wtmCode: last.wtm_code, wstCode: last.wst_code, wddCode: req.wddCode, rowIds: [last.id],
    };
  }
  // Approved in the SAP client: the last stage's approving line(s).
  const line = req.lines.filter((l) => l.stepCode === step && l.status === "Y").sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  return {
    mode: "sap_client", adminUserId: await adminIdForSapUser(line?.userCode ?? null),
    label: `${line?.userName ?? line?.userCode ?? "?"} (in SAP)`, sapUserCode: line?.userCode ?? null,
    wtmCode: req.wtmCode, wstCode: step, wddCode: req.wddCode, rowIds: [],
  };
}

async function undoInfoFor(session: AdminSession, me: string | null, docEntry: number, fa: FinalApproval | null): Promise<UndoInfo> {
  if (!fa) return { canUndo: false, reason: null, approvedBy: null, invoices: [] };
  const mineToUndo = session.isSuperAdmin || (!!session.adminId && fa.adminUserId === session.adminId)
    || (fa.mode === "sap_client" && !!me && lc(fa.sapUserCode) === lc(me));
  const st = await soInvoiceState(docEntry).catch(() => null);
  const base = { approvedBy: fa.label, invoices: st?.invoices ?? [] };
  if (!mineToUndo) return { ...base, canUndo: false, reason: `Approved by ${fa.label} — only they (or System Admin) can undo it.` };
  if (!st) return { ...base, canUndo: false, reason: "Couldn't read the Sales Order from SAP to check its AR Invoices — try again." };
  if (st.invoices.length) return { ...base, canUndo: false, reason: `Already on AR Invoice ${st.invoices.join(", ")} — can't be undone.` };
  if (st.canceled) return { ...base, canUndo: false, reason: "The Sales Order is cancelled in SAP." };
  if (st.docStatus === "C") return { ...base, canUndo: false, reason: "The Sales Order is closed in SAP." };
  return { ...base, canUndo: true, reason: null };
}

export interface ApprovalDetail {
  order: {
    /** Portal orders.id, or 0 for a Sales Order made in SAP. */
    id: number;
    docEntry: number;
    orderNumber: string;
    source: "portal" | "sap";
    arStatus: ArStatus | null;
    createdAt: string;
    warehouseCode: string | null;
    customerName: string | null; mstCode: string | null; cardCode: string; contactPhone: string | null;
    deliveryAddress: string | null; supervisorName: string | null; createdByStaff: string | null;
    creator: string | null;
    lines: SoDisplayLine[];
  };
  sap: SapSoHeader | null;
  ar: ArSummary | null;
  checks: CheckResult[];
  checkedAt: string;
  history: {
    decision: string; method: string; by: string | null; sapUser: string | null; stage: string | null; superseded: boolean;
    notes: string | null; stepNotes: Record<string, string> | null; at: string;
    undone: { at: string; by: string | null; reason: string | null } | null;
  }[];
  procedure: ProcedureProgress;
  decide: DecideInfo;
  undo: UndoInfo;
  /** The approval was undone earlier. */
  reopened: boolean;
  sapSession: { sapUser: string; expiresAt: number } | null;
  sapAccount: { hasPassword: boolean; updatedAt: string | null };
  sapUserCode: string | null;
  arBrands: string[] | null;
}

/** Checks are re-used for the decision if run within this window (they hit SAP live). */
const CHECK_CACHE_MS = 15 * 60 * 1000;
const g = globalThis as typeof globalThis & { __soApprovalChecksV3?: Map<string, { at: number; checks: CheckResult[] }> };
const checkCache: Map<string, { at: number; checks: CheckResult[] }> = (g.__soApprovalChecksV3 ??= new Map());
/** Per SO AND per Brands scope — step 6 (AR aging) only covers the viewer's brands. */
const checkKey = (docEntry: number, brands: Set<string> | null) => `${docEntry}|${brands === null ? "*" : [...brands].sort().join(",")}`;
const forgetChecks = (docEntry: number) => { for (const k of [...checkCache.keys()]) if (k.startsWith(`${docEntry}|`)) checkCache.delete(k); };
/** Drop the cached checks of an SO whose content changed (order page → Update SAP). */
export function forgetApprovalChecks(docEntry: number): void { forgetChecks(docEntry); }

async function requestFor(docEntry: number): Promise<SapApprovalRequest | null> {
  return (await getSoApprovalRequests([docEntry])).get(docEntry) ?? null;
}

export async function getApprovalDetail(session: AdminSession, docEntry: number, recheck = false): Promise<ApprovalDetail | null> {
  const facts = await soInScope(session, docEntry);
  if (!facts) return null;
  const me = await mySapUserCode(session);
  const req = await requestFor(docEntry);
  const sapRows = req ? (await sapModeRows([docEntry])).get(docEntry) ?? [] : [];
  const ro = reopenOf(req, sapRows);
  // No SAP request: a portal order whose approval the portal runs (SAP templates recorded at push)?
  const run = req ? undefined : (await portalRunOrders([docEntry])).get(docEntry);
  const runDec = run ? (await loadDecisions([docEntry])).get(docEntry) ?? { current: [], deciders: new Set<number>() } : null;
  const progress = run ? await progressForPortalOrder(run.templates, runDec!.current) : req && ro ? reopenProgress(req, ro) : progressFromRequest(req);
  // Only the approvers (SAP request lines / the templates' stage authorizers), those who decided, and Super Admin see it.
  if (!session.isSuperAdmin) {
    const allowed = req ? req.lines.some((l) => lc(l.userCode) === lc(me))
      : run ? isAuthorizerOf(progress, me) || (!!session.adminId && runDec!.deciders.has(session.adminId)) : false;
    if (!allowed) return null;
  }
  const brands = getAllowedBrandCodes(session);
  const companyId = getCompanyId();
  const liveStatus: ArStatus | null = req ? (ro ? ro.state : arStatusOf(req)) : run?.ar_status ?? null;

  const po = await queryOne<{
    id: number; order_number: string; ar_status: ArStatus | null; created_at: string; warehouse_code: string | null;
    mst_code: string | null; contact_phone: string | null; delivery_address: string | null; supervisor_name: string | null; created_by: string | null;
  }>(
    `SELECT o.id, o.order_number, o.ar_status, o.created_at, o.warehouse_code, c.mst_code, o.contact_phone, o.delivery_address,
            o.supervisor_name, COALESCE(a.full_name, a.userid) AS created_by
       FROM orders o
       LEFT JOIN users u ON u.company_id = o.company_id AND u.id = o.user_id
       LEFT JOIN customers c ON c.company_id = o.company_id AND c.sap_card_code = COALESCE(o.sap_card_code, u.sap_card_code)
       LEFT JOIN admin_users a ON a.company_id = o.company_id AND a.id = o.created_by_admin_id
      WHERE o.company_id = ? AND o.sap_doc_entry = ?
      ORDER BY o.id DESC LIMIT 1`,
    [companyId, docEntry]
  );
  if (po && req) await syncPortalStatus(po, liveStatus);

  const [sap, arMap, lines] = await Promise.all([
    getSapSoHeaders([docEntry]).then((m) => m.get(docEntry) ?? null).catch(() => null),
    getArSummaries([facts.cardCode], true, brands).catch(() => null),
    getSoLinesForDisplay(docEntry),
  ]);
  const ar = arMap?.get(facts.cardCode) ?? null;

  const cacheKey = checkKey(docEntry, brands);
  let cached = checkCache.get(cacheKey);
  if (recheck || !cached || Date.now() - cached.at > CHECK_CACHE_MS) {
    // A portal order is checked from its own lines (promotion choice etc.); a SAP-made SO from its SAP lines.
    const forChecks = po ? await loadOrderForChecks(po.id) : await loadSapSoForChecks(docEntry);
    const checks = forChecks ? await runApprovalChecks(forChecks, ar) : [];
    cached = { at: Date.now(), checks };
    checkCache.set(cacheKey, cached);
  }

  const history = await query<{
    decision: string; method: string; admin_label: string | null; sap_user_code: string | null; wtm_code: number | null; wst_code: number | null;
    superseded: number; notes: string | null; step_notes: unknown; created_at: string;
    undone_at: string | null; undone_by_label: string | null; undo_reason: string | null;
  }[]>(
    `SELECT decision, method, admin_label, sap_user_code, wtm_code, wst_code, superseded, notes, step_notes, created_at,
            undone_at, undone_by_label, undo_reason
       FROM so_approvals WHERE company_id = ? AND sap_doc_entry = ? ORDER BY id DESC`,
    [companyId, docEntry]
  );
  const stageName = (wtm: number | null, wst: number | null): string | null => {
    if (wtm === null) return null;
    const t = progress.templates.find((x) => x.wtmCode === wtm);
    const st = t?.stages.find((x) => x.wstCode === wst);
    return t ? `${t.name} · ${st?.name ?? `stage ${wst}`}` : `template ${wtm}`;
  };
  const fa = await finalApprovalOf(docEntry, req, run, sapRows);

  return {
    order: {
      id: po?.id ?? 0, docEntry, orderNumber: po?.order_number ?? sap?.docNo ?? String(sap?.docNum ?? docEntry),
      source: po ? "portal" : "sap", arStatus: liveStatus ?? po?.ar_status ?? null,
      createdAt: po?.created_at ?? sap?.docDate ?? "", warehouseCode: po?.warehouse_code ?? null,
      customerName: sap?.cardName ?? null, mstCode: po?.mst_code ?? ar?.taxCode ?? null, cardCode: facts.cardCode,
      contactPhone: po?.contact_phone ?? null, deliveryAddress: po?.delivery_address ?? null, supervisorName: po?.supervisor_name ?? null,
      createdByStaff: po?.created_by ?? null, creator: facts.creator,
      lines,
    },
    sap, ar: ar && { ...ar, agingRows: [] }, checks: cached.checks, checkedAt: new Date(cached.at).toISOString(),
    history: history.map((h) => ({
      decision: h.decision, method: h.method ?? "manual", by: h.admin_label, sapUser: h.sap_user_code, notes: h.notes,
      stage: stageName(h.wtm_code, h.wst_code), superseded: !!h.superseded,
      stepNotes: (typeof h.step_notes === "string" ? JSON.parse(h.step_notes) : h.step_notes) as Record<string, string> | null,
      at: h.created_at,
      undone: h.undone_at ? { at: h.undone_at, by: h.undone_by_label, reason: h.undo_reason } : null,
    })),
    procedure: progress,
    decide: run ? await decideInfoPortal(me, run, runDec!.current, progress)
      : req && ro ? decideInfoReopened(me, req, ro, progress) : decideInfo(session, me, req, progress),
    undo: await undoInfoFor(session, me, docEntry, fa),
    reopened: !!ro || history.some((h) => h.undone_at),
    sapSession: session.adminId ? getUserSapSession(session.adminId) : null,
    sapAccount: session.adminId ? await getSapCredentialStatus(session.adminId).then((c) => ({ hasPassword: c.hasPassword, updatedAt: c.updatedAt })) : { hasPassword: false, updatedAt: null },
    sapUserCode: me,
    arBrands: brands === null ? null : [...brands].sort(),
  };
}

export class DecisionError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}

/** One Service Layer call as the user, signing in again once with the saved password when SAP dropped the session. */
async function asUser<T>(adminId: number, method: string, endpoint: string, body?: unknown): Promise<T> {
  try {
    return await userSapRequest<T>(adminId, method, endpoint, body);
  } catch (e) {
    if (!(e instanceof SapSessionExpiredError)) throw e;
    try {
      if (!(await ensureUserSapSession(adminId, true))) throw e;
    } catch (e2) {
      if (e2 instanceof SapPasswordInvalidError) throw new DecisionError(e2.message, 428, "sap_password_invalid");
      throw e2;
    }
    return userSapRequest<T>(adminId, method, endpoint, body);
  }
}

/** sapRequestAsUser with the credential errors as DecisionErrors. */
async function asUserCreds<T>(adminId: number, method: string, endpoint: string, body?: unknown): Promise<T> {
  try {
    return await sapRequestAsUser<T>(adminId, method, endpoint, body);
  } catch (e) {
    if (e instanceof SapPasswordInvalidError) throw new DecisionError(e.message, 428, "sap_password_invalid");
    if (e instanceof SapSessionExpiredError) throw new DecisionError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
    throw e;
  }
}

export interface DecisionResult {
  sapUser: string | null;
  outcome: "approved" | "rejected" | "stage_approved" | "stage_rejected";
  waitingFor: string[];
  requestNo: number | null;
  warning: string | null;
}

/**
 * What every decision needs: the checks (cached, or run now), the step notes
 * (approve: one per check that isn't a pass; reject: a reason), and the
 * deciding user's own SAP session, which must be the SAP user of the line.
 */
async function prepareDecision(
  session: AdminSession, docEntry: number, decision: "approved" | "rejected", notes: string, stepNotes: Record<string, string>, me: string | null
) {
  const cached = checkCache.get(checkKey(docEntry, getAllowedBrandCodes(session)));
  const checks: CheckResult[] = cached && Date.now() - cached.at <= CHECK_CACHE_MS ? cached.checks : (await getApprovalDetail(session, docEntry, true))?.checks ?? [];
  const cleanStepNotes: Record<string, string> = Object.fromEntries(Object.entries(stepNotes ?? {}).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v));
  if (decision === "rejected") {
    if (!notes.trim()) throw new DecisionError("Write the reason for rejecting");
  } else {
    const missing = checks.filter((c) => c.status !== "pass" && !cleanStepNotes[c.key]).map((c) => `${c.step}. ${c.title}`);
    if (missing.length) throw new DecisionError(`A checking note is required for: ${missing.join(", ")}`, 400, "note_required");
  }
  // As the Accountant's own SAP user — the live session or a login with the saved password.
  let sapSession: { sapUser: string; expiresAt: number } | null;
  try {
    sapSession = await ensureUserSapSession(session.adminId!);
  } catch (e) {
    if (e instanceof SapPasswordInvalidError) throw new DecisionError(e.message, 428, "sap_password_invalid");
    throw e;
  }
  if (!sapSession) throw new DecisionError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  if (lc(sapSession.sapUser) !== lc(me)) {
    throw new DecisionError(`Signed in to SAP as ${sapSession.sapUser}, but the approval line is for ${me}. Update your SAP user in My Profile.`, 409);
  }
  const checksJson = JSON.stringify(checks.map((c) => ({ key: c.key, step: c.step, title: c.title, status: c.status, summary: c.summary })));
  return { checks, cleanStepNotes, sapSession, checksJson };
}

/**
 * Approve or reject the Sales Order's SAP approval request — exactly what the
 * Approval Status / Decision Report does — as the Accountant's own SAP user.
 * Only a pending line of theirs in the current stage. Approve needs a note
 * for every check that isn't "pass". When SAP marks the request approved,
 * the drafted change is applied to the Sales Order
 * (DraftsService_SaveDraftToDocument; if SAP doesn't, U_DataStatus C is set
 * directly) and verified. The decision is recorded in the portal as soon as
 * SAP has accepted it; a later problem is reported as a warning on it.
 */
async function decideApprovalCore(
  session: AdminSession,
  docEntry: number,
  decision: "approved" | "rejected",
  notes: string,
  stepNotes: Record<string, string>,
  method: DecisionMethod = "manual"
): Promise<DecisionResult> {
  if (!session.adminId) throw new DecisionError("No staff account", 403);
  if (!(await soInScope(session, docEntry))) throw new DecisionError("Sales Order not found", 404);
  const companyId = getCompanyId();
  const me = await mySapUserCode(session);
  const req = await requestFor(docEntry);
  if (!req) return decidePortal(session, docEntry, decision, notes, stepNotes, me, method);
  const ro = reopenOf(req, (await sapModeRows([docEntry])).get(docEntry) ?? []);
  if (ro) return decideReopened(session, docEntry, decision, notes, stepNotes, me, method, req, ro);
  const info = decideInfo(session, me, req, progressFromRequest(req));
  if (!info.canDecide) throw new DecisionError(info.reason ?? "You can't decide on this Sales Order now", 403, "not_your_stage");

  const { cleanStepNotes, sapSession, checksJson } = await prepareDecision(session, docEntry, decision, notes, stepNotes, me);

  // The decision on SAP's request (Approval Status Report → Approved / Not Approved, with remarks).
  const remarks = [notes.trim(), ...Object.entries(cleanStepNotes).filter(([, v]) => v !== notes.trim()).map(([k, v]) => `${k}: ${v}`)]
    .filter(Boolean).join(" | ").slice(0, 254);
  await asUser(session.adminId, "PATCH", `/ApprovalRequests(${req.wddCode})`, {
    ApprovalRequestDecisions: [{ Status: decision === "approved" ? "ardApproved" : "ardNotApproved", Remarks: remarks || undefined }],
  });

  // SAP has the decision now — record it in the portal straight away, whatever happens next.
  const po = await queryOne<{ id: number }>(`SELECT id FROM orders WHERE company_id = ? AND sap_doc_entry = ? ORDER BY id DESC LIMIT 1`, [companyId, docEntry]);
  const ins = await query<{ insertId: number }>(
    `INSERT INTO so_approvals (company_id, order_id, sap_doc_entry, decision, method, admin_user_id, admin_label, sap_user_code, wtm_code, wst_code, wdd_code, checks, step_notes, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, po?.id ?? null, docEntry, decision, method, session.adminId, session.userid || session.email, sapSession.sapUser, req.wtmCode, req.currStep, req.wddCode,
     checksJson, JSON.stringify(cleanStepNotes), notes.trim() || null]
  );
  const approvalId = (ins as unknown as { insertId: number }).insertId;

  let finalState: "approved" | "rejected" | null = null;
  let warning: string | null = null;
  try {
    const after = await asUser<{ Status?: string; IsDraft?: string; DraftEntry?: number }>(session.adminId, "GET", `/ApprovalRequests(${req.wddCode})`);
    // arsGenerated / arsGeneratedByAuthorizer = approved and the document already created.
    finalState = ["arsApproved", "arsGenerated", "arsGeneratedByAuthorizer"].includes(after.Status ?? "") ? "approved"
      : ["arsNotApproved", "arsCancelled"].includes(after.Status ?? "") ? "rejected" : null;

    if (finalState === "approved") {
      // Apply the drafted change (U_DataStatus C) to the Sales Order, as SAP's report does after approval.
      const status = async () => (await getSapSoHeaders([docEntry])).get(docEntry)?.dataStatus ?? null;
      if ((await status()) !== "C") {
        const isDraft = after.IsDraft === "Y" || after.IsDraft === "tYES";
        try {
          if (isDraft && (after.DraftEntry ?? req.draftEntry)) {
            await asUser(session.adminId, "POST", "/DraftsService_SaveDraftToDocument", { Document: { DocEntry: after.DraftEntry ?? req.draftEntry } });
          }
        } catch (e) {
          warning = `SaveDraftToDocument refused (${e instanceof Error ? e.message.slice(0, 160) : String(e)}) — U_DataStatus C set directly`;
        }
        if ((await status()) !== "C") {
          await asUser(session.adminId, "PATCH", `/Orders(${docEntry})`, { U_DataStatus: "C" });
          warning ??= "draft not applied by SAP — U_DataStatus C set directly";
        }
        const now = await status();
        if (now !== "C") warning = `Approved in SAP (request #${req.wddCode}), but the Sales Order is still U_DataStatus ${now ?? "?"} — please check it in SAP.`;
      }
    }
  } catch (e) {
    warning = `Decision saved in SAP (request #${req.wddCode}), but the follow-up failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)} — check the Sales Order in SAP.`;
  }
  if (warning) {
    console.warn(`[Approvals] SO ${docEntry} / request ${req.wddCode}: ${warning}`);
    await query(`UPDATE so_approvals SET notes = CONCAT_WS(' · ', notes, ?) WHERE company_id = ? AND id = ?`, [warning, companyId, approvalId]);
  }
  if (po) {
    const st = finalState ?? "pending";
    await query(
      `UPDATE orders SET ar_status = ?, ar_decided_at = IF(? = 'pending', ar_decided_at, NOW()), ar_decided_by = IF(? = 'pending', ar_decided_by, ?) WHERE company_id = ? AND id = ?`,
      [st, st, st, session.adminId, companyId, po.id]
    );
  }
  forgetChecks(docEntry);
  const latest = finalState ? null : await requestFor(docEntry).catch(() => null);
  return {
    sapUser: sapSession.sapUser,
    outcome: finalState ?? (decision === "approved" ? "stage_approved" : "stage_rejected"),
    waitingFor: latest ? progressFromRequest(latest).waitingFor : [],
    requestNo: req.wddCode,
    warning,
  };
}

/**
 * Decision on a reopened SAP request (approved in SAP, approval undone in the
 * portal): SAP's request can't take another decision, so the portal decides —
 * approve sets U_DataStatus C as the deciding user (first, so a refused
 * update records nothing); reject leaves the SO at I.
 */
async function decideReopened(
  session: AdminSession, docEntry: number, decision: "approved" | "rejected", notes: string, stepNotes: Record<string, string>,
  me: string | null, method: DecisionMethod, req: SapApprovalRequest, ro: Reopen
): Promise<DecisionResult> {
  const companyId = getCompanyId();
  const p = reopenProgress(req, ro);
  const info = decideInfoReopened(me, req, ro, p);
  if (!info.canDecide) throw new DecisionError(info.reason ?? "You can't decide on this Sales Order now", 403, "not_your_stage");
  const { cleanStepNotes, sapSession, checksJson } = await prepareDecision(session, docEntry, decision, notes, stepNotes, me);
  // Release only when this approval brings the stage back to its required approvals.
  const release = decision === "approved" && info.completes;

  let warning: string | null = null;
  if (release) {
    await asUserCreds(session.adminId!, "PATCH", `/Orders(${docEntry})`, { U_DataStatus: "C" });
    const now = (await getSapSoHeaders([docEntry])).get(docEntry)?.dataStatus ?? null;
    if (now !== "C") warning = `Approved, but the Sales Order still shows U_DataStatus ${now ?? "?"} in SAP — please check it.`;
  }
  const arStatus: ArStatus = decision === "rejected" ? "rejected" : release ? "approved" : "pending";
  try {
    await inTransaction(async (q) => {
      const po = (await q(`SELECT id FROM orders WHERE company_id = ? AND sap_doc_entry = ? ORDER BY id DESC LIMIT 1`, [companyId, docEntry]) as { id: number }[])[0];
      await q(
        `INSERT INTO so_approvals (company_id, order_id, sap_doc_entry, decision, method, admin_user_id, admin_label, sap_user_code, wtm_code, wst_code, wdd_code, checks, step_notes, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, po?.id ?? null, docEntry, decision, method, session.adminId, session.userid || session.email, sapSession.sapUser, req.wtmCode, ro.wstCode, req.wddCode,
         checksJson, JSON.stringify(cleanStepNotes), [notes.trim(), warning].filter(Boolean).join(" · ") || null]
      );
      if (po) {
        await q(`UPDATE orders SET ar_status = ?, ar_decided_at = IF(? = 'pending', NULL, NOW()), ar_decided_by = IF(? = 'pending', NULL, ?) WHERE company_id = ? AND id = ?`,
          [arStatus, arStatus, arStatus, session.adminId, companyId, po.id]);
      }
    });
  } catch (e) {
    // The portal couldn't record it: take the release back in SAP so both still say "waiting".
    if (release) {
      await asUserCreds(session.adminId!, "PATCH", `/Orders(${docEntry})`, { U_DataStatus: "I" }).catch((e2) => {
        console.error(`[Approvals] SO ${docEntry}: released in SAP but not recorded, and resetting to I failed:`, e2);
      });
    }
    throw new DecisionError(`The decision couldn't be saved (${e instanceof Error ? e.message.slice(0, 160) : String(e)})${release ? " — the Sales Order was set back to I in SAP" : ""}. Try again.`, 500);
  }
  forgetChecks(docEntry);
  return {
    sapUser: sapSession.sapUser,
    outcome: decision === "rejected" ? "rejected" : release ? "approved" : "stage_approved",
    waitingFor: release || decision === "rejected" ? [] : p.waitingFor.filter((u) => lc(u) !== lc(me)),
    requestNo: req.wddCode, warning,
  };
}

/**
 * Decision on a portal order whose approval the portal runs (no SAP request):
 * in the current stage(s) of its SAP templates where this user is an
 * authorizer. The last approval sets U_DataStatus C in SAP as this user; a
 * rejection reaching MaxRejReqr rejects the order (SO stays I) and ends the
 * round — a later re-approval starts at the first stage again.
 */
async function decidePortal(
  session: AdminSession, docEntry: number, decision: "approved" | "rejected", notes: string, stepNotes: Record<string, string>,
  me: string | null, method: DecisionMethod
): Promise<DecisionResult> {
  const companyId = getCompanyId();
  const run = (await portalRunOrders([docEntry])).get(docEntry);
  if (!run) throw new DecisionError("No approval is waiting for this Sales Order.", 403, "not_your_stage");
  const dec = (await loadDecisions([docEntry])).get(docEntry) ?? { current: [], deciders: new Set<number>() };
  const p = await progressForPortalOrder(run.templates, dec.current);
  const info = await decideInfoPortal(me, run, dec.current, p);
  if (!info.canDecide) throw new DecisionError(info.reason ?? "You can't decide on this Sales Order now", 403, "not_your_stage");

  const { cleanStepNotes, sapSession, checksJson } = await prepareDecision(session, docEntry, decision, notes, stepNotes, me);

  // Record the decision (one row per stage decided).
  for (const st of info.stages) {
    await query(
      `INSERT INTO so_approvals (company_id, order_id, sap_doc_entry, decision, method, admin_user_id, admin_label, sap_user_code, wtm_code, wst_code, checks, step_notes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, run.id, docEntry, decision, method, session.adminId, session.userid || session.email, sapSession.sapUser, st.wtmCode, st.wstCode,
       checksJson, JSON.stringify(cleanStepNotes), notes.trim() || null]
    );
  }
  const after = await progressForPortalOrder(run.templates, dec.current.concat(info.stages.map((st) => ({
    wtmCode: st.wtmCode, wstCode: st.wstCode, decision, sapUserCode: sapSession.sapUser, adminLabel: null, at: "",
  }))));
  const finalState: "approved" | "rejected" | null = after.state === "pending" ? null : after.state;

  let warning: string | null = null;
  if (finalState === "approved") {
    // Release the Sales Order in SAP as the deciding user.
    try {
      await sapRequestAsUser(session.adminId!, "PATCH", `/Orders(${docEntry})`, { U_DataStatus: "C" });
      const now = (await getSapSoHeaders([docEntry])).get(docEntry)?.dataStatus ?? null;
      if (now !== "C") warning = `Approved, but the Sales Order still shows U_DataStatus ${now ?? "?"} in SAP — please check it.`;
    } catch (e) {
      warning = `Approved in the portal, but setting U_DataStatus C in SAP failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)} — set it in SAP or approve again.`;
    }
    if (warning) {
      console.warn(`[Approvals] SO ${docEntry}: ${warning}`);
      await query(`UPDATE so_approvals SET notes = CONCAT_WS(' · ', notes, ?) WHERE company_id = ? AND sap_doc_entry = ? AND superseded = 0 ORDER BY id DESC LIMIT 1`, [warning, companyId, docEntry]);
    }
  }
  if (finalState === "approved" && !warning) {
    await query(`UPDATE orders SET ar_status = 'approved', ar_decided_at = NOW(), ar_decided_by = ? WHERE company_id = ? AND id = ?`, [session.adminId, companyId, run.id]);
  } else if (finalState === "rejected") {
    await query(`UPDATE orders SET ar_status = 'rejected', ar_decided_at = NOW(), ar_decided_by = ? WHERE company_id = ? AND id = ?`, [session.adminId, companyId, run.id]);
    // A rejection ends the round: a later re-approval starts at the first stage again.
    await query(`UPDATE so_approvals SET superseded = 1 WHERE company_id = ? AND sap_doc_entry = ? AND superseded = 0`, [companyId, docEntry]);
  } else if (run.ar_status === "rejected") {
    await query(`UPDATE orders SET ar_status = 'pending' WHERE company_id = ? AND id = ?`, [companyId, run.id]);
  }
  // (If releasing in SAP failed, the order stays pending so the approval can be completed again.)
  if (finalState === "approved" && warning) {
    await query(`UPDATE so_approvals SET superseded = 1 WHERE company_id = ? AND sap_doc_entry = ? AND superseded = 0 AND decision = 'approved' ORDER BY id DESC LIMIT ?`, [companyId, docEntry, info.stages.length]);
  }
  forgetChecks(docEntry);
  return {
    sapUser: sapSession.sapUser,
    outcome: finalState === "approved" && warning ? "stage_approved" : finalState ?? (decision === "approved" ? "stage_approved" : "stage_rejected"),
    waitingFor: finalState ? [] : after.waitingFor,
    requestNo: null,
    warning,
  };
}

/**
 * Undo approval: take back the final approval of a Sales Order that isn't on
 * an AR Invoice yet. Only the user who made it (an Accountant: their own
 * approval), or System Admin for anyone's. The SO goes back to U_DataStatus I
 * in SAP first (as the Accountant's own SAP user; System Admin as the
 * portal's integration user) — if SAP refuses, nothing changes. Then the
 * approval is marked undone (kept in the history with who / when / why) and
 * the SO waits in the same stage again; Auto SO Approval won't re-approve it.
 */
async function undoApprovalCore(session: AdminSession, docEntry: number, reasonRaw: string): Promise<{ waitingFor: string[]; approvedBy: string }> {
  if (!session.adminId) throw new DecisionError("No staff account", 403);
  const reason = reasonRaw.trim();
  if (reason.length < 3) throw new DecisionError("Write why the approval is undone");
  if (!(await soInScope(session, docEntry))) throw new DecisionError("Sales Order not found", 404);
  const companyId = getCompanyId();
  const me = await mySapUserCode(session);
  const req = await requestFor(docEntry);
  const sapRows = req ? (await sapModeRows([docEntry])).get(docEntry) ?? [] : [];
  const run = req ? undefined : (await portalRunOrders([docEntry])).get(docEntry);
  const fa = await finalApprovalOf(docEntry, req, run, sapRows);
  if (!fa) throw new DecisionError("This Sales Order isn't approved — nothing to undo.", 409, "not_approved");
  const info = await undoInfoFor(session, me, docEntry, fa);
  if (!info.canUndo) throw new DecisionError(info.reason ?? "This approval can't be undone", 403, "cannot_undo");

  // SAP first: back to I (not released). An Accountant as their own SAP user; System Admin as the integration user.
  if (session.isSuperAdmin) await getSapClient().updateSalesOrderDataStatus(docEntry, "I");
  else await asUserCreds(session.adminId, "PATCH", `/Orders(${docEntry})`, { U_DataStatus: "I" });
  const now = (await getSapSoHeaders([docEntry])).get(docEntry)?.dataStatus ?? null;
  if (now !== "I") throw new DecisionError(`SAP still shows U_DataStatus ${now ?? "?"} for this Sales Order — the approval was not undone.`, 502);

  const by = session.userid || session.email;
  const why = reason.slice(0, 1000);
  const undoCols = `undone_at = NOW(), undone_by = ?, undone_by_label = ?, undo_reason = ?`;
  try {
    await inTransaction(async (q) => {
      if (fa.mode === "portal") {
        await q(`UPDATE so_approvals SET ${undoCols}, superseded = 1 WHERE company_id = ? AND id IN (${fa.rowIds.map(() => "?").join(",")})`,
          [session.adminId, by, why, companyId, ...fa.rowIds]);
      } else if (fa.mode === "sap_portal") {
        // (wdd_code filled in for a decision saved before the column existed.)
        await q(`UPDATE so_approvals SET ${undoCols}, wdd_code = COALESCE(wdd_code, ?) WHERE company_id = ? AND id = ?`,
          [session.adminId, by, why, fa.wddCode, companyId, fa.rowIds[0]]);
      } else {
        // Approved in the SAP client: record that approval (method sap), already undone.
        await q(
          `INSERT INTO so_approvals (company_id, order_id, sap_doc_entry, decision, method, admin_user_id, admin_label, sap_user_code, wtm_code, wst_code, wdd_code, notes,
                                     undone_at, undone_by, undone_by_label, undo_reason)
           VALUES (?, (SELECT id FROM orders WHERE company_id = ? AND sap_doc_entry = ? ORDER BY id DESC LIMIT 1), ?, 'approved', 'sap', ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
          [companyId, companyId, docEntry, docEntry, fa.adminUserId ?? session.adminId, fa.label, fa.sapUserCode, fa.wtmCode, fa.wstCode, fa.wddCode,
           "Approved in SAP (Approval Status Report)", session.adminId, by, why]
        );
      }
      await q(`UPDATE orders SET ar_status = 'pending', ar_decided_at = NULL, ar_decided_by = NULL WHERE company_id = ? AND sap_doc_entry = ?`, [companyId, docEntry]);
    });
  } catch (e) {
    // Nothing recorded — put SAP back to C so the SO stays approved in both.
    try {
      if (session.isSuperAdmin) await getSapClient().updateSalesOrderDataStatus(docEntry, "C");
      else await asUserCreds(session.adminId, "PATCH", `/Orders(${docEntry})`, { U_DataStatus: "C" });
    } catch (e2) {
      console.error(`[Approvals] SO ${docEntry}: undo not recorded and restoring U_DataStatus C failed:`, e2);
      throw new DecisionError(`The undo couldn't be saved and the Sales Order is now U_DataStatus I in SAP — set it back to C in SAP (or undo again). (${e instanceof Error ? e.message.slice(0, 120) : String(e)})`, 500);
    }
    throw new DecisionError(`The undo couldn't be saved (${e instanceof Error ? e.message.slice(0, 160) : String(e)}) — the Sales Order was set back to C in SAP; nothing changed.`, 500);
  }
  forgetChecks(docEntry);

  // Who it's waiting for now.
  let waitingFor: string[] = [];
  if (run) {
    const dec = (await loadDecisions([docEntry])).get(docEntry);
    waitingFor = (await progressForPortalOrder(run.templates, dec?.current ?? [])).waitingFor;
  } else if (req) {
    const ro = reopenOf(req, (await sapModeRows([docEntry])).get(docEntry) ?? []);
    if (ro) waitingFor = reopenProgress(req, ro).waitingFor;
  }
  return { waitingFor, approvedBy: fa.label };
}

// ── Notifications (inbox bell + NEW markers) — never fail the action ──

/**
 * Approve / reject (see decideApprovalCore), then notify: the creator /
 * pusher of the SO gets the outcome; when a stage is approved and the next
 * one starts, its authorizers get "waits for your approval". The decider's
 * own notifications for this SO are marked read.
 */
export async function decideApproval(
  session: AdminSession, docEntry: number, decision: "approved" | "rejected", notes: string, stepNotes: Record<string, string>,
  method: DecisionMethod = "manual"
): Promise<DecisionResult> {
  const r = await decideApprovalCore(session, docEntry, decision, notes, stepNotes, method);
  const by = `${session.userid || session.email}${r.sapUser ? ` (SAP ${r.sapUser})` : ""}${method === "auto" ? " — Auto SO Approval" : ""}`;
  notifySafely(`decision on SO ${docEntry}`, async () => {
    if (session.adminId) await markNotificationsRead(session.adminId, { docEntry });
    // Off the bell: everyone it no longer waits for (all, once approved / rejected; the decider and their stage otherwise).
    await markApprovalProcessed(docEntry, r.outcome === "approved" || r.outcome === "rejected" ? null : r.waitingFor);
    if (r.outcome === "approved") await notifySubmitters(docEntry, { kind: "so_approved", by, auto: method === "auto", excludeAdminId: session.adminId });
    else if (r.outcome === "rejected") await notifySubmitters(docEntry, { kind: "so_rejected", by, note: notes, excludeAdminId: session.adminId });
    else if (r.outcome === "stage_approved" && r.waitingFor.length) {
      await notifySubmitters(docEntry, { kind: "so_stage_approved", by, waitingFor: r.waitingFor, excludeAdminId: session.adminId });
      await notifyApprovalNeeded(docEntry, r.waitingFor, { reason: "Previous stage approved", actor: by, excludeAdminId: session.adminId });
    }
  });
  return r;
}

/** Undo (see undoApprovalCore), then notify the creator / pusher and the authorizers it waits for again. */
export async function undoApproval(session: AdminSession, docEntry: number, reason: string): Promise<{ waitingFor: string[]; approvedBy: string }> {
  const r = await undoApprovalCore(session, docEntry, reason);
  const by = session.userid || session.email;
  notifySafely(`undo on SO ${docEntry}`, async () => {
    await notifySubmitters(docEntry, { kind: "so_undone", by, note: reason, waitingFor: r.waitingFor, excludeAdminId: session.adminId });
    await notifyApprovalNeeded(docEntry, r.waitingFor, { reason: `Approval undone: ${reason.slice(0, 200)}`, actor: by, excludeAdminId: session.adminId });
  });
  return r;
}

// ── Keeping an Accountant's bell equal to their live Pending queue ─────

const gq = globalThis as typeof globalThis & { __soToDoSync?: Map<number, number> };
/** admin_users.id → when their "to approve" items were last matched to the live queue (ms). */
const lastToDoSync: Map<number, number> = (gq.__soToDoSync ??= new Map());

/**
 * Match this Accountant's "to approve" notifications to their live Pending
 * queue (see listApprovalQueue), unless done within `maxAgeMs`.
 */
export async function syncApprovalToDo(adminUserId: number, maxAgeMs = 0): Promise<void> {
  if (maxAgeMs && Date.now() - (lastToDoSync.get(adminUserId) ?? 0) < maxAgeMs) return;
  lastToDoSync.set(adminUserId, Date.now());
  const session = await loadStaffSession(adminUserId);
  if (!session || session.isSuperAdmin || session.kind !== "account" || !session.permissions.includes("so-approval")) return;
  await listApprovalQueue(session, { status: "pending" });
}

/** Every few minutes (instrumentation.ts): every active Accountant with a SAP user. */
export async function syncAllApprovalToDo(): Promise<void> {
  const rows = await query<{ id: number }[]>(
    `SELECT a.id FROM admin_users a JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id AND r.kind = 'account'
      WHERE a.company_id = ? AND a.is_active = 1 AND a.sap_user_code IS NOT NULL AND a.sap_user_code <> ''`,
    [getCompanyId()]
  );
  for (const r of rows) {
    await syncApprovalToDo(r.id, 60 * 1000).catch((e) => console.warn(`[Notifications] to-do sync for user ${r.id} failed:`, e));
  }
}

/** Internals exposed for scripted checks only (synthetic requests) — not for app code. */
export const __soApprovalInternals = { reopenOf, reopenProgress, decideInfoReopened, finalApprovalOf };

/** One rule of a promotion program, as shown in the SO Approval "PM Code" popup. */
export interface PromotionRuleView {
  sellingItem: string | null; sellingItemName: string | null; sellingGroup: string | null;
  discPct: number | null; buyQty: number | null; givingItem: string | null; givingItemName: string | null; giveQty: number | null;
  beginDate: string | null; endDate: string | null;
  /** BP targets of this rule (customer code / group), and whether one is this SO's customer or its groups. */
  targets: string[]; forCustomer: boolean;
}

/**
 * The promotion program behind a PM Code on an SO (cached promotion_discount,
 * synced from SAP), limited to the items on this SO, so the lookup stays on
 * idx_company_item_bp. Rules that target this customer (BP code or one of its
 * groups) are flagged and listed first. Same data scope as the SO detail.
 */
export async function getPromotionProgramForSo(session: AdminSession, docEntry: number, code: string) {
  const facts = await soInScope(session, docEntry);
  if (!facts) return null;
  const lines = await getSoLinesForDisplay(docEntry);
  const items = [...new Set(lines.map((l) => l.item))];
  if (items.length === 0) return { code, name: null, rules: [] as PromotionRuleView[] };
  const rows = await query<{
    promotion_name: string | null; begin_date: string | null; end_date: string | null; bp_type: string | null; bp_code: string | null; bp_name: string | null;
    bp_grp_code: string | null; bp_grp_name: string | null; selling_item_code: string | null; selling_item_name: string | null;
    selling_grp_code: string | null; selling_grp_name: string | null; disc_pct: string | null; selling_qty: string | null;
    giving_item_code: string | null; giving_item_name: string | null; giving_qty: string | null;
  }[]>(
    `SELECT promotion_name, DATE_FORMAT(begin_date, '%Y-%m-%d') AS begin_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            bp_type, bp_code, bp_name, bp_grp_code, bp_grp_name, selling_item_code, selling_item_name, selling_grp_code, selling_grp_name,
            disc_pct, selling_qty, giving_item_code, giving_item_name, giving_qty
       FROM promotion_discount FORCE INDEX (idx_company_item_bp)
      WHERE company_id = ? AND selling_item_code IN (${items.map(() => "?").join(",")}) AND promotion_code = ?
      LIMIT 5000`,
    [getCompanyId(), ...items, code]
  );
  const mine = new Set([facts.cardCode, ...facts.groups].map((x) => x.toLowerCase()));
  const num = (v: string | null) => (v === null ? null : Number(v));
  const rules = new Map<string, PromotionRuleView>();
  for (const r of rows) {
    const key = [r.selling_item_code, r.disc_pct, r.selling_qty, r.giving_item_code, r.giving_qty, r.begin_date, r.end_date].join("|");
    const target = r.bp_code ? `${r.bp_code}${r.bp_name ? ` ${r.bp_name}` : ""}` : r.bp_grp_code ? `${r.bp_grp_code}${r.bp_grp_name ? ` ${r.bp_grp_name}` : ""}` : "all customers";
    const isMine = [r.bp_code, r.bp_grp_code].some((c) => c && mine.has(c.toLowerCase())) || (!r.bp_code && !r.bp_grp_code);
    let rule = rules.get(key);
    if (!rule) {
      rule = {
        sellingItem: r.selling_item_code, sellingItemName: r.selling_item_name, sellingGroup: r.selling_grp_name ?? r.selling_grp_code,
        discPct: num(r.disc_pct), buyQty: num(r.selling_qty), givingItem: r.giving_item_code, givingItemName: r.giving_item_name, giveQty: num(r.giving_qty),
        beginDate: r.begin_date, endDate: r.end_date, targets: [], forCustomer: false,
      };
      rules.set(key, rule);
    }
    if (!rule.targets.includes(target) && rule.targets.length < 20) rule.targets.push(target);
    rule.forCustomer ||= isMine;
  }
  const sorted = [...rules.values()].sort((a, b) => Number(b.forCustomer) - Number(a.forCustomer)
    || items.indexOf(a.sellingItem ?? "") - items.indexOf(b.sellingItem ?? ""));
  const name = rows[0]?.promotion_name ?? lines.find((l) => l.pmCode === code)?.pmName ?? null;
  return { code, name, rules: sorted, truncated: rows.length >= 5000 };
}
