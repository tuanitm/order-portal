import { queryHana, getHanaSchema } from "@/lib/hana/client";
import type { ProcedureProgress, StageProgress, TemplateProgress, StageDecision } from "@/lib/soApproval/sapProcedure";

/**
 * SAP B1's own approval requests for Sales Orders — what SAP's "Approval
 * Status Report" / "Approval Decision Report" work on:
 *
 *   OWDD  one request per document update that needs approval (Status W
 *         pending, Y approved, N not approved, P/A document generated,
 *         C cancelled; CurrStep = current stage; DraftEntry = the drafted change)
 *   WDD1  one line per stage authorizer (StepCode, UserID, Status W/Y/N, Remarks)
 *
 * How a portal order gets one: the push creates the Sales Order with
 * U_DataStatus = I, then updates it to C as the portal's SAP user. When an
 * Approval Template applies (its condition fires on U_DataStatus C and that
 * user is a template originator), SAP keeps the SO at I and opens a request;
 * the stage authorizers decide; after the final approval the drafted change
 * (U_DataStatus C) is applied to the SO.
 */
export type SapRequestStatus = "W" | "Y" | "N" | "P" | "A" | "C";

export interface SapApprovalRequest {
  wddCode: number;
  wtmCode: number;
  templateName: string | null;
  docEntry: number;
  status: SapRequestStatus;
  currStep: number;
  isDraft: boolean;
  draftEntry: number | null;
  createdAt: string | null;
  lines: {
    stepCode: number;
    userId: number;
    userCode: string;
    userName: string | null;
    status: "W" | "Y" | "N";
    remarks: string | null;
    updatedAt: string | null;
  }[];
  stages: { wstCode: number; name: string; remarks: string | null; sortId: number; maxReqr: number; maxRejReqr: number }[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** The LATEST approval request of each Sales Order (by SAP DocEntry), with its lines and the template's stages. */
export async function getSoApprovalRequests(docEntries: number[]): Promise<Map<number, SapApprovalRequest>> {
  const out = new Map<number, SapApprovalRequest>();
  const ids = [...new Set(docEntries.filter((d) => Number.isInteger(d) && d > 0))];
  if (ids.length === 0) return out;
  const s = `"${getHanaSchema()}"`;
  const reqs = await queryHana<Record<string, unknown>>(
    `SELECT W."WddCode", W."WtmCode", T."Name" AS "TemplateName", W."DocEntry", W."Status", W."CurrStep", W."IsDraft", W."DraftEntry", W."CreateDate"
       FROM ${s}."OWDD" W LEFT JOIN ${s}."OWTM" T ON T."WtmCode" = W."WtmCode"
      WHERE W."ObjType" = '17' AND W."DocEntry" IN (${ids.join(",")})
        AND W."WddCode" = (SELECT MAX(X."WddCode") FROM ${s}."OWDD" X WHERE X."ObjType" = '17' AND X."DocEntry" = W."DocEntry")`
  );
  if (reqs.length === 0) return out;
  const wdds = reqs.map((r) => num(r.WddCode));
  const wtms = [...new Set(reqs.map((r) => num(r.WtmCode)))];
  const [lines, stages] = await Promise.all([
    queryHana<Record<string, unknown>>(
      `SELECT D."WddCode", D."StepCode", D."UserID", U."USER_CODE", U."U_NAME", D."Status", D."Remarks", D."UpdateDate", D."UpdateTime"
         FROM ${s}."WDD1" D LEFT JOIN ${s}."OUSR" U ON U."USERID" = D."UserID"
        WHERE D."WddCode" IN (${wdds.join(",")}) ORDER BY D."WddCode", D."StepCode", D."UserID"`
    ),
    queryHana<Record<string, unknown>>(
      `SELECT W."WtmCode", W."WstCode", W."SortId", S."Name", S."Remarks", S."MaxReqr", S."MaxRejReqr"
         FROM ${s}."WTM2" W JOIN ${s}."OWST" S ON S."WstCode" = W."WstCode"
        WHERE W."WtmCode" IN (${wtms.join(",")}) ORDER BY W."WtmCode", W."SortId"`
    ),
  ]);
  for (const r of reqs) {
    const wdd = num(r.WddCode);
    const wtm = num(r.WtmCode);
    out.set(num(r.DocEntry), {
      wddCode: wdd, wtmCode: wtm, templateName: str(r.TemplateName), docEntry: num(r.DocEntry),
      status: String(r.Status) as SapRequestStatus, currStep: num(r.CurrStep), isDraft: r.IsDraft === "Y",
      draftEntry: r.DraftEntry === null || r.DraftEntry === undefined ? null : num(r.DraftEntry), createdAt: str(r.CreateDate),
      lines: lines.filter((l) => num(l.WddCode) === wdd).map((l) => ({
        stepCode: num(l.StepCode), userId: num(l.UserID), userCode: String(l.USER_CODE ?? l.UserID), userName: str(l.U_NAME),
        status: String(l.Status) as "W" | "Y" | "N", remarks: str(l.Remarks),
        updatedAt: l.UpdateDate ? `${String(l.UpdateDate).slice(0, 10)}${l.UpdateTime ? ` ${String(l.UpdateTime).padStart(4, "0").replace(/(\d\d)(\d\d)$/, "$1:$2")}` : ""}` : null,
      })),
      stages: stages.filter((x) => num(x.WtmCode) === wtm).map((x) => ({
        wstCode: num(x.WstCode), name: String(x.Name), remarks: str(x.Remarks), sortId: num(x.SortId),
        maxReqr: Math.max(1, num(x.MaxReqr)), maxRejReqr: Math.max(1, num(x.MaxRejReqr)),
      })),
    });
  }
  return out;
}

/** Portal ar_status for a request: W pending · Y/P/A approved · N not approved · C cancelled (treated as rejected). */
export function arStatusOf(req: SapApprovalRequest): "pending" | "approved" | "rejected" {
  return req.status === "W" ? "pending" : req.status === "N" || req.status === "C" ? "rejected" : "approved";
}

const lc = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** The request as stage-by-stage progress (the shape the SO Approval screens show). */
export function progressFromRequest(req: SapApprovalRequest | null): ProcedureProgress {
  if (!req) return { templates: [], noTemplate: true, state: "approved", waitingFor: [], allAuthorizers: [] };
  const overall = arStatusOf(req);
  // Stages from the template; any stage SAP has lines for but the template no longer lists is added.
  const defs = [...req.stages];
  for (const step of [...new Set(req.lines.map((l) => l.stepCode))]) {
    if (!defs.some((d) => d.wstCode === step)) defs.push({ wstCode: step, name: `Stage ${step}`, remarks: null, sortId: defs.length + 1, maxReqr: 1, maxRejReqr: 1 });
  }
  const curSort = defs.find((d) => d.wstCode === req.currStep)?.sortId ?? 0;
  const toDecision = (l: SapApprovalRequest["lines"][number], decision: "approved" | "rejected"): StageDecision => ({
    wtmCode: req.wtmCode, wstCode: l.stepCode, decision, sapUserCode: l.userCode, adminLabel: l.userName, at: l.updatedAt ?? "",
  });
  const stages: StageProgress[] = defs.map((d) => {
    const ls = req.lines.filter((l) => l.stepCode === d.wstCode);
    const approvals = ls.filter((l) => l.status === "Y").map((l) => toDecision(l, "approved"));
    const rejections = ls.filter((l) => l.status === "N").map((l) => toDecision(l, "rejected"));
    let state: StageProgress["state"];
    if (overall === "approved") state = "done";
    else if (overall === "rejected") state = rejections.length ? "rejected" : d.sortId < curSort ? "done" : "waiting";
    else state = d.sortId < curSort ? "done" : d.wstCode === req.currStep ? "current" : "waiting";
    return {
      ...d, approvals, rejections, state,
      authorizers: ls.map((l) => ({ userId: l.userId, userCode: l.userCode, name: l.userName })),
    };
  });
  const current = stages.find((x) => x.state === "current") ?? null;
  const template: TemplateProgress = {
    wtmCode: req.wtmCode, name: req.templateName ?? `Template ${req.wtmCode}`, stages, state: overall, current,
  };
  const waitingFor = overall === "pending"
    ? req.lines.filter((l) => l.stepCode === req.currStep && l.status === "W").map((l) => l.userCode)
    : [];
  return {
    templates: [template], noTemplate: false, state: overall, waitingFor,
    allAuthorizers: [...new Set(req.lines.map((l) => l.userCode))],
  };
}

/** Can this SAP user decide now (a pending line of theirs in the current stage)? */
export function myPendingLine(req: SapApprovalRequest | null, sapUserCode: string | null) {
  if (!req || req.status !== "W" || !lc(sapUserCode)) return null;
  return req.lines.find((l) => l.stepCode === req.currStep && l.status === "W" && lc(l.userCode) === lc(sapUserCode)) ?? null;
}

/** Would one more approval finish the request (last stage, enough approvals)? */
export function approvalCompletes(req: SapApprovalRequest): boolean {
  const stage = req.stages.find((s) => s.wstCode === req.currStep);
  const isLast = !req.stages.some((s) => stage && s.sortId > stage.sortId);
  const done = req.lines.filter((l) => l.stepCode === req.currStep && l.status === "Y").length;
  return isLast && done + 1 >= (stage?.maxReqr ?? 1);
}

// ── The SO Approval list: SAP's Sales Order approval requests ──────────

export interface SoApprovalFilters {
  /** pending = W · approved = Y/P/A · rejected = N/C · all */
  status: "pending" | "approved" | "rejected" | "all";
  /** Settings → "Approve SO from date" (YYYY-MM-DD) — never earlier than this. */
  fromDate: string | null;
  dateFrom?: string;
  dateTo?: string;
  brand?: string;
  /** SO No (U_DocNo) — contains; also matches DocNum. */
  soNo?: string;
  /** Business Partner code or name — contains. */
  bp?: string;
  /** Creator SAP user code (ORDR.UserSign), e.g. sa01. */
  creator?: string;
  /** Only requests with a line for this SAP user (pending: its pending line in the current stage). null = all (Super Admin). */
  sapUserCode: string | null;
  /** Customer group scope (U_CusGrp01/02/03 in it); null = unrestricted. */
  groupCodes: Set<string> | null;
  /** Brand scope (header U_ProdBrand or any line's brand in it); null = unrestricted. */
  brandCodes: Set<string> | null;
  limit?: number;
}

export interface SoApprovalListRow {
  wddCode: number;
  status: SapRequestStatus;
  docEntry: number;
  docNum: number;
  docNo: string | null;
  docDate: string | null;
  cardCode: string;
  cardName: string | null;
  taxCode: string | null;
  totalInclTax: number;
  totalExclTax: number;
  comments: string | null;
  dataStatus: string | null;
  brands: string[];
  creator: string | null;
  creatorName: string | null;
  requestedAt: string | null;
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
/** A real calendar date YYYY-MM-DD, else null (ignored as a filter). */
const isoDate = (v: string | undefined | null) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
};

/** SAP Sales Order approval requests (latest per SO), filtered, newest DocDate first. */
export async function searchSoApprovals(f: SoApprovalFilters): Promise<SoApprovalListRow[]> {
  if (f.groupCodes && f.groupCodes.size === 0) return [];
  if (f.brandCodes && f.brandCodes.size === 0) return [];
  const s = `"${getHanaSchema()}"`;
  const where: string[] = [
    `W."ObjType" = '17'`,
    `W."WddCode" = (SELECT MAX(X."WddCode") FROM ${s}."OWDD" X WHERE X."ObjType" = '17' AND X."DocEntry" = W."DocEntry")`,
  ];
  if (f.status === "pending") where.push(`W."Status" = 'W'`);
  else if (f.status === "approved") where.push(`W."Status" IN ('Y','P','A')`);
  else if (f.status === "rejected") where.push(`W."Status" IN ('N','C')`);
  const from = [isoDate(f.fromDate), isoDate(f.dateFrom)].filter(Boolean).sort().pop();
  if (from) where.push(`O."DocDate" >= TO_DATE(${lit(from)})`);
  if (isoDate(f.dateTo)) where.push(`O."DocDate" <= TO_DATE(${lit(f.dateTo!)})`);
  if (f.soNo?.trim()) {
    const v = f.soNo.trim();
    where.push(`(O."U_DocNo" LIKE ${lit(`%${v}%`)}${/^\d+$/.test(v) ? ` OR O."DocNum" = ${Number(v)} OR O."DocEntry" = ${Number(v)}` : ""})`);
  }
  if (f.bp?.trim()) {
    const v = `%${f.bp.trim().toUpperCase()}%`;
    where.push(`(UPPER(O."CardCode") LIKE ${lit(v)} OR UPPER(O."CardName") LIKE ${lit(v)})`);
  }
  if (f.creator?.trim()) where.push(`LOWER(U."USER_CODE") = ${lit(f.creator.trim().toLowerCase())}`);
  const brandSql = (codes: string[]) => {
    const inList = codes.map(lit).join(",");
    return `(O."U_ProdBrand" IN (${inList}) OR EXISTS (SELECT 1 FROM ${s}."RDR1" B WHERE B."DocEntry" = O."DocEntry" AND B."OcrCode" IN (${inList})))`;
  };
  if (f.brand?.trim()) where.push(brandSql([f.brand.trim()]));
  if (f.brandCodes) where.push(brandSql([...f.brandCodes]));
  if (f.groupCodes) {
    const inList = [...f.groupCodes].map(lit).join(",");
    where.push(`(C."U_CusGrp01" IN (${inList}) OR C."U_CusGrp02" IN (${inList}) OR C."U_CusGrp03" IN (${inList}))`);
  }
  if (f.sapUserCode) {
    const me = `(SELECT MAX(Z."USERID") FROM ${s}."OUSR" Z WHERE LOWER(Z."USER_CODE") = ${lit(f.sapUserCode.toLowerCase())})`;
    where.push(f.status === "pending"
      ? `EXISTS (SELECT 1 FROM ${s}."WDD1" D WHERE D."WddCode" = W."WddCode" AND D."UserID" = ${me} AND D."StepCode" = W."CurrStep" AND D."Status" = 'W')`
      : `EXISTS (SELECT 1 FROM ${s}."WDD1" D WHERE D."WddCode" = W."WddCode" AND D."UserID" = ${me})`);
  }
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT TOP ${Math.min(1000, Math.max(1, f.limit ?? 500))}
            W."WddCode", W."Status", W."CreateDate", O."DocEntry", O."DocNum", O."U_DocNo", O."DocDate", O."CardCode", O."CardName",
            C."LicTradNum", O."DocTotal", O."VatSum", O."Comments", O."U_DataStatus", O."U_ProdBrand", U."USER_CODE", U."U_NAME",
            (SELECT STRING_AGG(Y."OcrCode", ',') FROM (SELECT DISTINCT B2."OcrCode" FROM ${s}."RDR1" B2 WHERE B2."DocEntry" = O."DocEntry" AND IFNULL(B2."OcrCode", '') <> '') Y) AS "LineBrands"
       FROM ${s}."OWDD" W
       JOIN ${s}."ORDR" O ON O."DocEntry" = W."DocEntry"
       JOIN ${s}."OCRD" C ON C."CardCode" = O."CardCode"
       LEFT JOIN ${s}."OUSR" U ON U."USERID" = O."UserSign"
      WHERE ${where.join("\n        AND ")}
      ORDER BY O."DocDate" DESC, O."DocEntry" DESC`
  );
  return rows.map((r) => {
    const total = num(r.DocTotal);
    const brands = [...new Set([str(r.U_ProdBrand), ...String(r.LineBrands ?? "").split(",")].map((b) => (b ?? "").trim()).filter(Boolean))];
    return {
      wddCode: num(r.WddCode), status: String(r.Status) as SapRequestStatus, docEntry: num(r.DocEntry), docNum: num(r.DocNum),
      docNo: str(r.U_DocNo), docDate: str(r.DocDate)?.slice(0, 10) ?? null, cardCode: String(r.CardCode), cardName: str(r.CardName),
      taxCode: str(r.LicTradNum), totalInclTax: total, totalExclTax: total - num(r.VatSum), comments: str(r.Comments),
      dataStatus: str(r.U_DataStatus), brands, creator: str(r.USER_CODE), creatorName: str(r.U_NAME), requestedAt: str(r.CreateDate)?.slice(0, 10) ?? null,
    };
  });
}

/** One SAP Sales Order's header facts for scope checks (customer groups, brands, creator). */
export async function getSoScopeFacts(docEntry: number): Promise<{ cardCode: string; groups: string[]; brands: string[]; creator: string | null } | null> {
  const s = `"${getHanaSchema()}"`;
  const [r] = await queryHana<Record<string, unknown>>(
    `SELECT O."CardCode", C."U_CusGrp01", C."U_CusGrp02", C."U_CusGrp03", O."U_ProdBrand", U."USER_CODE",
            (SELECT STRING_AGG(Y."OcrCode", ',') FROM (SELECT DISTINCT B2."OcrCode" FROM ${s}."RDR1" B2 WHERE B2."DocEntry" = O."DocEntry" AND IFNULL(B2."OcrCode", '') <> '') Y) AS "LineBrands"
       FROM ${s}."ORDR" O JOIN ${s}."OCRD" C ON C."CardCode" = O."CardCode" LEFT JOIN ${s}."OUSR" U ON U."USERID" = O."UserSign"
      WHERE O."DocEntry" = ${Number(docEntry)}`
  );
  if (!r) return null;
  return {
    cardCode: String(r.CardCode),
    groups: [r.U_CusGrp01, r.U_CusGrp02, r.U_CusGrp03].map((x) => str(x)).filter((x): x is string => !!x),
    brands: [...new Set([str(r.U_ProdBrand), ...String(r.LineBrands ?? "").split(",")].map((b) => (b ?? "").trim()).filter(Boolean))],
    creator: str(r.USER_CODE),
  };
}

/** SAP SO lines for display. */
export async function getSoLinesForDisplay(docEntry: number) {
  const s = `"${getHanaSchema()}"`;
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT "ItemCode", "Dscription", "Quantity", "unitMsr", "PriceBefDi", "DiscPrcnt", "LineTotal", "U_PM_Type", "OcrCode"
       FROM ${s}."RDR1" WHERE "DocEntry" = ${Number(docEntry)} ORDER BY "LineNum"`
  );
  return rows.map((l) => ({
    item: String(l.ItemCode), name: str(l.Dscription), qty: num(l.Quantity), uom: str(l.unitMsr),
    price: num(l.PriceBefDi), discountPct: num(l.DiscPrcnt), total: num(l.LineTotal),
    gift: String(l.U_PM_Type ?? "") === "31",
    kind: String(l.U_PM_Type ?? "") === "98" ? "contract discount" : String(l.U_PM_Type ?? "") === "20" ? "promotion discount" : null as string | null,
    brand: str(l.OcrCode),
  }));
}

/**
 * The same list rows for given Sales Orders WITHOUT an SAP approval request
 * (portal orders whose approval the portal runs), with the same filters
 * (DocDate / from date, brand, SO No, BP, creator, data permissions).
 */
export async function searchSoHeaders(docEntries: number[], f: Omit<SoApprovalFilters, "status" | "sapUserCode">): Promise<SoApprovalListRow[]> {
  const ids = [...new Set(docEntries.filter((d) => Number.isInteger(d) && d > 0))];
  if (ids.length === 0) return [];
  if (f.groupCodes && f.groupCodes.size === 0) return [];
  if (f.brandCodes && f.brandCodes.size === 0) return [];
  const s = `"${getHanaSchema()}"`;
  const where: string[] = [`O."DocEntry" IN (${ids.join(",")})`];
  const from = [isoDate(f.fromDate), isoDate(f.dateFrom)].filter(Boolean).sort().pop();
  if (from) where.push(`O."DocDate" >= TO_DATE(${lit(from)})`);
  if (isoDate(f.dateTo)) where.push(`O."DocDate" <= TO_DATE(${lit(f.dateTo!)})`);
  if (f.soNo?.trim()) {
    const v = f.soNo.trim();
    where.push(`(O."U_DocNo" LIKE ${lit(`%${v}%`)}${/^\d+$/.test(v) ? ` OR O."DocNum" = ${Number(v)} OR O."DocEntry" = ${Number(v)}` : ""})`);
  }
  if (f.bp?.trim()) {
    const v = `%${f.bp.trim().toUpperCase()}%`;
    where.push(`(UPPER(O."CardCode") LIKE ${lit(v)} OR UPPER(O."CardName") LIKE ${lit(v)})`);
  }
  if (f.creator?.trim()) where.push(`LOWER(U."USER_CODE") = ${lit(f.creator.trim().toLowerCase())}`);
  const brandSql = (codes: string[]) => {
    const inList = codes.map(lit).join(",");
    return `(O."U_ProdBrand" IN (${inList}) OR EXISTS (SELECT 1 FROM ${s}."RDR1" B WHERE B."DocEntry" = O."DocEntry" AND B."OcrCode" IN (${inList})))`;
  };
  if (f.brand?.trim()) where.push(brandSql([f.brand.trim()]));
  if (f.brandCodes) where.push(brandSql([...f.brandCodes]));
  if (f.groupCodes) {
    const inList = [...f.groupCodes].map(lit).join(",");
    where.push(`(C."U_CusGrp01" IN (${inList}) OR C."U_CusGrp02" IN (${inList}) OR C."U_CusGrp03" IN (${inList}))`);
  }
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT O."DocEntry", O."DocNum", O."U_DocNo", O."DocDate", O."CardCode", O."CardName", C."LicTradNum", O."DocTotal", O."VatSum",
            O."Comments", O."U_DataStatus", O."U_ProdBrand", U."USER_CODE", U."U_NAME", O."CreateDate",
            (SELECT STRING_AGG(Y."OcrCode", ',') FROM (SELECT DISTINCT B2."OcrCode" FROM ${s}."RDR1" B2 WHERE B2."DocEntry" = O."DocEntry" AND IFNULL(B2."OcrCode", '') <> '') Y) AS "LineBrands"
       FROM ${s}."ORDR" O
       JOIN ${s}."OCRD" C ON C."CardCode" = O."CardCode"
       LEFT JOIN ${s}."OUSR" U ON U."USERID" = O."UserSign"
      WHERE ${where.join("\n        AND ")}
      ORDER BY O."DocDate" DESC, O."DocEntry" DESC`
  );
  return rows.map((r) => {
    const total = num(r.DocTotal);
    const brands = [...new Set([str(r.U_ProdBrand), ...String(r.LineBrands ?? "").split(",")].map((b) => (b ?? "").trim()).filter(Boolean))];
    return {
      wddCode: 0, status: "W" as SapRequestStatus, docEntry: num(r.DocEntry), docNum: num(r.DocNum),
      docNo: str(r.U_DocNo), docDate: str(r.DocDate)?.slice(0, 10) ?? null, cardCode: String(r.CardCode), cardName: str(r.CardName),
      taxCode: str(r.LicTradNum), totalInclTax: total, totalExclTax: total - num(r.VatSum), comments: str(r.Comments),
      dataStatus: str(r.U_DataStatus), brands, creator: str(r.USER_CODE), creatorName: str(r.U_NAME), requestedAt: str(r.CreateDate)?.slice(0, 10) ?? null,
    };
  });
}
