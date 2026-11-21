import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import type { AdminSession } from "@/lib/auth/adminSession";
import { getOrderAllowedCustomerGroupCodes, getAllowedBrandCodes } from "@/lib/adminScope";
import { getSapSoHeaders, getArSummaries, type SapSoHeader, type ArSummary } from "@/lib/soApproval/sapData";
import { loadOrderForChecks, loadSapSoForChecks, runApprovalChecks, type CheckResult } from "@/lib/soApproval/checks";
import { userSapRequest, getUserSapSession, SapSessionExpiredError } from "@/lib/sap-b1/userSession";
import { ensureUserSapSession, getSapCredentialStatus, SapPasswordInvalidError } from "@/lib/sap-b1/userCredentials";
import {
  actionableStages, isAuthorizerOf, progressForPortalOrder,
  type ProcedureProgress, type StageDecision,
} from "@/lib/soApproval/sapProcedure";
import {
  getSoApprovalRequests, progressFromRequest, arStatusOf, myPendingLine, approvalCompletes, searchSoApprovals,
  getSoScopeFacts, getSoLinesForDisplay, searchSoHeaders, type SapApprovalRequest, type SoApprovalListRow,
} from "@/lib/soApproval/sapApprovalRequests";
import { sapRequestAsUser } from "@/lib/sap-b1/userCredentials";

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
 */
export type ArStatus = "pending" | "approved" | "rejected";
export type QueueStatus = ArStatus | "all";

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

/** Keep a linked portal order's ar_status in step with SAP's request (it may have been decided in SAP itself). */
async function syncPortalStatus(order: { id: number; ar_status: ArStatus | null } | undefined, req: SapApprovalRequest | null) {
  if (!order || !req) return;
  const live = arStatusOf(req);
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
// round that ended in rejection), stages / authorizers / MaxReqr read live
// from SAP; the final approval sets U_DataStatus C as the deciding user.

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

  const list = await searchSoApprovals({
    status: filters.status, fromDate, dateFrom: filters.dateFrom, dateTo: filters.dateTo, brand: filters.brand,
    soNo: filters.soNo, bp: filters.bp, creator: filters.creator,
    sapUserCode: session.isSuperAdmin ? null : me,
    // Super Admin: config customer groups (getOrderAllowedCustomerGroupCodes), all brands.
    groupCodes: groups, brandCodes: brands,
  });
  // Portal orders whose approval the portal runs (no SAP request) — same filters.
  const runs = await portalRunOrders();
  // An SO that SAP itself has an approval request for (e.g. it was set to C in the SAP client) follows
  // SAP's request — it's listed from there, not twice.
  const withSapRequest = await getSoApprovalRequests([...runs.keys()]).catch(() => new Map<number, SapApprovalRequest>());
  const runCands = [...runs.values()].filter((r) => !withSapRequest.has(r.sap_doc_entry) && (filters.status === "all" || r.ar_status === filters.status));
  const portalHeads = await searchSoHeaders(runCands.map((r) => r.sap_doc_entry), {
    fromDate, dateFrom: filters.dateFrom, dateTo: filters.dateTo, brand: filters.brand, soNo: filters.soNo, bp: filters.bp,
    creator: filters.creator, groupCodes: groups, brandCodes: brands,
  });
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

  const docs = list.map((r) => r.docEntry);
  const [reqs, portal, ar] = await Promise.all([
    getSoApprovalRequests(docs),
    portalOrdersFor(docs),
    getArSummaries([...list, ...portalEntries.map((e) => e.r)].map((r) => r.cardCode), false, brands).catch(() => new Map<string, ArSummary>()),
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
    await syncPortalStatus(po, req);
    rows.push({
      ...baseRow(r), status: req ? arStatusOf(req) : "pending",
      portalOrder: po ? { id: po.id, orderNumber: po.order_number } : null,
      sapApproval: summarize(req, progressFromRequest(req), me),
    });
  }
  for (const e of portalEntries) {
    rows.push({
      ...baseRow(e.r), status: (e.run.ar_status ?? "pending") as ArStatus,
      portalOrder: { id: e.run.id, orderNumber: e.run.order_number },
      sapApproval: summarizePortal(e.p, me),
    });
  }
  rows.sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? "") || b.docEntry - a.docEntry);
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
    lines: { item: string; name: string | null; qty: number; uom: string | null; price: number; discountPct: number; total: number; gift: boolean; kind?: string | null }[];
  };
  sap: SapSoHeader | null;
  ar: ArSummary | null;
  checks: CheckResult[];
  checkedAt: string;
  history: { decision: string; by: string | null; sapUser: string | null; stage: string | null; superseded: boolean; notes: string | null; stepNotes: Record<string, string> | null; at: string }[];
  procedure: ProcedureProgress;
  decide: DecideInfo;
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

async function requestFor(docEntry: number): Promise<SapApprovalRequest | null> {
  return (await getSoApprovalRequests([docEntry])).get(docEntry) ?? null;
}

export async function getApprovalDetail(session: AdminSession, docEntry: number, recheck = false): Promise<ApprovalDetail | null> {
  const facts = await soInScope(session, docEntry);
  if (!facts) return null;
  const me = await mySapUserCode(session);
  const req = await requestFor(docEntry);
  // No SAP request: a portal order whose approval the portal runs (SAP templates recorded at push)?
  const run = req ? undefined : (await portalRunOrders([docEntry])).get(docEntry);
  const runDec = run ? (await loadDecisions([docEntry])).get(docEntry) ?? { current: [], deciders: new Set<number>() } : null;
  const progress = run ? await progressForPortalOrder(run.templates, runDec!.current) : progressFromRequest(req);
  // Only the approvers (SAP request lines / the templates' stage authorizers), those who decided, and Super Admin see it.
  if (!session.isSuperAdmin) {
    const allowed = req ? req.lines.some((l) => lc(l.userCode) === lc(me))
      : run ? isAuthorizerOf(progress, me) || (!!session.adminId && runDec!.deciders.has(session.adminId)) : false;
    if (!allowed) return null;
  }
  const brands = getAllowedBrandCodes(session);
  const companyId = getCompanyId();

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
  if (po) await syncPortalStatus(po, req);

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

  const history = await query<{ decision: string; admin_label: string | null; sap_user_code: string | null; wtm_code: number | null; wst_code: number | null; superseded: number; notes: string | null; step_notes: unknown; created_at: string }[]>(
    `SELECT decision, admin_label, sap_user_code, wtm_code, wst_code, superseded, notes, step_notes, created_at FROM so_approvals
      WHERE company_id = ? AND sap_doc_entry = ? ORDER BY id DESC`,
    [companyId, docEntry]
  );
  const stageName = (wtm: number | null, wst: number | null): string | null => {
    if (wtm === null) return null;
    const t = progress.templates.find((x) => x.wtmCode === wtm);
    const st = t?.stages.find((x) => x.wstCode === wst);
    return t ? `${t.name} · ${st?.name ?? `stage ${wst}`}` : `template ${wtm}`;
  };

  return {
    order: {
      id: po?.id ?? 0, docEntry, orderNumber: po?.order_number ?? sap?.docNo ?? String(sap?.docNum ?? docEntry),
      source: po ? "portal" : "sap", arStatus: req ? arStatusOf(req) : run?.ar_status ?? po?.ar_status ?? null,
      createdAt: po?.created_at ?? sap?.docDate ?? "", warehouseCode: po?.warehouse_code ?? null,
      customerName: sap?.cardName ?? null, mstCode: po?.mst_code ?? ar?.taxCode ?? null, cardCode: facts.cardCode,
      contactPhone: po?.contact_phone ?? null, deliveryAddress: po?.delivery_address ?? null, supervisorName: po?.supervisor_name ?? null,
      createdByStaff: po?.created_by ?? null, creator: facts.creator,
      lines,
    },
    sap, ar: ar && { ...ar, agingRows: [] }, checks: cached.checks, checkedAt: new Date(cached.at).toISOString(),
    history: history.map((h) => ({
      decision: h.decision, by: h.admin_label, sapUser: h.sap_user_code, notes: h.notes,
      stage: stageName(h.wtm_code, h.wst_code), superseded: !!h.superseded,
      stepNotes: (typeof h.step_notes === "string" ? JSON.parse(h.step_notes) : h.step_notes) as Record<string, string> | null,
      at: h.created_at,
    })),
    procedure: progress,
    decide: run ? await decideInfoPortal(me, run, runDec!.current, progress) : decideInfo(session, me, req, progress),
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
export async function decideApproval(
  session: AdminSession,
  docEntry: number,
  decision: "approved" | "rejected",
  notes: string,
  stepNotes: Record<string, string>
): Promise<{ sapUser: string | null; outcome: "approved" | "rejected" | "stage_approved" | "stage_rejected"; waitingFor: string[]; requestNo: number | null; warning: string | null }> {
  if (!session.adminId) throw new DecisionError("No staff account", 403);
  if (!(await soInScope(session, docEntry))) throw new DecisionError("Sales Order not found", 404);
  const companyId = getCompanyId();
  const me = await mySapUserCode(session);
  const req = await requestFor(docEntry);
  if (!req) return decidePortal(session, docEntry, decision, notes, stepNotes, me);
  const info = decideInfo(session, me, req, progressFromRequest(req));
  if (!info.canDecide || !req) throw new DecisionError(info.reason ?? "You can't decide on this Sales Order now", 403, "not_your_stage");

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
    sapSession = await ensureUserSapSession(session.adminId);
  } catch (e) {
    if (e instanceof SapPasswordInvalidError) throw new DecisionError(e.message, 428, "sap_password_invalid");
    throw e;
  }
  if (!sapSession) throw new DecisionError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  if (lc(sapSession.sapUser) !== lc(me)) {
    throw new DecisionError(`Signed in to SAP as ${sapSession.sapUser}, but the approval line is for ${me}. Update your SAP user in My Profile.`, 409);
  }

  // The decision on SAP's request (Approval Status Report → Approved / Not Approved, with remarks).
  const remarks = [notes.trim(), ...Object.entries(cleanStepNotes).filter(([, v]) => v !== notes.trim()).map(([k, v]) => `${k}: ${v}`)]
    .filter(Boolean).join(" | ").slice(0, 254);
  await asUser(session.adminId, "PATCH", `/ApprovalRequests(${req.wddCode})`, {
    ApprovalRequestDecisions: [{ Status: decision === "approved" ? "ardApproved" : "ardNotApproved", Remarks: remarks || undefined }],
  });

  // SAP has the decision now — record it in the portal straight away, whatever happens next.
  const po = await queryOne<{ id: number }>(`SELECT id FROM orders WHERE company_id = ? AND sap_doc_entry = ? ORDER BY id DESC LIMIT 1`, [companyId, docEntry]);
  const ins = await query<{ insertId: number }>(
    `INSERT INTO so_approvals (company_id, order_id, sap_doc_entry, decision, admin_user_id, admin_label, sap_user_code, wtm_code, wst_code, checks, step_notes, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, po?.id ?? null, docEntry, decision, session.adminId, session.userid || session.email, sapSession.sapUser, req.wtmCode, req.currStep,
     JSON.stringify(checks.map((c) => ({ key: c.key, status: c.status, summary: c.summary }))),
     JSON.stringify(cleanStepNotes), notes.trim() || null]
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
 * Decision on a portal order whose approval the portal runs (no SAP request):
 * in the current stage(s) of its SAP templates where this user is an
 * authorizer. The last approval sets U_DataStatus C in SAP as this user; a
 * rejection reaching MaxRejReqr rejects the order (SO stays I) and ends the
 * round — a later re-approval starts at the first stage again.
 */
async function decidePortal(
  session: AdminSession, docEntry: number, decision: "approved" | "rejected", notes: string, stepNotes: Record<string, string>, me: string | null
): Promise<{ sapUser: string | null; outcome: "approved" | "rejected" | "stage_approved" | "stage_rejected"; waitingFor: string[]; requestNo: number | null; warning: string | null }> {
  const companyId = getCompanyId();
  const run = (await portalRunOrders([docEntry])).get(docEntry);
  if (!run) throw new DecisionError("No approval is waiting for this Sales Order.", 403, "not_your_stage");
  const dec = (await loadDecisions([docEntry])).get(docEntry) ?? { current: [], deciders: new Set<number>() };
  const p = await progressForPortalOrder(run.templates, dec.current);
  const info = await decideInfoPortal(me, run, dec.current, p);
  if (!info.canDecide) throw new DecisionError(info.reason ?? "You can't decide on this Sales Order now", 403, "not_your_stage");

  const cached = checkCache.get(checkKey(docEntry, getAllowedBrandCodes(session)));
  const checks: CheckResult[] = cached && Date.now() - cached.at <= CHECK_CACHE_MS ? cached.checks : (await getApprovalDetail(session, docEntry, true))?.checks ?? [];
  const cleanStepNotes: Record<string, string> = Object.fromEntries(Object.entries(stepNotes ?? {}).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v));
  if (decision === "rejected") {
    if (!notes.trim()) throw new DecisionError("Write the reason for rejecting");
  } else {
    const missing = checks.filter((c) => c.status !== "pass" && !cleanStepNotes[c.key]).map((c) => `${c.step}. ${c.title}`);
    if (missing.length) throw new DecisionError(`A checking note is required for: ${missing.join(", ")}`, 400, "note_required");
  }

  // The decider's own SAP user — needed to release the SO (and proves who they are in SAP).
  let sapSession: { sapUser: string; expiresAt: number } | null;
  try {
    sapSession = await ensureUserSapSession(session.adminId!);
  } catch (e) {
    if (e instanceof SapPasswordInvalidError) throw new DecisionError(e.message, 428, "sap_password_invalid");
    throw e;
  }
  if (!sapSession) throw new DecisionError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  if (lc(sapSession.sapUser) !== lc(me)) {
    throw new DecisionError(`Signed in to SAP as ${sapSession.sapUser}, but the approval stage is for ${me}. Update your SAP user in My Profile.`, 409);
  }

  // Record the decision (one row per stage decided).
  for (const st of info.stages) {
    await query(
      `INSERT INTO so_approvals (company_id, order_id, sap_doc_entry, decision, admin_user_id, admin_label, sap_user_code, wtm_code, wst_code, checks, step_notes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, run.id, docEntry, decision, session.adminId, session.userid || session.email, sapSession.sapUser, st.wtmCode, st.wstCode,
       JSON.stringify(checks.map((c) => ({ key: c.key, status: c.status, summary: c.summary }))),
       JSON.stringify(cleanStepNotes), notes.trim() || null]
    );
  }
  const after = await progressForPortalOrder(run.templates, dec.current.concat(info.stages.map((st) => ({
    wtmCode: st.wtmCode, wstCode: st.wstCode, decision, sapUserCode: sapSession!.sapUser, adminLabel: null, at: "",
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
  return {
    sapUser: sapSession.sapUser,
    outcome: finalState === "approved" && warning ? "stage_approved" : finalState ?? (decision === "approved" ? "stage_approved" : "stage_rejected"),
    waitingFor: finalState ? [] : after.waitingFor,
    requestNo: null,
    warning,
  };
}
