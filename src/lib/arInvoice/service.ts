import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId, isFillOwnerEnabled } from "@/lib/config";
import type { AdminSession } from "@/lib/auth/adminSession";
import { getAllowedBrandCodes, getBrandOptions, getOrderAllowedCustomerGroupCodes, groupScopeClause } from "@/lib/adminScope";
import { getAdminWarehouseCodes } from "@/lib/adminWarehouses";
import { getCustomerForAdmin } from "@/lib/adminOrderCreate";
import { getSapClient } from "@/lib/sap-b1/client";
import { ensureUserSapSession, sapRequestAsUser, SapPasswordInvalidError } from "@/lib/sap-b1/userCredentials";
import { SapSessionExpiredError } from "@/lib/sap-b1/userSession";
import { queryHana, queryHanaInSchema, getHanaSchema } from "@/lib/hana/client";
import { notifyArApprovalNeeded, markNotificationsRead } from "@/lib/staffNotifications";

/**
 * AR Invoice entered on the portal (free entry) and added to SAP B1 as an
 * A/R Invoice (OINV, object 13) — as the user's OWN SAP user, so SAP's own
 * Approval Procedures apply exactly as in the SAP client:
 *
 *   portal draft ──Post to SAP──▶ SAP adds the invoice                     → "posted"
 *                             └─▶ an Approval Template applies (AR01–AR05:
 *                                 originator = this SAP user, condition
 *                                 TRUE) → SAP saves a Draft + approval
 *                                 request (OWDD)                          → "pending_approval"
 *   stage authorizers Approve / Reject (portal or SAP client) on the request
 *   final approval → the draft is added as the invoice
 *                    (DraftsService_SaveDraftToDocument)                  → "posted"
 *
 * Only non-inventory (service) items for now — AR01–05's conditions fire for
 * exactly those (CKTM commercial-discount invoices, fees, …); stock items would
 * move stock and need batches, which the portal does not allocate yet.
 *
 * Data permissions: customers within the user's customer groups / channels,
 * items within their brands. Only the creator (or Super Admin) edits / posts.
 *
 * Portal-run approval (approval_mode 'portal'): SAP's Service Layer can't
 * evaluate AR01–AR05's condition queries (they read the SAP client's form —
 * $[$4.0.0] / $[$38.1.0]), so SAP adds the invoice without approval. Like SO
 * Approval, the portal follows the templates itself: when one applies (the
 * same originator + condition check as the preview), "Post to SAP" saves the
 * invoice in SAP as a Draft (U_DocNo is assigned) → "Adm Confirmed"
 * (pending_approval); the template's stage authorizers (e.g. acc03 for AR01 GT)
 * approve / reject on the portal; the final approval adds the draft as the
 * A/R Invoice as the approver's own SAP user.
 *
 * source = 'sap': an AR Invoice approval request raised in the SAP client,
 * pulled in by sapImport.ts (Settings -> "Sync SO AR from") — read-only here;
 * its authorizers approve / reject it like a portal one.
 */

export type ArStatus = "draft" | "pending_approval" | "approved" | "posted" | "rejected" | "failed" | "cancelled";
const EDITABLE: ArStatus[] = ["draft", "failed", "rejected", "cancelled"];

export interface ArLineInput {
  itemCode: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  vatGroup?: string | null;
  description?: string | null;
  /** SAP Rebate (UDO RBT, @SAL_GE_RBT_H.DocEntry) this CKTM line pays out — posted as U_RBTRef. */
  rbtRef?: number | null;
}

export interface ArInvoiceInput {
  cardCode: string;
  billToCode?: string | null;
  shipToCode?: string | null;
  invName?: string | null;
  invTaxNo?: string | null;
  invAddress?: string | null;
  docDate: string;
  dueDate: string;
  taxDate?: string | null;
  numAtCard?: string | null;
  comments?: string | null;
  warehouseCode?: string | null;
  departmentCode?: string | null;
  /** Header Brand (SAP U_ProdBrand) — every line's item must be of this brand. */
  brandCode?: string | null;
  lines: ArLineInput[];
}

export interface ArDocRow {
  id: number;
  doc_kind: "invoice" | "credit_memo";
  source: "portal" | "sap";
  doc_number: string | null;
  status: ArStatus;
  sap_card_code: string;
  card_name: string | null;
  bill_to_code: string | null;
  ship_to_code: string | null;
  inv_name: string | null;
  inv_tax_no: string | null;
  inv_address: string | null;
  doc_date: string;
  due_date: string;
  tax_date: string;
  num_at_card: string | null;
  comments: string | null;
  warehouse_code: string | null;
  department_code: string | null;
  total_before_vat: number;
  vat_sum: number;
  doc_total: number;
  created_by: number | null;
  created_by_label: string | null;
  posted_sap_user: string | null;
  posted_at: string | null;
  wdd_code: number | null;
  wtm_code: number | null;
  template_name: string | null;
  /** 'sap' = SAP's own approval request (wdd_code); 'portal' = portal-run template approval (portal_approval). */
  approval_mode: "sap" | "portal" | null;
  portal_approval: PortalApproval | string | null;
  sap_draft_entry: number | null;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  /** SAP U_DocNo — "AR. No" (e.g. ARR261104007). */
  sap_doc_no: string | null;
  /** SAP U_ProdBrand, else the lines' brand. */
  brand_code: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArLineRow {
  line_no: number;
  item_code: string;
  item_name: string | null;
  uom: string | null;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  vat_group: string | null;
  brand_code: string | null;
  item_tax_class: string | null;
  description: string | null;
  line_total: number;
  rbt_ref: number | null;
  rbt_code: string | null;
  rbt_name: string | null;
}

export class ArError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}

const lc = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const S = () => `"${getHanaSchema()}"`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_COLS = `d.id, d.doc_kind, d.source, d.doc_number, d.status, d.sap_card_code, d.card_name, d.bill_to_code, d.ship_to_code, d.inv_name, d.inv_tax_no, d.inv_address,
  DATE_FORMAT(d.doc_date, '%Y-%m-%d') AS doc_date, DATE_FORMAT(d.due_date, '%Y-%m-%d') AS due_date, DATE_FORMAT(d.tax_date, '%Y-%m-%d') AS tax_date,
  d.num_at_card, d.comments, d.warehouse_code, d.department_code, d.total_before_vat, d.vat_sum, d.doc_total, d.created_by, d.created_by_label,
  d.posted_sap_user, d.posted_at, d.wdd_code, d.wtm_code, d.template_name, d.approval_mode, d.portal_approval, d.sap_draft_entry, d.sap_doc_entry, d.sap_doc_num, d.sap_doc_no, d.brand_code, d.last_error, d.created_at, d.updated_at`;

/** "S08" → 8, "S10" → 10, "S00" → 0 (IMV's output VAT codes carry their rate); null when unknown. */
export function vatRateOf(code: string | null | undefined): number | null {
  const m = /^S(\d{2})$/i.exec((code ?? "").trim());
  return m ? Number(m[1]) : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
export function lineTotalOf(l: { quantity: number; unitPrice: number; discountPct?: number }) {
  return Math.round(l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100));
}

async function mySapUserCode(session: AdminSession): Promise<string | null> {
  if (!session.adminId) return null;
  const r = await queryOne<{ sap_user_code: string | null }>(`SELECT sap_user_code FROM admin_users WHERE company_id = ? AND id = ?`, [getCompanyId(), session.adminId]);
  return r?.sap_user_code?.trim() || null;
}

async function event(docId: number, action: string, session: AdminSession | null, sapUser: string | null, notes: string | null) {
  await query(
    `INSERT INTO ar_document_events (company_id, ar_document_id, action, admin_user_id, admin_label, sap_user_code, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [getCompanyId(), docId, action, session?.adminId ?? null, session ? session.userid || session.email : null, sapUser, notes?.slice(0, 2000) ?? null]
  );
}

async function customerScopeSql(session: AdminSession) {
  return groupScopeClause(await getOrderAllowedCustomerGroupCodes(session), ["c.cus_grp01", "c.cus_grp02", "c.cus_grp03"]);
}

// ── Lookups (HANA, read-only) ──────────────────────────────────────────

export interface ArItemOption {
  itemCode: string;
  itemName: string;
  uom: string | null;
  vatGroup: string | null;
  brandCode: string | null;
  itemTaxClass: string | null;
}

/** Sellable, active non-inventory (service) items within the user's brands. */
export async function searchArItems(session: AdminSession, search: string, codes?: string[], brand?: string | null): Promise<ArItemOption[]> {
  const brands = getAllowedBrandCodes(session);
  const where = [`I."SellItem" = 'Y'`, `I."InvntItem" = 'N'`, `I."frozenFor" = 'N'`, `I."validFor" = 'Y'`];
  if (brand?.trim()) where.push(`I."U_ProdBrand" = ${lit(brand.trim())}`);
  if (brands !== null) where.push(brands.size ? `I."U_ProdBrand" IN (${[...brands].map(lit).join(",")})` : "1 = 0");
  if (codes) {
    if (codes.length === 0) return [];
    where.push(`I."ItemCode" IN (${codes.map(lit).join(",")})`);
  } else if (search.trim()) {
    const like = lit(`%${search.trim().toUpperCase().replace(/[%_]/g, "")}%`);
    where.push(`(UPPER(I."ItemCode") LIKE ${like} OR UPPER(I."ItemName") LIKE ${like})`);
  }
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT I."ItemCode", I."ItemName", I."SalUnitMsr", I."VatGourpSa", I."U_ProdBrand", I."U_ItemTaxClass"
       FROM ${S()}."OITM" I WHERE ${where.join(" AND ")} ORDER BY I."ItemCode" LIMIT ${codes ? 500 : 40}`
  );
  return rows.map((r) => ({
    itemCode: String(r.ItemCode), itemName: String(r.ItemName ?? ""), uom: str(r.SalUnitMsr), vatGroup: str(r.VatGourpSa),
    brandCode: str(r.U_ProdBrand), itemTaxClass: str(r.U_ItemTaxClass),
  }));
}

/** Department list (distribution rule dimension 2). */
export async function getDepartments(): Promise<{ code: string; name: string | null }[]> {
  const rows = await queryHana<Record<string, unknown>>(`SELECT "OcrCode", "OcrName" FROM ${S()}."OOCR" WHERE "DimCode" = 2 AND "Active" = 'Y' ORDER BY "OcrCode"`);
  return rows.map((r) => ({ code: String(r.OcrCode), name: str(r.OcrName) }));
}

/** The output VAT groups in use on sellable items (OVTG itself isn't granted to the HANA user). */
export async function getVatGroups(): Promise<{ code: string; rate: number | null }[]> {
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT DISTINCT "VatGourpSa" AS "Code" FROM ${S()}."OITM" WHERE "SellItem" = 'Y' AND "VatGourpSa" IS NOT NULL ORDER BY 1`
  );
  return rows.map((r) => String(r.Code)).filter(Boolean).map((code) => ({ code, rate: vatRateOf(code) }));
}

// ── SAP approval (OWDD / WDD1, object 13) ──────────────────────────────

export interface ArApprovalRequest {
  wddCode: number;
  wtmCode: number;
  templateName: string | null;
  status: "W" | "Y" | "N" | "P" | "A" | "C";
  currStep: number;
  draftEntry: number | null;
  docEntry: number | null;
  stages: { wstCode: number; name: string; sortId: number; maxReqr: number; maxRejReqr: number;
    lines: { userCode: string; userName: string | null; status: "W" | "Y" | "N"; remarks: string | null; updatedAt: string | null }[] }[];
}

export async function getArApprovalRequest(wddCode: number): Promise<ArApprovalRequest | null> {
  const s = S();
  const [req] = await queryHana<Record<string, unknown>>(
    `SELECT W."WddCode", W."WtmCode", T."Name" AS "TemplateName", W."Status", W."CurrStep", W."DraftEntry", W."DocEntry"
       FROM ${s}."OWDD" W LEFT JOIN ${s}."OWTM" T ON T."WtmCode" = W."WtmCode" WHERE W."WddCode" = ${Number(wddCode)} AND W."ObjType" = '13'`
  );
  if (!req) return null;
  const [lines, stages] = await Promise.all([
    queryHana<Record<string, unknown>>(
      `SELECT D."StepCode", U."USER_CODE", U."U_NAME", D."Status", D."Remarks", D."UpdateDate", D."UpdateTime"
         FROM ${s}."WDD1" D LEFT JOIN ${s}."OUSR" U ON U."USERID" = D."UserID" WHERE D."WddCode" = ${Number(wddCode)} ORDER BY D."StepCode", U."USER_CODE"`
    ),
    queryHana<Record<string, unknown>>(
      `SELECT W."WstCode", W."SortId", S."Name", S."MaxReqr", S."MaxRejReqr" FROM ${s}."WTM2" W JOIN ${s}."OWST" S ON S."WstCode" = W."WstCode"
        WHERE W."WtmCode" = ${num(req.WtmCode)} ORDER BY W."SortId"`
    ),
  ]);
  const defs = stages.map((x) => ({ wstCode: num(x.WstCode), name: String(x.Name), sortId: num(x.SortId), maxReqr: Math.max(1, num(x.MaxReqr)), maxRejReqr: Math.max(1, num(x.MaxRejReqr)) }));
  for (const step of [...new Set(lines.map((l) => num(l.StepCode)))]) {
    if (!defs.some((d) => d.wstCode === step)) defs.push({ wstCode: step, name: `Stage ${step}`, sortId: defs.length + 1, maxReqr: 1, maxRejReqr: 1 });
  }
  return {
    wddCode: num(req.WddCode), wtmCode: num(req.WtmCode), templateName: str(req.TemplateName),
    status: String(req.Status) as ArApprovalRequest["status"], currStep: num(req.CurrStep),
    draftEntry: req.DraftEntry == null ? null : num(req.DraftEntry), docEntry: req.DocEntry == null || num(req.DocEntry) <= 0 ? null : num(req.DocEntry),
    stages: defs.map((d) => ({
      ...d,
      lines: lines.filter((l) => num(l.StepCode) === d.wstCode).map((l) => ({
        userCode: String(l.USER_CODE ?? ""), userName: str(l.U_NAME), status: String(l.Status) as "W" | "Y" | "N", remarks: str(l.Remarks),
        updatedAt: l.UpdateDate ? `${String(l.UpdateDate).slice(0, 10)}${l.UpdateTime ? ` ${String(l.UpdateTime).padStart(4, "0").replace(/(\d\d)(\d\d)$/, "$1:$2")}` : ""}` : null,
      })),
    })),
  };
}

/** Is `sapUser` a pending authorizer of the request's current stage? */
export function isMyTurn(req: ArApprovalRequest | null, sapUser: string | null): boolean {
  if (!req || req.status !== "W" || !sapUser) return false;
  return req.stages.some((st) => st.wstCode === req.currStep && st.lines.some((l) => lc(l.userCode) === lc(sapUser) && l.status === "W"));
}

// ── Portal-run approval (approval_mode 'portal') ───────────────────────

interface PortalStage { wstCode: number; name: string; sortId: number; maxReqr: number; maxRejReqr: number; authorizers: { userCode: string; userName: string | null }[] }
export interface PortalApproval {
  templates: { wtmCode: number; name: string; stages: PortalStage[] }[];
  decisions: { wstCode: number; userCode: string; decision: "Y" | "N"; remarks: string | null; at: string }[];
}

function parsePortalApproval(v: unknown): PortalApproval | null {
  if (!v) return null;
  try {
    const o = (typeof v === "string" ? JSON.parse(v) : v) as PortalApproval;
    return Array.isArray(o?.templates) ? { templates: o.templates, decisions: Array.isArray(o.decisions) ? o.decisions : [] } : null;
  } catch { return null; }
}

/** The templates' stages and authorizers as SAP defines them now (OWTM / WTM2 / OWST / WST1). */
async function arTemplateStages(wtmCodes: number[]): Promise<PortalApproval["templates"]> {
  const codes = [...new Set(wtmCodes.filter((c) => Number.isInteger(c) && c > 0))];
  if (!codes.length) return [];
  const s = S();
  const [tpls, stages, auths] = await Promise.all([
    queryHana<Record<string, unknown>>(`SELECT "WtmCode", "Name" FROM ${s}."OWTM" WHERE "WtmCode" IN (${codes.join(",")})`),
    queryHana<Record<string, unknown>>(
      `SELECT W."WtmCode", W."WstCode", W."SortId", S."Name", S."MaxReqr", S."MaxRejReqr" FROM ${s}."WTM2" W JOIN ${s}."OWST" S ON S."WstCode" = W."WstCode"
        WHERE W."WtmCode" IN (${codes.join(",")}) ORDER BY W."WtmCode", W."SortId"`
    ),
    queryHana<Record<string, unknown>>(
      `SELECT A."WstCode", U."USER_CODE", U."U_NAME" FROM ${s}."WST1" A JOIN ${s}."OUSR" U ON U."USERID" = A."UserID"
        WHERE A."WstCode" IN (SELECT "WstCode" FROM ${s}."WTM2" WHERE "WtmCode" IN (${codes.join(",")})) ORDER BY U."USER_CODE"`
    ),
  ]);
  return codes.map((code) => ({
    wtmCode: code,
    name: String(tpls.find((t) => num(t.WtmCode) === code)?.Name ?? `Template ${code}`),
    stages: stages.filter((st) => num(st.WtmCode) === code).map((st) => ({
      wstCode: num(st.WstCode), name: String(st.Name), sortId: num(st.SortId),
      maxReqr: Math.max(1, num(st.MaxReqr)), maxRejReqr: Math.max(1, num(st.MaxRejReqr)),
      authorizers: auths.filter((a) => num(a.WstCode) === num(st.WstCode)).map((a) => ({ userCode: String(a.USER_CODE), userName: str(a.U_NAME) })),
    })),
  }));
}

/**
 * A portal-run approval in the shape of SAP's approval request, so the screens,
 * isMyTurn, notifications and "AR Approve" treat both alike. Stages run in
 * template order; a stage passes with MaxReqr approvals and rejects the
 * invoice with MaxRejReqr rejections. wddCode 0 = not an SAP request.
 */
export function portalRequest(doc: Pick<ArDocRow, "portal_approval" | "sap_draft_entry" | "sap_doc_entry" | "status">): ArApprovalRequest | null {
  const pa = parsePortalApproval(doc.portal_approval);
  if (!pa || !pa.templates.length) return null;
  let status: ArApprovalRequest["status"] = "W";
  let currStep = 0;
  let open = false;
  const stages: ArApprovalRequest["stages"] = [];
  for (const t of pa.templates) {
    for (const st of t.stages) {
      const decs = pa.decisions.filter((d) => d.wstCode === st.wstCode);
      const yes = decs.filter((d) => d.decision === "Y").length;
      const no = decs.filter((d) => d.decision === "N").length;
      stages.push({
        wstCode: st.wstCode, name: st.name, sortId: stages.length + 1, maxReqr: st.maxReqr, maxRejReqr: st.maxRejReqr,
        lines: st.authorizers.map((a) => {
          const d = decs.find((x) => lc(x.userCode) === lc(a.userCode));
          return { userCode: a.userCode, userName: a.userName, status: d ? d.decision : "W", remarks: d?.remarks ?? null, updatedAt: d ? d.at.slice(0, 16).replace("T", " ") : null };
        }),
      });
      if (status === "W" && !open) {
        if (no >= st.maxRejReqr) { status = "N"; currStep = st.wstCode; }
        else if (yes < st.maxReqr) { open = true; currStep = st.wstCode; }
      }
    }
  }
  if (status === "W" && !open) status = "Y";
  if (doc.status === "cancelled") status = "C";
  return {
    wddCode: 0, wtmCode: pa.templates[0].wtmCode, templateName: pa.templates.map((t) => t.name).join(" + "),
    status, currStep, draftEntry: doc.sap_draft_entry ?? null, docEntry: doc.sap_doc_entry ?? null, stages,
  };
}

/** The approval this AR document follows: SAP's request (wdd_code) or the portal-run one. */
async function approvalOf(doc: ArDocRow): Promise<ArApprovalRequest | null> {
  if (doc.approval_mode === "portal") return portalRequest(doc);
  return doc.wdd_code ? getArApprovalRequest(doc.wdd_code).catch(() => null) : null;
}

/** Which AR approval requests (by WddCode) wait for this SAP user now. */
async function waitingForUser(wddCodes: number[], sapUser: string | null): Promise<Set<number>> {
  const ids = [...new Set(wddCodes.filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length || !sapUser) return new Set();
  const s = S();
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT W."WddCode" FROM ${s}."OWDD" W JOIN ${s}."WDD1" D ON D."WddCode" = W."WddCode" AND D."StepCode" = W."CurrStep" AND D."Status" = 'W'
       JOIN ${s}."OUSR" U ON U."USERID" = D."UserID"
      WHERE W."ObjType" = '13' AND W."Status" = 'W' AND W."WddCode" IN (${ids.join(",")}) AND LOWER(U."USER_CODE") = ${lit(lc(sapUser))}`
  );
  return new Set(rows.map((r) => num(r.WddCode)));
}

/**
 * Which active AR Invoice templates SAP would apply when `sapUser` adds this
 * invoice — originator (WTM1) + condition query TRUE for any line, the way the
 * SAP client decides. A preview only: SAP itself decides on the post.
 */
export async function previewArTemplates(cardCode: string, itemCodes: string[], sapUser: string | null) {
  const s = S();
  const [tpls, queries, origs, auths] = await Promise.all([
    queryHana<Record<string, unknown>>(
      `SELECT T."WtmCode", T."Name", T."Conds" FROM ${s}."OWTM" T WHERE T."Active" = 'Y'
          AND EXISTS (SELECT 1 FROM ${s}."WTM3" D WHERE D."WtmCode" = T."WtmCode" AND D."TransType" = '13') ORDER BY T."WtmCode"`
    ),
    queryHana<Record<string, unknown>>(`SELECT W."WtmCode", Q."QName", Q."QString" FROM ${s}."WTM5" W JOIN ${s}."OUQR" Q ON Q."IntrnalKey" = W."QueryId"`),
    queryHana<Record<string, unknown>>(`SELECT O."WtmCode", U."USER_CODE" FROM ${s}."WTM1" O JOIN ${s}."OUSR" U ON U."USERID" = O."UserID"`),
    queryHana<Record<string, unknown>>(
      `SELECT W."WtmCode", U."USER_CODE" FROM ${s}."WTM2" W JOIN ${s}."WST1" A ON A."WstCode" = W."WstCode" JOIN ${s}."OUSR" U ON U."USERID" = A."UserID"`
    ),
  ]);
  const out: { wtmCode: number; name: string; applies: boolean | null; approvers: string[]; note?: string }[] = [];
  const codes = [...new Set(itemCodes.filter(Boolean))];
  for (const t of tpls) {
    const code = num(t.WtmCode);
    const isOriginator = origs.some((o) => num(o.WtmCode) === code && lc(String(o.USER_CODE)) === lc(sapUser));
    const approvers = [...new Set(auths.filter((a) => num(a.WtmCode) === code).map((a) => String(a.USER_CODE)))];
    if (!isOriginator) { out.push({ wtmCode: code, name: String(t.Name), applies: false, approvers, note: `${sapUser ?? "you"} is not an originator` }); continue; }
    if (t.Conds !== "Y") { out.push({ wtmCode: code, name: String(t.Name), applies: true, approvers }); continue; }
    let applies: boolean | null = false;
    let note: string | undefined;
    for (const q of queries.filter((x) => num(x.WtmCode) === code)) {
      for (const item of codes.length ? codes : [""]) {
        let bad = false;
        const sql = String(q.QString ?? "").replace(/\$\[\s*([^\]]+?)\s*\]/g, (_a, inner: string) => {
          if (/^\$4\./.test(inner)) return lit(cardCode);
          if (/^\$38\.1\./.test(inner)) return lit(item);
          bad = true;
          return "NULL";
        }).trim().replace(/;+\s*$/, "");
        if (bad || !/^\s*(select|with)\b/i.test(sql) || sql.includes(";")) { applies = null; note = `${String(q.QName).trim()}: not evaluated by the portal`; continue; }
        try {
          const rows = await queryHanaInSchema<Record<string, unknown>>(sql);
          if (rows.some((r) => String(Object.values(r)[0] ?? "").trim().toUpperCase() === "TRUE")) { applies = true; break; }
        } catch (e) {
          applies = null;
          note = `condition query failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
        }
      }
      if (applies === true) break;
    }
    out.push({ wtmCode: code, name: String(t.Name), applies, approvers, note });
  }
  return out;
}

// ── Rebates (SAP UDO "RBT": @SAL_GE_RBT_H) ─────────────────────────────

export interface ArRebate {
  docEntry: number;
  code: string;
  name: string;
  amount: number;
  validFrom: string | null;
  validTo: string | null;
  creator: string | null;
  /** Already on a SAP invoice, or on another portal AR Invoice that is waiting / posted. */
  usedBy: string | null;
  suggestedItem: string | null;
  suggestedText: string | null;
}

/** "PIGEON-8%-CKTM QUÝ 3.2026" → { brandWord: "PIGEON", kind: "Q", period: "quý 3/2026" }. */
function rebateKind(name: string) {
  const up = name.toUpperCase();
  const kind = /QU[ÝY]/.test(up) ? "Q" : /TRONG TH[ÁA]NG/.test(up) ? "IN" : /[ĐD][ẶA]C BI[ỆE]T/.test(up) ? "SP" : "M";
  const q = /QU[ÝY]\s*(\d)\s*[./]\s*(\d{4})/.exec(up);
  const m = /TH[ÁA]NG\s*(\d{1,2})(?:\s*\+\s*\d{1,2})?\s*[./]\s*(\d{4})/.exec(up);
  const period = kind === "Q" && q ? `quý ${q[1]}/${q[2]}` : m ? `tháng ${m[1].padStart(2, "0")}/${m[2]}` : null;
  return { brandWord: up.split("-")[0].trim(), kind, period };
}

/**
 * Open customer rebates (Type 201 Specific Customer, not cancelled, status O)
 * of `cardCode` — `only` limits to those DocEntries. Each says whether it is
 * already invoiced (a SAP invoice line with its U_RBTRef, or another portal
 * invoice waiting / posted) and suggests the CKTM item and invoice text from
 * history: what this customer (else anyone) last used for the same brand +
 * kind (month-end / quarter / in-month / special), with the new period.
 */
export async function getRebates(cardCode: string, only?: number[], exceptDocId: number | null = null): Promise<ArRebate[]> {
  if (only && only.length === 0) return [];
  const s = S();
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT R."DocEntry", R."U_RBTCode", R."U_RBTName", R."U_PlanAmt", TO_VARCHAR(R."U_ValidFrom", 'YYYY-MM-DD') AS "VF", TO_VARCHAR(R."U_ValidTo", 'YYYY-MM-DD') AS "VT", R."Creator",
            (SELECT MAX(H."DocNum") FROM ${s}."INV1" L JOIN ${s}."OINV" H ON H."DocEntry" = L."DocEntry" AND H."CANCELED" = 'N' WHERE L."U_RBTRef" = R."DocEntry") AS "InvNum"
       FROM ${s}."@SAL_GE_RBT_H" R
      WHERE R."U_Code" = ${lit(cardCode)} AND R."U_Type" = '201' AND R."Canceled" = 'N' AND R."Status" = 'O'
        ${only ? `AND R."DocEntry" IN (${only.map(Number).join(",")})` : ""}
      ORDER BY R."DocEntry" DESC LIMIT 200`
  );
  if (!rows.length) return [];
  const portal = await query<{ rbt_ref: number; doc_number: string }[]>(
    `SELECT l.rbt_ref, d.doc_number FROM ar_document_lines l JOIN ar_documents d ON d.company_id = l.company_id AND d.id = l.ar_document_id
      WHERE l.company_id = ? AND l.rbt_ref IN (${rows.map(() => "?").join(",")}) AND d.status IN ('pending_approval','approved','posted') AND d.id <> ?`,
    [getCompanyId(), ...rows.map((r) => num(r.DocEntry)), exceptDocId ?? 0]
  );
  // History: which item / text went with which rebate brand + kind (last 12 months).
  const hist = await queryHana<Record<string, unknown>>(
    `SELECT H."CardCode", L."ItemCode", L."U_INVDesc", R."U_RBTName" FROM ${s}."INV1" L
       JOIN ${s}."OINV" H ON H."DocEntry" = L."DocEntry" AND H."CANCELED" = 'N'
       JOIN ${s}."@SAL_GE_RBT_H" R ON R."DocEntry" = L."U_RBTRef"
      WHERE H."DocDate" >= ADD_DAYS(CURRENT_DATE, -365) ORDER BY H."DocEntry" DESC LIMIT 3000`
  );
  const keyOf = (name: string) => { const k = rebateKind(name); return `${k.brandWord}|${k.kind}`; };
  const mine = new Map<string, { item: string; text: string | null }>();
  const counts = new Map<string, Map<string, number>>();
  for (const h of hist) {
    const k = keyOf(String(h.U_RBTName ?? ""));
    if (String(h.CardCode) === cardCode && !mine.has(k)) mine.set(k, { item: String(h.ItemCode), text: str(h.U_INVDesc) });
    const c = counts.get(k) ?? new Map<string, number>();
    c.set(String(h.ItemCode), (c.get(String(h.ItemCode)) ?? 0) + 1);
    counts.set(k, c);
  }
  const out = rows.map((r) => {
    const name = String(r.U_RBTName ?? "");
    const k = keyOf(name);
    const { period } = rebateKind(name);
    const prev = mine.get(k);
    const common = [...(counts.get(k) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    let text: string | null = null;
    if (prev?.text && period) text = prev.text.replace(/(tháng|quý)\s*\d{1,2}\s*\/\s*\d{4}/gi, period).slice(0, 254);
    else if (period) text = `Chiết khấu thương mại doanh số ${period} theo Phụ lục hợp đồng số … theo bảng kê doanh số ${period}`;
    const p = portal.find((x) => x.rbt_ref === num(r.DocEntry));
    return {
      docEntry: num(r.DocEntry), code: String(r.U_RBTCode ?? r.DocEntry), name, amount: Math.round(num(r.U_PlanAmt)),
      validFrom: str(r.VF), validTo: str(r.VT), creator: str(r.Creator),
      usedBy: r.InvNum ? `SAP invoice ${num(r.InvNum)}` : p ? `portal ${p.doc_number}` : null,
      suggestedItem: prev?.item ?? common, suggestedText: text,
    };
  });
  // Not yet invoiced first (newest first within each group).
  return out.sort((a, b) => Number(!!a.usedBy) - Number(!!b.usedBy) || b.docEntry - a.docEntry);
}

// ── Read ───────────────────────────────────────────────────────────────

export interface ArListFilters { status?: string; search?: string; waiting?: boolean; from?: string; to?: string; brand?: string }

/** Brand choices: SAP Product Brand cost centers in config's brandList, within the user's role Data Permission. */
export async function arBrandOptions(session: AdminSession): Promise<{ code: string; name: string | null }[]> {
  return getBrandOptions(session);
}

/** Invoices in SAP: copy their U_DocNo (AR. No), U_ProdBrand and DocNum into the rows that don't have them yet. */
async function refreshSapFields(rows: ArDocRow[]) {
  // Waiting for approval: SAP's draft already carries the AR. No (read once, through the Service Layer — no HANA grant on ODRF).
  for (const r of rows.filter((x) => !x.sap_doc_no && x.sap_draft_entry && !x.sap_doc_entry && ["pending_approval", "approved"].includes(x.status)).slice(0, 10)) {
    try {
      const d = await getSapClient().getDocument<Record<string, unknown>>("Drafts", Number(r.sap_draft_entry));
      r.sap_doc_no = str(d.U_DocNo);
      if (r.sap_doc_no) await query(`UPDATE ar_documents SET sap_doc_no = ? WHERE company_id = ? AND id = ?`, [r.sap_doc_no, getCompanyId(), r.id]);
    } catch { /* draft gone / SAP down — try next time */ }
  }
  const todo = rows.filter((r) => r.sap_doc_entry && r.status === "posted" && (!r.sap_doc_no || !r.brand_code || !r.sap_doc_num));
  if (!todo.length) return;
  const inv = await queryHana<Record<string, unknown>>(
    `SELECT "DocEntry", "DocNum", "U_DocNo", "U_ProdBrand" FROM ${S()}."OINV" WHERE "DocEntry" IN (${[...new Set(todo.map((r) => Number(r.sap_doc_entry)))].join(",")})`
  );
  const by = new Map(inv.map((x) => [num(x.DocEntry), x]));
  for (const r of todo) {
    const x = by.get(Number(r.sap_doc_entry));
    if (!x) continue;
    r.sap_doc_num = num(x.DocNum) || r.sap_doc_num;
    r.sap_doc_no = str(x.U_DocNo) ?? r.sap_doc_no;
    r.brand_code = str(x.U_ProdBrand) ?? r.brand_code;
    await query(`UPDATE ar_documents SET sap_doc_num = ?, sap_doc_no = ?, brand_code = ? WHERE company_id = ? AND id = ?`,
      [r.sap_doc_num, r.sap_doc_no, r.brand_code, getCompanyId(), r.id]);
  }
}

export async function listArInvoices(session: AdminSession, f: ArListFilters) {
  const companyId = getCompanyId();
  const scope = await customerScopeSql(session);
  const where = ["d.company_id = ?", "d.doc_kind = 'invoice'", "(d.sap_db IS NULL OR d.sap_db = ?)", scope.sql];
  const params: unknown[] = [companyId, getHanaSchema(), ...scope.params];
  if (f.status && f.status !== "all") { where.push("d.status = ?"); params.push(f.status); }
  if (f.from && DATE_RE.test(f.from)) { where.push("d.doc_date >= ?"); params.push(f.from); }
  if (f.to && DATE_RE.test(f.to)) { where.push("d.doc_date <= ?"); params.push(f.to); }
  if (f.brand?.trim()) { where.push("d.brand_code = ?"); params.push(f.brand.trim()); }
  if (f.search?.trim()) {
    const like = `%${f.search.trim()}%`;
    where.push("(d.doc_number LIKE ? OR d.sap_doc_no LIKE ? OR d.sap_card_code LIKE ? OR d.card_name LIKE ? OR d.num_at_card LIKE ? OR d.comments LIKE ? OR CAST(d.sap_doc_num AS CHAR) = ?)");
    params.push(like, like, like, like, like, like, f.search.trim());
  }
  const rows = await query<ArDocRow[]>(
    `SELECT ${DOC_COLS} FROM ar_documents d
       LEFT JOIN customers c ON c.company_id = d.company_id AND c.sap_card_code = d.sap_card_code
      WHERE ${where.join(" AND ")} ORDER BY d.id DESC LIMIT 500`,
    params
  );
  // Pending requests: refresh their status from SAP (decisions may have been made in the SAP client).
  await Promise.all(rows.filter((r) => r.status === "pending_approval" || r.status === "approved").map(async (r) => {
    try { Object.assign(r, await syncFromSap(r)); } catch { /* keep the stored status */ }
  }));
  await refreshSapFields(rows).catch((e) => console.warn("[AR Invoice] AR. No / brand refresh failed:", e));
  const me = await mySapUserCode(session);
  const waiting = await waitingForUser(rows.filter((r) => r.status === "pending_approval").map((r) => r.wdd_code ?? 0), me).catch(() => new Set<number>());
  const list = rows.map((r) => ({
    ...r,
    portal_approval: null, // internal — the list doesn't need it
    waitingForMe: r.status === "pending_approval" && (r.approval_mode === "portal" ? isMyTurn(portalRequest(r), me) : waiting.has(r.wdd_code ?? 0)),
  }));
  return {
    sapUser: me,
    brands: await arBrandOptions(session),
    rows: f.waiting ? list.filter((r) => r.waitingForMe) : list,
    counts: { waitingForMe: list.filter((r) => r.waitingForMe).length },
  };
}

async function loadDoc(session: AdminSession, id: number): Promise<ArDocRow | null> {
  const scope = await customerScopeSql(session);
  return queryOne<ArDocRow>(
    `SELECT ${DOC_COLS} FROM ar_documents d LEFT JOIN customers c ON c.company_id = d.company_id AND c.sap_card_code = d.sap_card_code
      WHERE d.company_id = ? AND d.id = ? AND d.doc_kind = 'invoice' AND (d.sap_db IS NULL OR d.sap_db = ?) AND ${scope.sql}`,
    [getCompanyId(), id, getHanaSchema(), ...scope.params]
  );
}

/**
 * Bring a sent document's status in line with SAP's request: W pending ·
 * Y approved (waiting to be added) · N rejected · C cancelled · P/A added
 * (generated) — its invoice DocEntry/DocNum then recorded.
 */
async function syncFromSap(doc: ArDocRow): Promise<Partial<ArDocRow>> {
  if (!doc.wdd_code || !["pending_approval", "approved"].includes(doc.status)) return {};
  const req = await getArApprovalRequest(doc.wdd_code);
  if (!req) return {};
  let next: ArStatus = doc.status;
  const patch: Partial<ArDocRow> = {};
  if (req.status === "W") next = "pending_approval";
  // Y = approved; once the draft is added SAP keeps Y (or P/A) and fills DocEntry with the invoice.
  else if (req.status === "Y" && !req.docEntry) next = "approved";
  else if (req.status === "N") next = "rejected";
  else if (req.status === "C") next = "cancelled";
  else if ((req.status === "Y" || req.status === "P" || req.status === "A") && req.docEntry) {
    next = "posted";
    patch.sap_doc_entry = req.docEntry;
    const [inv] = await queryHana<Record<string, unknown>>(`SELECT "DocNum" FROM ${S()}."OINV" WHERE "DocEntry" = ${req.docEntry}`);
    patch.sap_doc_num = inv ? num(inv.DocNum) : null;
  }
  if (next === doc.status && !patch.sap_doc_entry) return {};
  patch.status = next;
  await query(
    `UPDATE ar_documents SET status = ?, sap_doc_entry = COALESCE(?, sap_doc_entry), sap_doc_num = COALESCE(?, sap_doc_num),
            posted_at = IF(? = 'posted' AND posted_at IS NULL, NOW(), posted_at) WHERE company_id = ? AND id = ?`,
    [next, patch.sap_doc_entry ?? null, patch.sap_doc_num ?? null, next, getCompanyId(), doc.id]
  );
  if (next !== doc.status) await event(doc.id, next === "posted" ? "posted" : next, null, null, `SAP approval request #${doc.wdd_code}: ${req.status}`);
  return patch;
}

export async function getArInvoice(session: AdminSession, id: number) {
  const doc = await loadDoc(session, id);
  if (!doc) return null;
  try { Object.assign(doc, await syncFromSap(doc)); } catch (e) { console.warn("[AR Invoice] status sync failed:", e); }
  await refreshSapFields([doc]).catch(() => undefined);
  const companyId = getCompanyId();
  const [lines, events, me] = await Promise.all([
    query<ArLineRow[]>(
      `SELECT line_no, item_code, item_name, uom, quantity, unit_price, discount_pct, vat_group, brand_code, item_tax_class, description, line_total, rbt_ref, rbt_code, rbt_name
         FROM ar_document_lines WHERE company_id = ? AND ar_document_id = ? ORDER BY line_no`, [companyId, id]
    ),
    query<{ action: string; admin_label: string | null; sap_user_code: string | null; notes: string | null; created_at: string }[]>(
      `SELECT action, admin_label, sap_user_code, notes, created_at FROM ar_document_events WHERE company_id = ? AND ar_document_id = ? ORDER BY id DESC`, [companyId, id]
    ),
    mySapUserCode(session),
  ]);
  const approval = await approvalOf(doc);
  if (session.adminId) await markNotificationsRead(session.adminId, { arDocId: id }).catch(() => undefined);
  const fromPortal = doc.source !== "sap";
  // A request raised in the SAP client belongs to its SAP originator (posted_sap_user).
  const isOwner = session.isSuperAdmin
    || (fromPortal ? doc.created_by !== null && doc.created_by === session.adminId : !!me && lc(me) === lc(doc.posted_sap_user));
  return {
    doc, lines, events, approval, sapUser: me,
    can: {
      edit: fromPortal && isOwner && EDITABLE.includes(doc.status),
      post: fromPortal && isOwner && EDITABLE.includes(doc.status),
      delete: fromPortal && isOwner && ["draft", "failed"].includes(doc.status),
      decide: isMyTurn(approval, me),
      // After the final approval, the creator or an authorizer adds the approved draft as the invoice.
      generate: doc.status === "approved" && (isOwner || (approval?.stages.some((st) => st.lines.some((l) => lc(l.userCode) === lc(me))) ?? false)),
    },
  };
}

// ── Write ──────────────────────────────────────────────────────────────

async function nextDocNumber(): Promise<string> {
  const d = new Date(Date.now() + 7 * 3600 * 1000); // Vietnam date
  const prefix = `ARI${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const r = await queryOne<{ n: string | null }>(
    `SELECT MAX(CAST(SUBSTRING(doc_number, ${prefix.length + 1}) AS UNSIGNED)) AS n FROM ar_documents WHERE company_id = ? AND doc_number LIKE ?`,
    [getCompanyId(), `${prefix}%`]
  );
  return `${prefix}${String(num(r?.n) + 1).padStart(3, "0")}`;
}

/** Checks an AR Invoice against the user's permissions and SAP's item master — what saveArInvoice would write. */
export async function prepareArInvoice(session: AdminSession, id: number | null, input: ArInvoiceInput) {
  let existing: ArDocRow | null = null;
  if (id !== null) {
    existing = await loadDoc(session, id);
    if (!existing) throw new ArError("AR Invoice not found", 404);
    if (existing.source === "sap") throw new ArError("This AR Invoice was entered in SAP — change it in SAP", 409);
    if (!(session.isSuperAdmin || existing.created_by === session.adminId)) throw new ArError("Only the person who created this AR Invoice can change it", 403);
    if (!EDITABLE.includes(existing.status)) throw new ArError(`An AR Invoice that is ${existing.status.replace("_", " ")} can't be changed`, 409);
  }
  const cardCode = String(input.cardCode ?? "").trim();
  const customer = cardCode ? await getCustomerForAdmin(session, cardCode) : null;
  if (!customer) throw new ArError("Choose a customer within your data permissions");
  for (const [k, v] of [["Posting date", input.docDate], ["Due date", input.dueDate]] as const) if (!DATE_RE.test(String(v ?? ""))) throw new ArError(`${k} is required`);
  const taxDate = input.taxDate && DATE_RE.test(input.taxDate) ? input.taxDate : input.docDate;
  if (input.dueDate < input.docDate) throw new ArError("Due date is before the posting date");
  const wh = input.warehouseCode?.trim() || null;
  if (wh && !(await getAdminWarehouseCodes(session)).includes(wh)) throw new ArError(`Warehouse ${wh} is not one of your warehouses`);
  const headerBrand = input.brandCode?.trim() || null;
  if (headerBrand && !(await arBrandOptions(session)).some((b) => b.code === headerBrand)) throw new ArError(`Brand ${headerBrand} is not one of your brands`);
  const lines = (input.lines ?? []).filter((l) => String(l.itemCode ?? "").trim());
  if (lines.length === 0) throw new ArError("Add at least one line");
  if (lines.length > 200) throw new ArError("At most 200 lines");
  const items = new Map((await searchArItems(session, "", [...new Set(lines.map((l) => l.itemCode.trim()))])).map((i) => [i.itemCode, i]));
  const rbtRefs = lines.map((l) => (l.rbtRef ? Number(l.rbtRef) : null)).filter((x): x is number => x !== null);
  if (new Set(rbtRefs).size !== rbtRefs.length) throw new ArError("The same rebate is on two lines");
  const rebates = new Map((await getRebates(customer.sap_card_code, rbtRefs, id)).map((r) => [r.docEntry, r]));
  const clean = lines.map((l, i) => {
    const it = items.get(l.itemCode.trim());
    if (!it) throw new ArError(`Line ${i + 1}: ${l.itemCode} is not a sellable service item within your brands`);
    if (headerBrand && it.brandCode && it.brandCode !== headerBrand) throw new ArError(`Line ${i + 1}: ${it.itemCode} is brand ${it.brandCode}, not ${headerBrand}`);
    const quantity = Number(l.quantity), unitPrice = Number(l.unitPrice), discountPct = Number(l.discountPct ?? 0);
    if (!Number.isFinite(quantity) || quantity === 0) throw new ArError(`Line ${i + 1}: quantity can't be 0`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ArError(`Line ${i + 1}: enter a unit price (0 or more)`);
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) throw new ArError(`Line ${i + 1}: discount must be 0–100%`);
    const vatGroup = (l.vatGroup ?? "").trim() || it.vatGroup;
    const rbt = l.rbtRef ? rebates.get(Number(l.rbtRef)) : undefined;
    if (l.rbtRef) {
      if (!rbt) throw new ArError(`Line ${i + 1}: rebate ${l.rbtRef} is not an open rebate of ${customer.sap_card_code}`);
      if (rbt.usedBy) throw new ArError(`Line ${i + 1}: rebate ${rbt.code} is already on ${rbt.usedBy}`);
      const amount = Math.abs(lineTotalOf({ quantity, unitPrice, discountPct }));
      if (amount > rbt.amount + 1) throw new ArError(`Line ${i + 1}: ${amount.toLocaleString("en-US")} is more than rebate ${rbt.code}'s ${rbt.amount.toLocaleString("en-US")}`);
    }
    return {
      line_no: i + 1, item_code: it.itemCode, item_name: it.itemName, uom: it.uom, quantity, unit_price: unitPrice, discount_pct: discountPct,
      vat_group: vatGroup, brand_code: it.brandCode, item_tax_class: it.itemTaxClass,
      description: (l.description ?? "").trim().slice(0, 254) || null,
      line_total: lineTotalOf({ quantity, unitPrice, discountPct }),
      rbt_ref: rbt?.docEntry ?? null, rbt_code: rbt?.code ?? null, rbt_name: rbt?.name ?? null,
    };
  });
  const totalBefore = clean.reduce((t, l) => t + l.line_total, 0);
  const vatSum = clean.reduce((t, l) => t + Math.round((l.line_total * (vatRateOf(l.vat_group) ?? 0)) / 100), 0);
  return { existing, customer, taxDate, wh, headerBrand, clean, totalBefore, vatSum };
}

/** Create (id = null) or update a portal AR Invoice — validated against the user's permissions and SAP's item master. */
export async function saveArInvoice(session: AdminSession, id: number | null, input: ArInvoiceInput): Promise<number> {
  const companyId = getCompanyId();
  const { existing, customer, taxDate, wh, headerBrand, clean, totalBefore, vatSum } = await prepareArInvoice(session, id, input);
  const trim = (v: string | null | undefined, n: number) => (v ?? "").trim().slice(0, n) || null;
  const header = [
    customer.sap_card_code, customer.card_name, trim(input.billToCode, 100), trim(input.shipToCode, 100),
    trim(input.invName, 200) ?? customer.card_name, trim(input.invTaxNo, 20) ?? customer.mst_code, trim(input.invAddress, 200),
    input.docDate, input.dueDate, taxDate, trim(input.numAtCard, 100), trim(input.comments, 254), wh, trim(input.departmentCode, 20),
    round2(totalBefore), round2(vatSum), round2(totalBefore + vatSum),
  ];
  let docId = id;
  if (docId === null) {
    const ins = await query<{ insertId: number }>(
      `INSERT INTO ar_documents (company_id, doc_kind, doc_number, status, sap_card_code, card_name, bill_to_code, ship_to_code, inv_name, inv_tax_no, inv_address,
         doc_date, due_date, tax_date, num_at_card, comments, warehouse_code, department_code, total_before_vat, vat_sum, doc_total, created_by, created_by_label)
       VALUES (?, 'invoice', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, await nextDocNumber(), ...header, session.adminId, session.userid || session.email]
    );
    docId = (ins as unknown as { insertId: number }).insertId;
    await event(docId, "created", session, null, null);
  } else {
    await query(
      `UPDATE ar_documents SET sap_card_code = ?, card_name = ?, bill_to_code = ?, ship_to_code = ?, inv_name = ?, inv_tax_no = ?, inv_address = ?,
         doc_date = ?, due_date = ?, tax_date = ?, num_at_card = ?, comments = ?, warehouse_code = ?, department_code = ?, total_before_vat = ?, vat_sum = ?, doc_total = ?,
         status = 'draft', last_error = NULL WHERE company_id = ? AND id = ?`,
      [...header, companyId, docId]
    );
    await event(docId, "updated", session, null, existing?.status !== "draft" ? `was ${existing?.status}` : null);
  }
  const lineBrands = [...new Set(clean.map((l) => l.brand_code).filter(Boolean))];
  await query(`UPDATE ar_documents SET brand_code = ? WHERE company_id = ? AND id = ?`, [headerBrand ?? (lineBrands.length === 1 ? lineBrands[0] : null), companyId, docId]);
  await query(`DELETE FROM ar_document_lines WHERE company_id = ? AND ar_document_id = ?`, [companyId, docId]);
  for (const l of clean) {
    await query(
      `INSERT INTO ar_document_lines (company_id, ar_document_id, line_no, item_code, item_name, uom, quantity, unit_price, discount_pct, vat_group, brand_code, item_tax_class, description, line_total, rbt_ref, rbt_code, rbt_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, docId, l.line_no, l.item_code, l.item_name, l.uom, l.quantity, l.unit_price, l.discount_pct, l.vat_group, l.brand_code, l.item_tax_class, l.description, l.line_total, l.rbt_ref, l.rbt_code, l.rbt_name]
    );
  }
  return docId;
}

export async function deleteArInvoice(session: AdminSession, id: number) {
  const doc = await loadDoc(session, id);
  if (!doc) throw new ArError("AR Invoice not found", 404);
  if (doc.source === "sap") throw new ArError("This AR Invoice was entered in SAP — it can't be deleted here", 409);
  if (!(session.isSuperAdmin || doc.created_by === session.adminId)) throw new ArError("Only the person who created this AR Invoice can delete it", 403);
  if (!["draft", "failed"].includes(doc.status)) throw new ArError("Only a draft (not yet in SAP) can be deleted", 409);
  const companyId = getCompanyId();
  await query(`DELETE FROM ar_document_lines WHERE company_id = ? AND ar_document_id = ?`, [companyId, id]);
  await query(`DELETE FROM ar_documents WHERE company_id = ? AND id = ?`, [companyId, id]);
  await event(id, "deleted", session, null, doc.doc_number);
}

function credentialError(e: unknown): never {
  if (e instanceof SapPasswordInvalidError) throw new ArError(e.message, 428, "sap_password_invalid");
  if (e instanceof SapSessionExpiredError) throw new ArError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  throw e;
}

/** The Service Layer A/R Invoice payload for a portal document. */
async function buildPayload(session: AdminSession, doc: ArDocRow, lines: ArLineRow[]) {
  const companyId = getCompanyId();
  const admin = await queryOne<{ department_code: string | null; owner_code: string | null }>(
    `SELECT department_code, owner_code FROM admin_users WHERE company_id = ? AND id = ?`, [companyId, session.adminId]
  );
  const costCenter = await queryOne<{ ocr_code: string }>(
    `SELECT ocr_code FROM cost_centers WHERE company_id = ? AND dimension = 3 AND ocr_code = ?`, [companyId, doc.sap_card_code]
  );
  const dept = doc.department_code || admin?.department_code || undefined;
  const cc3 = costCenter?.ocr_code || undefined;
  const sap = getSapClient();
  const [bp, owner] = await Promise.all([
    sap.getBusinessPartner(doc.sap_card_code),
    isFillOwnerEnabled() ? sap.resolveOrderOwner(admin?.owner_code || null) : Promise.resolve(null),
  ]);
  const brands = [...new Set(lines.map((l) => l.brand_code).filter(Boolean))];
  // A discount (CKTM) invoice = every line negative (Qty −1 × price) — SAP's typed-in ones are all
  // U_TransType 1302 / U_InvType 4 ("adjustment – decrease"); other service invoices are 1301 / 0.
  const isDiscount = lines.length > 0 && lines.every((l) => Number(l.line_total) < 0);
  return {
    CardCode: doc.sap_card_code,
    DocDate: doc.doc_date,
    DocDueDate: doc.due_date,
    TaxDate: doc.tax_date,
    // NumAtCard is left to SAP — it numbers every A/R invoice itself (10172, 10181, …).
    Comments: doc.comments || undefined,
    JournalMemo: (doc.comments || "").slice(0, 50) || undefined,
    // E-invoice fields — the same on all 423 typed-in service invoices in SAP (last 6 months):
    // form 1/005, series C<yy>TMV (posting year), tax category 1001, issue = Y, customer invoice format 10.
    U_InvDate: doc.doc_date,
    U_MauHD: "1/005",
    U_InvSeri: `C${doc.doc_date.slice(2, 4)}TMV`,
    U_InvTaxCat: "1001",
    U_InvIssue: "Y",
    U_CusInvFmt: "10",
    PayToCode: doc.bill_to_code || undefined,
    ShipToCode: doc.ship_to_code || undefined,
    U_RelDocs: doc.doc_number || undefined,
    U_ProdBrand: doc.brand_code || (brands.length === 1 ? brands[0] : undefined),
    // As on the typed-in invoices in SAP: service document; rebate date = posting date.
    U_DocType: "S",
    U_RBTDate: doc.doc_date,
    U_TransType: isDiscount || lines.some((l) => l.rbt_ref) ? "1302" : "1301",
    U_InvType: isDiscount || lines.some((l) => l.rbt_ref) ? "4" : "0",
    U_BPPaymentMethod: "TM/CK",
    U_InvEmail: bp?.EmailAddress || undefined,
    U_InvName: (doc.inv_name || bp?.CardName || "").slice(0, 200) || undefined,
    U_InvTaxNo: (doc.inv_tax_no || bp?.FederalTaxID || "").slice(0, 20) || undefined,
    U_InvAddress: (doc.inv_address || bp?.Address || "").slice(0, 200) || undefined,
    ...(owner ? { DocumentsOwner: owner.employeeId, U_OwnerName: owner.ownerName } : {}),
    DocumentLines: lines.map((l, i) => ({
      ItemCode: l.item_code,
      U_BaseLine: i,
      U_RBTRef: l.rbt_ref ?? undefined,
      Quantity: Number(l.quantity),
      UnitPrice: Number(l.unit_price),
      DiscountPercent: Number(l.discount_pct) || undefined,
      VatGroup: l.vat_group || undefined,
      WarehouseCode: doc.warehouse_code || undefined,
      CostingCode: l.brand_code || undefined,
      COGSCostingCode: l.brand_code || undefined,
      CostingCode2: dept,
      COGSCostingCode2: dept,
      CostingCode3: cc3,
      COGSCostingCode3: cc3,
      U_INVDesc: l.description || l.item_name || undefined,
      U_ItemTaxClass: l.item_tax_class || undefined,
      // Unit name printed on the e-invoice — "LẦN" (time) on SAP's discount lines.
      U_UomName2: Number(l.line_total) < 0 ? "LẦN" : undefined,
    })),
  };
}

/** Notify the current stage's pending authorizers of the request this AR document waits on. */
export async function notifyStage(docId: number, req: ArApprovalRequest, opts: { actor?: string | null; excludeAdminId?: number | null; reason?: string | null } = {}) {
  if (req.status !== "W") return 0;
  const stage = req.stages.find((st) => st.wstCode === req.currStep);
  const waitingFor = stage?.lines.filter((l) => l.status === "W").map((l) => l.userCode) ?? [];
  if (!waitingFor.length) return 0;
  const doc = await queryOne<{ doc_number: string | null; sap_card_code: string; card_name: string | null; doc_total: number }>(
    `SELECT doc_number, sap_card_code, card_name, doc_total FROM ar_documents WHERE company_id = ? AND id = ?`, [getCompanyId(), docId]
  );
  if (!doc) return 0;
  return notifyArApprovalNeeded(docId, waitingFor, {
    docNo: doc.doc_number ?? String(docId), cardCode: doc.sap_card_code, cardName: doc.card_name, total: Number(doc.doc_total),
    stage: stage ? `${stage.name}${req.templateName ? ` (${req.templateName})` : ""}` : req.templateName,
    actor: opts.actor, reason: opts.reason, excludeAdminId: opts.excludeAdminId,
  });
}

/** Remove rows the SAP-request sync imported for this request (source 'sap'), except `keepId`. */
export async function dropImportedCopies(wddCode: number, keepId: number | null) {
  const companyId = getCompanyId();
  const rows = await query<{ id: number }[]>(
    `SELECT id FROM ar_documents WHERE company_id = ? AND source = 'sap' AND sap_db = ? AND wdd_code = ? AND id <> ?`, [companyId, getHanaSchema(), wddCode, keepId ?? 0]
  );
  for (const r of rows) {
    await query(`DELETE FROM ar_document_lines WHERE company_id = ? AND ar_document_id = ?`, [companyId, r.id]);
    await query(`DELETE FROM ar_document_events WHERE company_id = ? AND ar_document_id = ?`, [companyId, r.id]);
    await query(`DELETE FROM ar_documents WHERE company_id = ? AND id = ?`, [companyId, r.id]);
  }
}

async function maxArWdd(): Promise<number> {
  const [r] = await queryHana<Record<string, unknown>>(`SELECT IFNULL(MAX("WddCode"), 0) AS "M" FROM ${S()}."OWDD" WHERE "ObjType" = '13'`);
  return num(r?.M);
}

/** The approval request SAP opened for this user's add, if any (newer than `after`). */
async function findNewRequest(after: number, sapUser: string): Promise<ArApprovalRequest | null> {
  const s = S();
  const [r] = await queryHana<Record<string, unknown>>(
    `SELECT MAX(W."WddCode") AS "W" FROM ${s}."OWDD" W JOIN ${s}."OUSR" U ON U."USERID" = W."OwnerID"
      WHERE W."ObjType" = '13' AND W."WddCode" > ${after} AND LOWER(U."USER_CODE") = ${lit(lc(sapUser))}`
  );
  return r?.W ? getArApprovalRequest(num(r.W)) : null;
}

export interface PostResult { status: ArStatus; sapDocNum: number | null; wddCode: number | null; templateName: string | null; waitingFor: string[]; message: string }

/**
 * Add the AR Invoice to SAP as the user's own SAP user. SAP either adds it
 * straight away or (an Approval Template applies) saves it as a Draft with an
 * approval request — either way the portal records what SAP did.
 */
export async function postArInvoice(session: AdminSession, id: number): Promise<PostResult> {
  const doc = await loadDoc(session, id);
  if (!doc) throw new ArError("AR Invoice not found", 404);
  if (doc.source === "sap") throw new ArError("This AR Invoice was entered in SAP — it is already there", 409);
  if (!(session.isSuperAdmin || doc.created_by === session.adminId)) throw new ArError("Only the person who created this AR Invoice can post it", 403);
  if (!EDITABLE.includes(doc.status)) throw new ArError(`This AR Invoice is already ${doc.status.replace("_", " ")}`, 409);
  const companyId = getCompanyId();
  const lines = await query<ArLineRow[]>(
    `SELECT line_no, item_code, item_name, uom, quantity, unit_price, discount_pct, vat_group, brand_code, item_tax_class, description, line_total, rbt_ref, rbt_code, rbt_name
       FROM ar_document_lines WHERE company_id = ? AND ar_document_id = ? ORDER BY line_no`, [companyId, id]
  );
  if (!lines.length) throw new ArError("Add at least one line");
  // Re-check the items against SAP and the user's brands (they may have changed since the draft was saved).
  const ok = new Set((await searchArItems(session, "", lines.map((l) => l.item_code))).map((i) => i.itemCode));
  const bad = lines.filter((l) => !ok.has(l.item_code)).map((l) => l.item_code);
  if (bad.length) throw new ArError(`Not sellable service items within your brands any more: ${bad.join(", ")}`);

  let sapSession: { sapUser: string } | null;
  try { sapSession = await ensureUserSapSession(session.adminId!); } catch (e) { credentialError(e); }
  if (!sapSession) throw new ArError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  const sapUser = sapSession.sapUser;

  const payload = await buildPayload(session, doc, lines);

  // An AR approval template applies to this user + invoice (originator + condition, as SAP decides)
  // → portal-run approval: save it in SAP as a Draft and wait for the template's authorizers.
  const preview = await previewArTemplates(doc.sap_card_code, lines.map((l) => l.item_code), sapUser);
  const needed = preview.filter((p) => p.applies !== false); // null = couldn't be evaluated → ask for approval, to be safe
  if (needed.length) return postForPortalApproval(session, doc, payload, needed.map((p) => p.wtmCode), sapUser);

  const before = await maxArWdd();
  let result: { DocEntry?: number; DocNum?: number } | null = null;
  let sapError: string | null = null;
  try {
    result = await sapRequestAsUser<{ DocEntry: number; DocNum: number }>(session.adminId!, "POST", "/Invoices", payload);
  } catch (e) {
    if (e instanceof SapPasswordInvalidError || e instanceof SapSessionExpiredError) credentialError(e);
    sapError = e instanceof Error ? e.message : String(e);
  }

  // An Approval Template applied → SAP saved a Draft and opened a request (whether the call "succeeded" or not).
  const req = await findNewRequest(before, sapUser).catch(() => null);
  if (req) {
    const waitingFor = req.stages.find((st) => st.wstCode === req.currStep)?.lines.filter((l) => l.status === "W").map((l) => l.userCode) ?? [];
    // The SAP-request sync may have pulled this request in already (between the add and here) — this doc owns it.
    await dropImportedCopies(req.wddCode, id);
    await query(
      `UPDATE ar_documents SET status = 'pending_approval', sap_db = ?, wdd_code = ?, wtm_code = ?, template_name = ?, sap_draft_entry = ?, posted_by = ?, posted_sap_user = ?,
              sap_doc_entry = NULL, sap_doc_num = NULL, last_error = NULL WHERE company_id = ? AND id = ?`,
      [getHanaSchema(), req.wddCode, req.wtmCode, req.templateName, req.draftEntry, session.adminId, sapUser, companyId, id]
    );
    await event(id, "sent_for_approval", session, sapUser, `${req.templateName ?? `template ${req.wtmCode}`} · request #${req.wddCode} · waiting for ${waitingFor.join(", ") || "—"}`);
    await notifyStage(id, req, { actor: session.userid || session.email, excludeAdminId: session.adminId }).catch((e) => console.warn("[AR Invoice] notify failed:", e));
    return { status: "pending_approval", sapDocNum: null, wddCode: req.wddCode, templateName: req.templateName, waitingFor,
      message: `SAP needs approval (${req.templateName ?? "approval template"}) — waiting for ${waitingFor.join(", ") || "the approvers"}.` };
  }
  if (result?.DocEntry && !sapError) {
    const [inv] = await queryHana<Record<string, unknown>>(`SELECT "DocNum" FROM ${S()}."OINV" WHERE "DocEntry" = ${Number(result.DocEntry)}`).catch(() => []);
    const docNum = inv ? num(inv.DocNum) : result.DocNum ?? null;
    await query(
      `UPDATE ar_documents SET status = 'posted', sap_db = ?, sap_doc_entry = ?, sap_doc_num = ?, posted_by = ?, posted_sap_user = ?, posted_at = NOW(), last_error = NULL,
              wdd_code = NULL, wtm_code = NULL, template_name = NULL, sap_draft_entry = NULL WHERE company_id = ? AND id = ?`,
      [getHanaSchema(), result.DocEntry, docNum, session.adminId, sapUser, companyId, id]
    );
    await event(id, "posted", session, sapUser, `SAP A/R Invoice ${docNum ?? result.DocEntry} (no approval needed)`);
    return { status: "posted", sapDocNum: docNum, wddCode: null, templateName: null, waitingFor: [], message: `Added to SAP as A/R Invoice ${docNum ?? result.DocEntry}.` };
  }
  const msg = sapError ?? "SAP returned no document";
  await query(`UPDATE ar_documents SET status = 'failed', last_error = ?, posted_sap_user = ? WHERE company_id = ? AND id = ?`, [msg.slice(0, 2000), sapUser, companyId, id]);
  await event(id, "failed", session, sapUser, msg);
  throw new ArError(`SAP refused the AR Invoice: ${msg}`, 502, "sap_error");
}

/**
 * "Post to SAP" when an approval template applies: the invoice goes to SAP as a
 * Draft (SAP assigns its U_DocNo) and waits on the portal as "Adm Confirmed"
 * for the template's stage authorizers. A previous draft of this document
 * (posted, then rejected and edited) is removed first.
 */
async function postForPortalApproval(session: AdminSession, doc: ArDocRow, payload: Record<string, unknown>, wtmCodes: number[], sapUser: string): Promise<PostResult> {
  const companyId = getCompanyId();
  const id = doc.id;
  const templates = (await arTemplateStages(wtmCodes)).filter((t) => t.stages.length > 0);
  if (!templates.length) throw new ArError("The SAP approval template has no stages — check it in SAP", 409);
  if (doc.approval_mode === "portal" && doc.sap_draft_entry && !doc.sap_doc_entry) {
    await sapRequestAsUser(session.adminId!, "DELETE", `/Drafts(${Number(doc.sap_draft_entry)})`).catch((e) =>
      console.warn(`[AR Invoice] removing old draft ${doc.sap_draft_entry} failed:`, e instanceof Error ? e.message : e));
  }
  let draft: { DocEntry?: number; DocNum?: number; U_DocNo?: string | null } | null = null;
  try {
    draft = await sapRequestAsUser<{ DocEntry: number; DocNum: number; U_DocNo?: string | null }>(session.adminId!, "POST", "/Drafts", { ...payload, DocObjectCode: "oInvoices" });
  } catch (e) {
    if (e instanceof SapPasswordInvalidError || e instanceof SapSessionExpiredError) credentialError(e);
    const msg = e instanceof Error ? e.message : String(e);
    await query(`UPDATE ar_documents SET status = 'failed', last_error = ?, posted_sap_user = ? WHERE company_id = ? AND id = ?`, [msg.slice(0, 2000), sapUser, companyId, id]);
    await event(id, "failed", session, sapUser, msg);
    throw new ArError(`SAP refused the AR Invoice draft: ${msg}`, 502, "sap_error");
  }
  const draftEntry = Number(draft?.DocEntry) || null;
  if (!draftEntry) throw new ArError("SAP returned no draft", 502, "sap_error");
  // The AR. No SAP assigned to the draft (read back — the add response may not carry UDFs).
  let docNo = str(draft?.U_DocNo);
  if (!docNo) {
    docNo = await sapRequestAsUser<Record<string, unknown>>(session.adminId!, "GET", `/Drafts(${draftEntry})?$select=DocEntry,U_DocNo`)
      .then((d) => str(d.U_DocNo)).catch(() => null);
  }
  const approval: PortalApproval = { templates, decisions: [] };
  await query(
    `UPDATE ar_documents SET status = 'pending_approval', sap_db = ?, approval_mode = 'portal', portal_approval = ?, wdd_code = NULL, wtm_code = ?, template_name = ?,
            sap_draft_entry = ?, sap_doc_no = ?, posted_by = ?, posted_sap_user = ?, sap_doc_entry = NULL, sap_doc_num = NULL, last_error = NULL
      WHERE company_id = ? AND id = ?`,
    [getHanaSchema(), JSON.stringify(approval), templates[0].wtmCode, templates.map((t) => t.name).join(" + ").slice(0, 100),
      draftEntry, docNo, session.adminId, sapUser, companyId, id]
  );
  const req = portalRequest({ portal_approval: approval, sap_draft_entry: draftEntry, sap_doc_entry: null, status: "pending_approval" })!;
  const waitingFor = req.stages.find((st) => st.wstCode === req.currStep)?.lines.map((l) => l.userCode) ?? [];
  await event(id, "sent_for_approval", session, sapUser,
    `Adm Confirmed — SAP draft ${draftEntry}${docNo ? ` (${docNo})` : ""} · ${req.templateName} · waiting for ${waitingFor.join(", ") || "—"}`);
  await notifyStage(id, req, { actor: session.userid || session.email, excludeAdminId: session.adminId }).catch((e) => console.warn("[AR Invoice] notify failed:", e));
  return {
    status: "pending_approval", sapDocNum: null, wddCode: null, templateName: req.templateName, waitingFor,
    message: `Adm Confirmed — saved in SAP as a draft${docNo ? ` (AR. No ${docNo})` : ""}; waiting for ${waitingFor.join(", ") || "the approvers"} to approve (${req.templateName}).`,
  };
}

/** Approve / Reject a portal-run approval as the signed-in authorizer; the final approval adds the SAP draft as the invoice. */
async function decidePortalApproval(session: AdminSession, doc: ArDocRow, decision: "approved" | "rejected", remarks: string) {
  const companyId = getCompanyId();
  const req = portalRequest(doc);
  const me = await mySapUserCode(session);
  if (doc.status !== "pending_approval" || !isMyTurn(req, me)) throw new ArError("This AR Invoice isn't waiting for your approval", 403, "not_your_stage");
  let sapSession: { sapUser: string } | null;
  try { sapSession = await ensureUserSapSession(session.adminId!); } catch (e) { credentialError(e); }
  if (!sapSession) throw new ArError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  if (lc(sapSession.sapUser) !== lc(me)) throw new ArError(`Signed in to SAP as ${sapSession.sapUser}, but your SAP user is ${me}. Update it in My Profile.`, 409);

  const pa = parsePortalApproval(doc.portal_approval)!;
  pa.decisions.push({ wstCode: req!.currStep, userCode: me!, decision: decision === "approved" ? "Y" : "N", remarks: remarks.slice(0, 254) || null, at: new Date().toISOString() });
  const after = portalRequest({ ...doc, portal_approval: pa })!;
  const nextStatus: ArStatus = after.status === "N" ? "rejected" : after.status === "Y" ? "approved" : "pending_approval";
  await query(`UPDATE ar_documents SET portal_approval = ?, status = ? WHERE company_id = ? AND id = ?`, [JSON.stringify(pa), nextStatus, companyId, doc.id]);
  const stageName = req!.stages.find((st) => st.wstCode === req!.currStep)?.name;
  await event(doc.id, decision === "approved" ? "approved" : "rejected", session, sapSession.sapUser, `${stageName ? `${stageName}: ` : ""}${remarks || ""}`.trim() || null);

  if (after.status === "N") return { message: "Rejected. The creator can edit the invoice and post it again." };
  if (after.status === "Y") {
    const gen = await generateFromDraft(session, { ...doc, status: "approved" }, after, sapSession.sapUser);
    return { message: gen.ok ? `Final approval — ${gen.message}` : `Final approval done, but adding the invoice failed: ${gen.message}. Press "Add to SAP" to try again.` };
  }
  const waiting = after.stages.find((st) => st.wstCode === after.currStep)?.lines.filter((l) => l.status === "W").map((l) => l.userCode) ?? [];
  if (after.currStep !== req!.currStep) {
    await notifyStage(doc.id, after, { actor: sapSession.sapUser, excludeAdminId: session.adminId, reason: stageName ? `${stageName} approved` : null })
      .catch((e) => console.warn("[AR Invoice] notify failed:", e));
  }
  return { message: `Approved. Now waiting for ${waiting.join(", ") || "the next stage"}.` };
}

/** Add the approved Draft as the A/R Invoice (as the user's own SAP user). */
async function generateFromDraft(session: AdminSession, doc: ArDocRow, req: ArApprovalRequest, sapUser: string): Promise<{ ok: boolean; message: string }> {
  const draft = req.draftEntry ?? doc.sap_draft_entry;
  if (!draft) return { ok: false, message: "SAP has no draft for this request" };
  try {
    await sapRequestAsUser(session.adminId!, "POST", "/DraftsService_SaveDraftToDocument", { Document: { DocEntry: draft } });
  } catch (e) {
    if (e instanceof SapPasswordInvalidError || e instanceof SapSessionExpiredError) credentialError(e);
    const m = e instanceof Error ? e.message : String(e);
    await event(doc.id, "failed", session, sapUser, `Add approved draft ${draft}: ${m}`);
    return { ok: false, message: m };
  }
  const fresh = { ...doc, status: "approved" as ArStatus };
  const patch = await syncFromSap(fresh);
  if (patch.status !== "posted") {
    // SAP added it but OWDD doesn't say so yet — find the invoice by its draft key.
    const [inv] = await queryHana<Record<string, unknown>>(`SELECT "DocEntry", "DocNum" FROM ${S()}."OINV" WHERE "draftKey" = ${Number(draft)}`).catch(() => []);
    if (inv) {
      await query(`UPDATE ar_documents SET status = 'posted', sap_doc_entry = ?, sap_doc_num = ?, posted_at = NOW() WHERE company_id = ? AND id = ?`,
        [num(inv.DocEntry), num(inv.DocNum), getCompanyId(), doc.id]);
      await event(doc.id, "posted", session, sapUser, `SAP A/R Invoice ${num(inv.DocNum)}`);
      return { ok: true, message: `Added to SAP as A/R Invoice ${num(inv.DocNum)}.` };
    }
  } else {
    await event(doc.id, "posted", session, sapUser, `SAP A/R Invoice ${patch.sap_doc_num ?? patch.sap_doc_entry}`);
    return { ok: true, message: `Added to SAP as A/R Invoice ${patch.sap_doc_num ?? patch.sap_doc_entry}.` };
  }
  return { ok: true, message: "SAP accepted the add; the invoice number will show after refresh." };
}

/**
 * Approve / Reject the SAP approval request as the user's own SAP user (a
 * pending authorizer of the current stage) — what SAP's Approval Decision
 * Report does. After the final approval the draft is added as the invoice.
 */
export async function decideArInvoice(session: AdminSession, id: number, decision: "approved" | "rejected", remarksRaw: string) {
  const doc = await loadDoc(session, id);
  if (!doc) throw new ArError("AR Invoice not found", 404);
  if (doc.approval_mode === "portal") {
    const r = remarksRaw.trim();
    if (decision === "rejected" && !r) throw new ArError("Write the reason for rejecting");
    return decidePortalApproval(session, doc, decision, r);
  }
  if (!doc.wdd_code) throw new ArError("This AR Invoice has no SAP approval request", 409);
  const req = await getArApprovalRequest(doc.wdd_code);
  const me = await mySapUserCode(session);
  if (!isMyTurn(req, me)) throw new ArError("This AR Invoice isn't waiting for your approval", 403, "not_your_stage");
  const remarks = remarksRaw.trim();
  if (decision === "rejected" && !remarks) throw new ArError("Write the reason for rejecting");
  let sapSession: { sapUser: string } | null;
  try { sapSession = await ensureUserSapSession(session.adminId!); } catch (e) { credentialError(e); }
  if (!sapSession) throw new ArError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  if (lc(sapSession.sapUser) !== lc(me)) throw new ArError(`Signed in to SAP as ${sapSession.sapUser}, but your SAP user is ${me}. Update it in My Profile.`, 409);

  try {
    await sapRequestAsUser(session.adminId!, "PATCH", `/ApprovalRequests(${doc.wdd_code})`, {
      ApprovalRequestDecisions: [{ Status: decision === "approved" ? "ardApproved" : "ardNotApproved", Remarks: remarks.slice(0, 254) || undefined }],
    });
  } catch (e) { credentialError(e); }
  await event(id, decision === "approved" ? "approved" : "rejected", session, sapSession.sapUser, remarks || null);

  const after = await getArApprovalRequest(doc.wdd_code);
  let message = decision === "approved" ? "Approved." : "Rejected.";
  if (after?.status === "Y") {
    await query(`UPDATE ar_documents SET status = 'approved' WHERE company_id = ? AND id = ?`, [getCompanyId(), id]);
    const gen = await generateFromDraft(session, { ...doc, status: "approved" }, after, sapSession.sapUser);
    message = gen.ok ? `Final approval — ${gen.message}` : `Final approval done, but adding the invoice failed: ${gen.message}. The creator can press "Add to SAP".`;
  } else if (after) {
    const syncPatch = await syncFromSap(doc);
    if (after.status === "W") {
      const waiting = after.stages.find((st) => st.wstCode === after.currStep)?.lines.filter((l) => l.status === "W").map((l) => l.userCode) ?? [];
      message = `${message} Now waiting for ${waiting.join(", ") || "the next stage"}.`;
      if (req && after.currStep !== req.currStep) {
        const passed = req.stages.find((st) => st.wstCode === req.currStep)?.name;
        await notifyStage(id, after, { actor: sapSession.sapUser, excludeAdminId: session.adminId, reason: passed ? `${passed} approved` : null })
          .catch((e) => console.warn("[AR Invoice] notify failed:", e));
      }
    } else if (syncPatch.status) message = `${message} SAP status: ${syncPatch.status}.`;
  }
  return { message };
}

/** "Add to SAP" for an approved request whose draft wasn't added yet. */
export async function generateArInvoice(session: AdminSession, id: number) {
  const detail = await getArInvoice(session, id);
  if (!detail) throw new ArError("AR Invoice not found", 404);
  if (!detail.can.generate || !detail.approval) throw new ArError("This AR Invoice isn't approved and waiting to be added", 409);
  let sapSession: { sapUser: string } | null;
  try { sapSession = await ensureUserSapSession(session.adminId!); } catch (e) { credentialError(e); }
  if (!sapSession) throw new ArError("Save your SAP user and password in My Profile first", 428, "sap_login_required");
  const r = await generateFromDraft(session, detail.doc, detail.approval, sapSession.sapUser);
  if (!r.ok) throw new ArError(`SAP refused: ${r.message}`, 502, "sap_error");
  return { message: r.message };
}
