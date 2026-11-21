import { queryHana, queryHanaInSchema, getHanaSchema } from "@/lib/hana/client";

/**
 * SAP B1 Approval Procedures for Sales Orders, read from HANA and followed by
 * the portal's SO Approval:
 *
 *   OWTM  Approval Templates (Active, Conds)        WTM3  … for document types (TransType 17 = Sales Order)
 *   WTM2  … its stages, in SortId order             WTM5  … its condition queries (OUQR)
 *   OWST  Approval Stages (MaxReqr / MaxRejReqr)    WST1  … the stage's authorizers (OUSR users)
 *
 * Which templates apply to a Sales Order is decided the way SAP does: the
 * template's condition queries are run with the SO's values. A query is
 * written against the SO form — `$[$4.0.0]` (item 4 = customer code) and
 * `$[ORDR."Field"]` are replaced by the SO's own values, with U_DataStatus =
 * 'C' (the change being approved; IMV's conditions fire on it). The
 * template applies when a condition query returns TRUE (any of them), or
 * when it has no conditions (Conds = N).
 *
 * Template originators (WTM1) are NOT checked: a portal SO is created by the
 * portal's Service Layer user, not by the salesperson the originator list is
 * about.
 */
export interface SapApprovalStage {
  wstCode: number;
  name: string;
  remarks: string | null;
  sortId: number;
  /** Approvals needed to pass the stage (OWST.MaxReqr). */
  maxReqr: number;
  /** Rejections that reject the document (OWST.MaxRejReqr). */
  maxRejReqr: number;
  authorizers: { userId: number; userCode: string; name: string | null }[];
}

export interface SapApprovalTemplate {
  wtmCode: number;
  name: string;
  hasConditions: boolean;
  queries: { id: number; name: string; text: string }[];
  /** Predefined terms (WTM4) — not evaluated by the portal (none are set up today). */
  termCount: number;
  stages: SapApprovalStage[];
  /** WTM1 — SAP users whose documents this template covers (the user who makes the change). */
  originators: string[];
}

const TTL_MS = 5 * 60 * 1000;
const g = globalThis as typeof globalThis & {
  __sapSoTemplates?: { at: number; list: SapApprovalTemplate[] };
  __sapSoTemplateMatch?: Map<string, { at: number; value: boolean | string }>;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Active approval templates for Sales Orders (cached 5 minutes). */
export async function getSoApprovalTemplates(force = false): Promise<SapApprovalTemplate[]> {
  const hit = g.__sapSoTemplates;
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.list;
  const s = `"${getHanaSchema()}"`;
  const [tpls, stages, auths, queries, terms, origs] = await Promise.all([
    queryHana<Record<string, unknown>>(
      `SELECT T."WtmCode", T."Name", T."Conds" FROM ${s}."OWTM" T
        WHERE T."Active" = 'Y' AND EXISTS (SELECT 1 FROM ${s}."WTM3" D WHERE D."WtmCode" = T."WtmCode" AND D."TransType" = '17')
        ORDER BY T."WtmCode"`
    ),
    queryHana<Record<string, unknown>>(
      `SELECT W."WtmCode", W."WstCode", W."SortId", S."Name", S."Remarks", S."MaxReqr", S."MaxRejReqr"
         FROM ${s}."WTM2" W JOIN ${s}."OWST" S ON S."WstCode" = W."WstCode" ORDER BY W."WtmCode", W."SortId"`
    ),
    queryHana<Record<string, unknown>>(
      `SELECT A."WstCode", A."UserID", U."USER_CODE", U."U_NAME" FROM ${s}."WST1" A JOIN ${s}."OUSR" U ON U."USERID" = A."UserID"`
    ),
    queryHana<Record<string, unknown>>(
      `SELECT W."WtmCode", Q."IntrnalKey", Q."QName", Q."QString" FROM ${s}."WTM5" W JOIN ${s}."OUQR" Q ON Q."IntrnalKey" = W."QueryId"`
    ),
    queryHana<Record<string, unknown>>(`SELECT "WtmCode", COUNT(*) AS "n" FROM ${s}."WTM4" GROUP BY "WtmCode"`),
    queryHana<Record<string, unknown>>(`SELECT O."WtmCode", U."USER_CODE" FROM ${s}."WTM1" O JOIN ${s}."OUSR" U ON U."USERID" = O."UserID"`),
  ]);
  const authBy = new Map<number, SapApprovalStage["authorizers"]>();
  for (const a of auths) {
    const list = authBy.get(num(a.WstCode)) ?? [];
    list.push({ userId: num(a.UserID), userCode: String(a.USER_CODE), name: str(a.U_NAME) });
    authBy.set(num(a.WstCode), list);
  }
  const list: SapApprovalTemplate[] = tpls.map((t) => {
    const code = num(t.WtmCode);
    return {
      wtmCode: code,
      name: String(t.Name),
      hasConditions: t.Conds === "Y",
      queries: queries.filter((q) => num(q.WtmCode) === code).map((q) => ({ id: num(q.IntrnalKey), name: String(q.QName ?? "").trim(), text: String(q.QString ?? "") })),
      termCount: num(terms.find((x) => num(x.WtmCode) === code)?.n),
      originators: origs.filter((o) => num(o.WtmCode) === code).map((o) => String(o.USER_CODE)),
      stages: stages.filter((x) => num(x.WtmCode) === code).map((x) => ({
        wstCode: num(x.WstCode), name: String(x.Name), remarks: str(x.Remarks), sortId: num(x.SortId),
        maxReqr: Math.max(1, num(x.MaxReqr)), maxRejReqr: Math.max(1, num(x.MaxRejReqr)),
        authorizers: authBy.get(num(x.WstCode)) ?? [],
      })),
    };
  });
  g.__sapSoTemplates = { at: Date.now(), list };
  return list;
}

// ── Condition queries ──────────────────────────────────────────────────

/** SO form items a condition query may reference as $[$item.col.type] (header fields only). */
const FORM_ITEMS: Record<string, string> = { "4": "CardCode", "54": "CardName", "8": "DocNum", "14": "NumAtCard", "16": "Comments" };
/** The value U_DataStatus is being set to by the approval. */
const APPROVED_VALUES: Record<string, string> = { U_DataStatus: "C" };

const VAR_RE = /\$\[\s*([^\]]+?)\s*\]/g;

/** ORDR columns the active templates' queries reference (so they can be read once per batch of SOs). */
function referencedFields(templates: SapApprovalTemplate[]): string[] {
  const fields = new Set<string>(["DocEntry", "CardCode"]);
  for (const t of templates) for (const q of t.queries) {
    for (const m of q.text.matchAll(VAR_RE)) {
      const v = m[1];
      if (v.startsWith("$")) { const f = FORM_ITEMS[v.slice(1).split(".")[0]]; if (f) fields.add(f); continue; }
      const tm = /^ORDR\s*\.\s*"?([A-Za-z0-9_]+)"?/i.exec(v);
      if (tm) fields.add(tm[1]);
    }
  }
  return [...fields];
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (v instanceof Date) return `'${v.toISOString().slice(0, 10)}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** The query with the SO's values in place of $[...]; or an error text when a reference can't be resolved. */
function substitute(text: string, so: Record<string, unknown>): { sql: string } | { error: string } {
  let error: string | null = null;
  const sql = text.replace(VAR_RE, (_all, inner: string) => {
    let field: string | null = null;
    if (inner.startsWith("$")) field = FORM_ITEMS[inner.slice(1).split(".")[0]] ?? null;
    else field = /^ORDR\s*\.\s*"?([A-Za-z0-9_]+)"?/i.exec(inner)?.[1] ?? null;
    if (!field) { error ??= `unsupported reference $[${inner}]`; return "NULL"; }
    return sqlLiteral(field in APPROVED_VALUES ? APPROVED_VALUES[field] : so[field]);
  }).trim().replace(/;+\s*$/, "");
  if (error) return { error };
  if (!/^\s*(select|with)\b/i.test(sql) || sql.includes(";")) return { error: "condition query is not a single SELECT" };
  return { sql };
}

/** At most 6 condition queries (HANA connections) at a time. */
let running = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 6) await new Promise<void>((r) => queue.push(r));
  running++;
  try { return await fn(); } finally { running--; queue.shift()?.(); }
}

export interface TemplateMatch {
  template: SapApprovalTemplate;
  /** Set when the conditions could not be evaluated — the template is then treated as applying. */
  warning?: string;
}

/**
 * Which active SO approval templates apply to each Sales Order (by SAP
 * DocEntry). Condition results are cached 10 minutes per template + query text.
 */
export async function matchSoTemplates(docEntries: number[]): Promise<Map<number, TemplateMatch[]>> {
  const out = new Map<number, TemplateMatch[]>();
  const ids = [...new Set(docEntries.filter((d) => Number.isInteger(d) && d > 0))];
  if (ids.length === 0) return out;
  const templates = await getSoApprovalTemplates();
  const s = `"${getHanaSchema()}"`;
  const fields = referencedFields(templates);
  const sos = await queryHana<Record<string, unknown>>(
    `SELECT ${fields.map((f) => `"${f}"`).join(", ")} FROM ${s}."ORDR" WHERE "DocEntry" IN (${ids.join(",")})`
  );
  const cache = (g.__sapSoTemplateMatch ??= new Map());
  const MATCH_TTL = 10 * 60 * 1000;

  // Each distinct substituted query runs once (customers repeat across orders).
  const pending = new Map<string, Promise<boolean | string>>();
  const evaluate = (sql: string): Promise<boolean | string> => {
    const hit = cache.get(sql);
    if (hit && Date.now() - hit.at < MATCH_TTL) return Promise.resolve(hit.value);
    let p = pending.get(sql);
    if (!p) {
      p = limited(() => queryHanaInSchema<Record<string, unknown>>(sql))
        .then((rows) => rows.some((r) => String(Object.values(r)[0] ?? "").trim().toUpperCase() === "TRUE"))
        .catch((e) => `condition query failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`)
        .then((v) => { cache.set(sql, { at: Date.now(), value: v }); return v; });
      pending.set(sql, p);
    }
    return p;
  };

  await Promise.all(sos.map(async (so) => {
    const matches: TemplateMatch[] = [];
    for (const t of templates) {
      if (!t.hasConditions) { matches.push({ template: t }); continue; }
      if (t.queries.length === 0) {
        // Terms only (WTM4) — not evaluated by the portal: treat as applying, and say so.
        matches.push({ template: t, warning: `${t.termCount} predefined term(s) not evaluated by the portal` });
        continue;
      }
      const results = await Promise.all(t.queries.map((q) => {
        const sub = substitute(q.text, so);
        return "error" in sub ? Promise.resolve(`${q.name}: ${sub.error}`) : evaluate(sub.sql);
      }));
      if (results.some((r) => r === true)) matches.push({ template: t });
      else {
        const err = results.find((r) => typeof r === "string");
        if (err) matches.push({ template: t, warning: String(err) });
      }
    }
    out.set(num(so.DocEntry), matches);
  }));
  return out;
}

// ── Progress through the stages ────────────────────────────────────────

export interface StageDecision {
  wtmCode: number | null;
  wstCode: number | null;
  decision: "approved" | "rejected";
  sapUserCode: string | null;
  adminLabel: string | null;
  at: string;
}

export interface StageProgress extends SapApprovalStage {
  approvals: StageDecision[];
  rejections: StageDecision[];
  state: "done" | "current" | "waiting" | "rejected";
}

export interface TemplateProgress {
  wtmCode: number;
  name: string;
  warning?: string;
  stages: StageProgress[];
  state: "approved" | "pending" | "rejected";
  current: StageProgress | null;
}

export interface ProcedureProgress {
  templates: TemplateProgress[];
  /** No template applies — only a Super Admin can decide. */
  noTemplate: boolean;
  state: "approved" | "pending" | "rejected";
  /** SAP user codes that can act now (authorizers of the current stages, minus who already decided there). */
  waitingFor: string[];
  /** Every authorizer of every stage of the applying templates. */
  allAuthorizers: string[];
}

const lc = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Where an order stands in its templates' stages, from this round's decisions. */
export function computeProgress(matches: TemplateMatch[], decisions: StageDecision[]): ProcedureProgress {
  const templates: TemplateProgress[] = matches.map(({ template, warning }) => {
    let blocked = false; // a stage before this one isn't done
    let rejected = false;
    const stages: StageProgress[] = template.stages.map((st) => {
      const mine = decisions.filter((d) => d.wtmCode === template.wtmCode && d.wstCode === st.wstCode);
      const approvals = mine.filter((d) => d.decision === "approved");
      const rejections = mine.filter((d) => d.decision === "rejected");
      let state: StageProgress["state"];
      if (rejected || blocked) state = "waiting";
      else if (rejections.length >= st.maxRejReqr) { state = "rejected"; rejected = true; }
      else if (approvals.length >= st.maxReqr) state = "done";
      else { state = "current"; blocked = true; }
      return { ...st, approvals, rejections, state };
    });
    const state: TemplateProgress["state"] = rejected ? "rejected" : stages.every((x) => x.state === "done") ? "approved" : "pending";
    return { wtmCode: template.wtmCode, name: template.name, warning, stages, state, current: stages.find((x) => x.state === "current") ?? null };
  });
  const state: ProcedureProgress["state"] = templates.some((t) => t.state === "rejected") ? "rejected"
    : templates.length > 0 && templates.every((t) => t.state === "approved") ? "approved" : "pending";
  const waitingFor = new Set<string>();
  for (const t of templates) {
    if (t.state !== "pending" || !t.current) continue;
    const decided = new Set(t.current.approvals.concat(t.current.rejections).map((d) => lc(d.sapUserCode)));
    for (const a of t.current.authorizers) if (!decided.has(lc(a.userCode))) waitingFor.add(a.userCode);
  }
  return {
    templates, noTemplate: matches.length === 0, state, waitingFor: [...waitingFor],
    allAuthorizers: [...new Set(templates.flatMap((t) => t.stages.flatMap((st) => st.authorizers.map((a) => a.userCode))))],
  };
}

/** The current stages (template + stage) where this SAP user can decide now. */
export function actionableStages(p: ProcedureProgress, sapUserCode: string | null): { wtmCode: number; wstCode: number; templateName: string; stageName: string }[] {
  const me = lc(sapUserCode);
  if (!me) return [];
  return p.templates.flatMap((t) => {
    if (t.state !== "pending" || !t.current) return [];
    const st = t.current;
    if (!st.authorizers.some((a) => lc(a.userCode) === me)) return [];
    if (st.approvals.concat(st.rejections).some((d) => lc(d.sapUserCode) === me)) return [];
    return [{ wtmCode: t.wtmCode, wstCode: st.wstCode, templateName: t.name, stageName: st.name }];
  });
}

export const isAuthorizerOf = (p: ProcedureProgress, sapUserCode: string | null) =>
  !!lc(sapUserCode) && p.allAuthorizers.some((u) => lc(u) === lc(sapUserCode));

// ── Portal-run approval (portal orders) ────────────────────────────────

/**
 * At push: the SAP approval templates that apply to this Sales Order, the way
 * SAP itself decides when a user saves it in the SAP client — the template's
 * condition is TRUE for the SO (with U_DataStatus = C, the change being
 * approved) AND the SAP user making the change (`sapUserCode`, who pushed it)
 * is one of the template's originators. SAP doesn't do this for Service Layer
 * updates with query-based conditions, so the portal does.
 */
export async function templatesForPush(docEntry: number, sapUserCode: string): Promise<{ templates: SapApprovalTemplate[]; warnings: string[] }> {
  const matches = (await matchSoTemplates([docEntry])).get(docEntry) ?? [];
  const me = lc(sapUserCode);
  const mine = matches.filter((m) => m.template.originators.some((o) => lc(o) === me));
  return { templates: mine.map((m) => m.template), warnings: mine.map((m) => m.warning).filter((w): w is string => !!w) };
}

/** Progress of a portal order through the templates recorded at push (stages / approvers read live from SAP). */
export async function progressForPortalOrder(wtmCodes: number[], decisions: StageDecision[]): Promise<ProcedureProgress> {
  const all = await getSoApprovalTemplates();
  const templates = wtmCodes.map((c) => all.find((t) => t.wtmCode === c)).filter((t): t is SapApprovalTemplate => !!t);
  return computeProgress(templates.map((template) => ({ template })), decisions);
}
