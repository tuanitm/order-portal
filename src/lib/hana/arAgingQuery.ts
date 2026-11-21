import { queryHana, getHanaSchema } from "@/lib/hana/client";

/**
 * SAP Query Manager "QRM_Q504_AR_Aging2" — AR aging by open journal line,
 * run straight on HANA (source: "SAP QRM_Q504_AR_Aging2.sql" in the repo root;
 * keep the two in step). One row per A/R invoice / credit memo / journal entry
 * / incoming / outgoing payment line on a customer's control account whose
 * remaining (not reconciled as of `refDate`) amount ≠ 0.
 *
 *   InvBal (remaining) = journal line amount − reconciled amount (uv_GetReconSum_Debit, up to refDate)
 *   Ages               = DAYS_BETWEEN(DueDate, refDate)   (< 0 = not due yet)
 *   NotDue / D15 / D30 / D45 / D60 / D90 / D180 / D181 = InvBal bucketed by Ages
 *
 * The query file's [%0]..[%4] parameters map to the options below; "*" / an
 * empty value = all, exactly as in Query Manager. Portal additions:
 * `cardCodes` accepts several customers; the staff member's data permissions
 * — `scopeGroupCodes` (customers whose U_CusGrp01/02/03, i.e. channel /
 * customer group level 1–3, is in scope) and `scopeBrandCodes` (lines whose
 * brand is in scope, as the query's own brand parameter does).
 */
export interface ArAgingOptions {
  /** [%0] as-of date, YYYY-MM-DD (default today). */
  refDate?: string;
  /** [%1] customer code(s); empty = all. */
  cardCodes?: string[];
  /** [%2] control account; empty / "*" = all. */
  acctCode?: string;
  /** [%3] OCRD.U_CusGrp01 (channel); empty / "*" = all. */
  cusGrp01?: string;
  /** [%4] brand (profit centre); empty / "*" = all. */
  prodBrand?: string;
  /** null = unrestricted; a Set = only customers with a group code in it (empty Set = none). */
  scopeGroupCodes?: Set<string> | null;
  /** The role's Brands: only lines whose brand (BrCode) is in it, plus lines with no brand. null = unrestricted; empty Set = none. */
  scopeBrandCodes?: Set<string> | null;
}

export interface ArAgingRow {
  docNum: string | null;
  brCode: string | null;
  brName: string | null;
  corpCode: string | null;
  corpName: string | null;
  grpCustCode: string | null;
  grpCustName: string | null;
  custCode: string;
  custCode2: string | null;
  custName: string | null;
  creditLimit: number;
  docNo: string | null;
  soNo: string | null;
  siNo: string | null;
  referenceNo: string | null;
  docEntry: string | null;
  /** 13 A/R invoice, 14 A/R credit memo, 24 incoming payment, 30 journal entry, 46 outgoing payment. */
  objType: number;
  docType: string;
  invNo: string | null;
  /** dd/MM/yyyy, as the query formats it. */
  invDate: string | null;
  dueDate: string | null;
  /** Days past due as of refDate (negative = not due yet). */
  ages: number | null;
  invAmt: number;
  invBal: number;
  notDue: number;
  d15: number;
  d30: number;
  d45: number;
  d60: number;
  d90: number;
  d180: number;
  d181: number;
  ssCode: string | null;
  ssName: string | null;
  transTypeCode: string | null;
  transTypeName: string | null;
  notes: string | null;
  addlNotes: string | null;
  shipToCode: string | null;
  shipToName: string | null;
  shipToAddress2: string | null;
  shipToBuyer: string | null;
  controlAccount: string | null;
}

export const AR_AGING_BUCKETS = ["notDue", "d15", "d30", "d45", "d60", "d90", "d180", "d181"] as const;
export type ArAgingBucket = (typeof AR_AGING_BUCKETS)[number];
export const AR_AGING_BUCKET_LABELS: Record<ArAgingBucket, string> = {
  notDue: "Not due", d15: "0–15", d30: "16–30", d45: "31–45", d60: "46–60", d90: "61–90", d180: "91–180", d181: "> 180",
};

const DOC_TYPES: Record<number, string> = {
  13: "A/R Invoice", 14: "A/R Credit Memo", 24: "Incoming Payment", 30: "Journal Entry", 46: "Outgoing Payment",
};

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const all = (v: string | undefined) => !v || v.trim() === "" || v.trim() === "*";

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function queryArAging(opts: ArAgingOptions = {}): Promise<ArAgingRow[]> {
  const refDate = opts.refDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.refDate) ? opts.refDate : todayIso();
  const scope = opts.scopeGroupCodes;
  if (scope && scope.size === 0) return [];
  const brandScope = opts.scopeBrandCodes;
  if (brandScope && brandScope.size === 0) return [];
  const cardCodes = [...new Set((opts.cardCodes ?? []).map((c) => c.trim()).filter(Boolean))];

  const s = `"${getHanaSchema()}"`;
  const T = (t: string) => `${s}."${t}"`;
  const pRefDate = `TO_DATE(${lit(refDate)})`;

  const custFilters: string[] = [];
  if (cardCodes.length) custFilters.push(`Cust."CardCode" IN (${cardCodes.map(lit).join(",")})`);
  if (!all(opts.acctCode)) custFilters.push(`JdtLine."Account" = ${lit(opts.acctCode!.trim())}`);
  if (!all(opts.cusGrp01)) custFilters.push(`Cust."U_CusGrp01" = ${lit(opts.cusGrp01!.trim())}`);
  if (scope) {
    const inList = [...scope].map(lit).join(",");
    custFilters.push(`(Cust."U_CusGrp01" IN (${inList}) OR Cust."U_CusGrp02" IN (${inList}) OR Cust."U_CusGrp03" IN (${inList}))`);
  }
  const brandFilter = (all(opts.prodBrand) ? "" : `AND X."BrCode" = ${lit(opts.prodBrand!.trim())}`)
    // Lines with no brand at all (e.g. a journal entry or payment without a profit centre) belong to no
    // other brand — keep them for brand-scoped users, so overdue debt can't slip past the AR check.
    + (brandScope ? ` AND (X."BrCode" IN (${[...brandScope].map(lit).join(",")}) OR IFNULL(X."BrCode", '') = '')` : "");

  const sql = `
SELECT
    Y."BaseRef" AS "DocNum", Y."BrCode", ProfitCtr."OcrName" AS "BrName", Y."CorpCode", Y."CorpName",
    Y."GrpCustCode", Y."GrpCustName", Y."CustCode", Y."Cust.Code2", Y."Cust.Name", Y."Cr.Limit",
    Y."Doc.No", Y."SO.No", Y."SI.No", Y."U_NumAtCard" AS "Reference No.", Y."DocEntry", Y."TransType" AS "ObjType",
    Y."Inv.No", TO_NVARCHAR(Y."Inv.Date",'dd/MM/yyyy') AS "Inv.Date", TO_NVARCHAR(Y."DueDate",'dd/MM/yyyy') AS "DueDate",
    Y."OverdueDays" AS "Ages", Y."Amount" AS "InvAmt", Y."RemainAmount" AS "InvBal",
    CASE WHEN Y."OverdueDays" < 0 THEN Y."RemainAmount" ELSE 0 END AS "NotDue",
    CASE WHEN Y."OverdueDays" BETWEEN 0 AND 15 THEN Y."RemainAmount" ELSE 0 END AS "D15",
    CASE WHEN Y."OverdueDays" > 15 AND Y."OverdueDays" <= 30 THEN Y."RemainAmount" ELSE 0 END AS "D30",
    CASE WHEN Y."OverdueDays" > 30 AND Y."OverdueDays" <= 45 THEN Y."RemainAmount" ELSE 0 END AS "D45",
    CASE WHEN Y."OverdueDays" > 45 AND Y."OverdueDays" <= 60 THEN Y."RemainAmount" ELSE 0 END AS "D60",
    CASE WHEN Y."OverdueDays" > 60 AND Y."OverdueDays" <= 90 THEN Y."RemainAmount" ELSE 0 END AS "D90",
    CASE WHEN Y."OverdueDays" > 90 AND Y."OverdueDays" <= 180 THEN Y."RemainAmount" ELSE 0 END AS "D180",
    CASE WHEN Y."OverdueDays" > 180 THEN Y."RemainAmount" ELSE 0 END AS "D181",
    Y."SSCode", CusSE."Name" AS "SSName",
    Y."TransactionType" AS "Trans. Type Code", Y."TransTypeName" AS "Trans. Type Name",
    Y."Notes", Y."AddlNotes" AS "Notes (Additional)",
    Y."ShipToCode", Y."ShipToName", Y."ShipToAddress2", Y."ShipToBuyer", Y."Account" AS "Control Account"
FROM (
    SELECT X.*,
        CASE WHEN (X."Amount" - X."PaidAmount") <> 0 THEN DAYS_BETWEEN(X."DueDate", ${pRefDate}) ELSE NULL END AS "OverdueDays",
        CASE
            WHEN X."PaidAmount" > 0 AND X."Amount" < 0 THEN X."Amount" - (X."PaidAmount" * -1.0)
            WHEN X."PaidAmount" < 0 AND X."Amount" > 0 THEN X."Amount" - (X."PaidAmount" * -1.0)
            ELSE X."Amount" - X."PaidAmount"
        END AS "RemainAmount"
    FROM (
        SELECT
            COALESCE(
                NULLIF(IFNULL(NULLIF(JdtLine."U_ProdBrand",''), JdtLine."ProfitCode"),''),
                CASE
                    WHEN Jdt."TransType" = 13 THEN COALESCE(NULLIF(ar."OcrCode",''), ar."U_ProdBrand")
                    WHEN Jdt."TransType" = 14 THEN COALESCE(NULLIF(arc."OcrCode",''), arc."U_ProdBrand")
                    WHEN Jdt."TransType" = 24 THEN ip."OcrCode"
                    WHEN Jdt."TransType" = 46 THEN op."OcrCode"
                    ELSE NULL
                END
            ) AS "BrCode",
            Comp."AliasName" AS "CorpCode", Comp."CompnyName" AS "CorpName",
            IFNULL(Cust."FatherCard", Cust."CardCode") AS "GrpCustCode",
            IFNULL(CustGrp."CardName", Cust."CardName") AS "GrpCustName",
            Cust."CardCode" AS "CustCode", Cust."U_BPOldCode" AS "Cust.Code2", Cust."CardName" AS "Cust.Name",
            Cust."CreditLine" AS "Cr.Limit",
            Jdt."BaseRef", Jdt."TransType",
            CASE
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(ar."DocEntry")
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."DocEntry")
                WHEN Jdt."TransType" = 30 THEN CAST(Jdt."TransId" AS NVARCHAR)
                WHEN Jdt."TransType" = 24 THEN TO_NVARCHAR(ip."DocEntry")
                WHEN Jdt."TransType" = 46 THEN TO_NVARCHAR(op."DocEntry")
            END AS "DocEntry",
            CASE
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(ar."U_NumAtCard")
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."U_NumAtCard")
            END AS "U_NumAtCard",
            CASE
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(ar."U_DocNo")
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."U_DocNo")
                WHEN Jdt."TransType" = 30 THEN CAST(Jdt."U_DocNo" AS NVARCHAR)
                WHEN Jdt."TransType" IN (24,46) THEN CAST(Jdt."U_DocNo" AS NVARCHAR)
            END AS "Doc.No",
            Jdt."U_DocNo" AS "SI.No",
            JdtLine."U_InvSeri" || JdtLine."U_InvNo" AS "Inv.No",
            CASE
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(IFNULL(NULLIF(ar."U_CN_InvDate",''), ar."U_InvDate"))
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."U_CN_InvDate")
                WHEN Jdt."TransType" = 30 THEN COALESCE(NULLIF(JdtLine."U_InvDate",''), Jdt."RefDate")
                WHEN Jdt."TransType" IN (24,46) THEN JdtLine."U_InvDate"
            END AS "Inv.Date",
            Jdt."RefDate" AS "PostingDate", Jdt."DueDate" AS "DueDate",
            JdtLine."Account", JdtLine."ContraAct",
            CASE
                WHEN Jdt."TransType" IN (13,14,46) THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") > 0 THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") < 0 AND IFNULL(JdtLine."MthDate",'') = '' THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") < 0 AND IFNULL(JdtLine."MthDate",'') <> '' THEN
                     (IFNULL(JdtLine."Debit",0) - IFNULL(JdtLine."Credit",0)) - IFNULL(ReconD."Gia_Tri",0)
                WHEN Jdt."TransType" = 24 AND IFNULL(JdtLine."MthDate",'') = '' THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 24 AND IFNULL(JdtLine."MthDate",'') <> '' THEN
                     (IFNULL(JdtLine."Debit",0) - IFNULL(JdtLine."Credit",0)) - IFNULL(ReconD."Gia_Tri",0)
                ELSE 0
            END AS "Amount",
            CASE
                WHEN Jdt."TransType" IN (13,14,46) OR (Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") > 0)
                THEN IFNULL(ReconD."Gia_Tri", 0)
                ELSE 0
            END AS "PaidAmount",
            CASE WHEN Jdt."TransType" = 13 THEN invAdr."ShipToCode" WHEN Jdt."TransType" = 14 THEN invCreAdr."ShipToCode" ELSE cusAdr."ShipToCode" END AS "ShipToCode",
            CASE WHEN Jdt."TransType" = 13 THEN invAdr."ShipToName" WHEN Jdt."TransType" = 14 THEN invCreAdr."ShipToName" ELSE cusAdr."ShipToName" END AS "ShipToName",
            CASE WHEN Jdt."TransType" = 13 THEN invAdr."Address2S" WHEN Jdt."TransType" = 14 THEN invCreAdr."Address2S" ELSE cusAdr."Address2" END AS "ShipToAddress2",
            CASE WHEN Jdt."TransType" = 13 THEN invAdr."U_BPBuyerS" WHEN Jdt."TransType" = 14 THEN invCreAdr."U_BPBuyerS" ELSE cusAdr."U_BPBuyer" END AS "ShipToBuyer",
            COALESCE(ar."U_CusSEL04", arc."U_CusSEL04") AS "SSCode",
            JdtLine."U_TransType" AS "TransactionType", sy01."Name" AS "TransTypeName",
            JdtLine."LineMemo" AS "Notes", JdtLine."U_AddlNotes" AS "AddlNotes",
            SO."U_DocNo" AS "SO.No"
        FROM ${T("OJDT")} Jdt
        JOIN ${T("JDT1")} JdtLine ON Jdt."TransId" = JdtLine."TransId"
        JOIN ${T("OCRD")} Cust ON JdtLine."ShortName" = Cust."CardCode"
        LEFT JOIN ${T("OCRD")} CustGrp ON Cust."FatherCard" = CustGrp."CardCode"
        LEFT JOIN ${T("@SYS_GE_TRANSTYPE")} sy01 ON sy01."Code" = JdtLine."U_TransType"
        LEFT JOIN (
            SELECT "ShortName", "TransId", "TransRowId", IFNULL(SUM("ReconSum"),0) AS "Gia_Tri"
              FROM ${T("uv_GetReconSum_Debit")}
             WHERE "ReconDate" BETWEEN '1999-09-17' AND ${pRefDate}
             GROUP BY "ShortName", "TransId", "TransRowId"
        ) ReconD ON ReconD."ShortName" = Cust."CardCode" AND JdtLine."TransId" = ReconD."TransId" AND JdtLine."Line_ID" = ReconD."TransRowId"
        LEFT JOIN ${T("OADM")} Comp ON 1=1
        LEFT JOIN (
            SELECT "CardCode", MAX("Address") AS "ShipToCode", MAX("U_BPAddress") AS "ShipToName", MAX("Address2") AS "Address2", MAX("U_BPBuyer") AS "U_BPBuyer"
              FROM ${T("CRD1")} WHERE "AdresType" = 'S' GROUP BY "CardCode"
        ) cusAdr ON Cust."CardCode" = cusAdr."CardCode"
        LEFT JOIN (
            SELECT b."DocNum", b."ShipToCode", b."Address2" AS "ShipToName", MAX(a."Address2S") AS "Address2S", MAX(a."U_BPBuyerS") AS "U_BPBuyerS"
              FROM ${T("INV12")} a JOIN ${T("OINV")} b ON a."DocEntry" = b."DocEntry"
             GROUP BY b."DocNum", b."ShipToCode", b."Address2"
        ) invAdr ON Jdt."BaseRef" = invAdr."DocNum" AND Jdt."TransType" = 13
        LEFT JOIN (
            SELECT b."DocNum", b."ShipToCode", b."Address2" AS "ShipToName", MAX(a."Address2S") AS "Address2S", MAX(a."U_BPBuyerS") AS "U_BPBuyerS"
              FROM ${T("RIN12")} a JOIN ${T("ORIN")} b ON a."DocEntry" = b."DocEntry"
             GROUP BY b."DocNum", b."ShipToCode", b."Address2"
        ) invCreAdr ON Jdt."BaseRef" = invCreAdr."DocNum" AND Jdt."TransType" = 14
        LEFT JOIN (
            SELECT b."DocEntry", b."DocNum", b."U_DocNo", b."U_InvDate", b."U_CusSEL04", b."U_NumAtCard",
                   MAX(a."OcrCode") AS "OcrCode", b."U_ProdBrand", b."U_CN_InvDate"
              FROM ${T("INV1")} a JOIN ${T("OINV")} b ON a."DocEntry" = b."DocEntry"
             WHERE b."CANCELED" = 'N'
             GROUP BY b."DocEntry", b."DocNum", b."U_DocNo", b."U_InvDate", b."U_CN_InvDate", b."U_CusSEL04", b."U_ProdBrand", b."U_NumAtCard"
        ) ar ON Jdt."BaseRef" = ar."DocNum" AND Jdt."TransType" = 13
        LEFT JOIN (
            SELECT b."DocEntry", b."DocNum", b."U_DocNo", b."U_CN_InvDate", b."U_CusSEL04", b."U_NumAtCard",
                   MAX(a."OcrCode") AS "OcrCode", b."U_ProdBrand"
              FROM ${T("RIN1")} a JOIN ${T("ORIN")} b ON a."DocEntry" = b."DocEntry"
             WHERE b."CANCELED" = 'N'
             GROUP BY b."DocEntry", b."DocNum", b."U_DocNo", b."U_CN_InvDate", b."U_CusSEL04", b."U_ProdBrand", b."U_NumAtCard"
        ) arc ON Jdt."BaseRef" = arc."DocNum" AND Jdt."TransType" = 14
        LEFT JOIN (
            SELECT b."DocEntry", b."DocNum", MAX(a."OcrCode") AS "OcrCode"
              FROM ${T("ORCT")} b LEFT JOIN ${T("RCT2")} a ON a."DocEntry" = b."DocEntry"
             WHERE b."Canceled" = 'N'
             GROUP BY b."DocEntry", b."DocNum"
        ) ip ON Jdt."BaseRef" = ip."DocNum" AND Jdt."TransType" = 24
        LEFT JOIN (
            SELECT b."DocEntry", b."DocNum", MAX(a."OcrCode") AS "OcrCode"
              FROM ${T("OVPM")} b LEFT JOIN ${T("VPM2")} a ON a."DocEntry" = b."DocEntry"
             WHERE b."Canceled" = 'N'
             GROUP BY b."DocEntry", b."DocNum"
        ) op ON Jdt."BaseRef" = op."DocNum" AND Jdt."TransType" = 46
        LEFT JOIN (
            SELECT INV1."DocEntry", MAX(SO."U_DocNo") AS "U_DocNo"
              FROM ${T("INV1")} INV1
              LEFT JOIN ${T("ORDR")} SO ON INV1."BaseType" = SO."ObjType" AND INV1."BaseEntry" = SO."DocEntry" AND SO."CANCELED" = 'N'
             GROUP BY INV1."DocEntry"
        ) SO ON ar."DocEntry" = SO."DocEntry"
        WHERE Jdt."RefDate" <= ${pRefDate}
          AND Jdt."TransType" IN (13,14,24,30,46)
          AND Cust."CardType" = 'C'
          ${custFilters.map((f) => `AND ${f}`).join("\n          ")}
    ) X
    WHERE IFNULL(X."Amount",0) <> 0 ${brandFilter}
) Y
LEFT JOIN ${T("OOCR")} ProfitCtr ON Y."BrCode" = ProfitCtr."OcrCode"
LEFT JOIN ${T("@MDM_CD_SEL04")} CusSE ON CusSE."Code" = Y."SSCode"
WHERE Y."RemainAmount" <> 0
ORDER BY Y."CustCode", Y."DueDate"`;

  const rows = await queryHana<Record<string, unknown>>(sql);
  return rows.map((r) => {
    const objType = num(r.ObjType);
    return {
      docNum: str(r.DocNum), brCode: str(r.BrCode), brName: str(r.BrName), corpCode: str(r.CorpCode), corpName: str(r.CorpName),
      grpCustCode: str(r.GrpCustCode), grpCustName: str(r.GrpCustName), custCode: String(r.CustCode),
      custCode2: str(r["Cust.Code2"]), custName: str(r["Cust.Name"]), creditLimit: num(r["Cr.Limit"]),
      docNo: str(r["Doc.No"]), soNo: str(r["SO.No"]), siNo: str(r["SI.No"]), referenceNo: str(r["Reference No."]),
      docEntry: str(r.DocEntry), objType, docType: DOC_TYPES[objType] ?? String(objType),
      invNo: str(r["Inv.No"]), invDate: str(r["Inv.Date"]), dueDate: str(r.DueDate),
      ages: r.Ages === null || r.Ages === undefined ? null : num(r.Ages),
      invAmt: num(r.InvAmt), invBal: num(r.InvBal),
      notDue: num(r.NotDue), d15: num(r.D15), d30: num(r.D30), d45: num(r.D45), d60: num(r.D60),
      d90: num(r.D90), d180: num(r.D180), d181: num(r.D181),
      ssCode: str(r.SSCode), ssName: str(r.SSName),
      transTypeCode: str(r["Trans. Type Code"]), transTypeName: str(r["Trans. Type Name"]),
      notes: str(r.Notes), addlNotes: str(r["Notes (Additional)"]),
      shipToCode: str(r.ShipToCode), shipToName: str(r.ShipToName), shipToAddress2: str(r.ShipToAddress2), shipToBuyer: str(r.ShipToBuyer),
      controlAccount: str(r["Control Account"]),
    };
  });
}

/** Per-customer totals of aging rows (bucket sums; overdue = Ages ≥ 0, i.e. all but "Not due"). */
export interface ArAgingCustomerTotal {
  custCode: string;
  custName: string | null;
  creditLimit: number;
  ssName: string | null;
  lines: number;
  balance: number;
  overdue: number;
  overdueLines: number;
  maxAge: number;
  buckets: Record<ArAgingBucket, number>;
}

export function summarizeArAging(rows: ArAgingRow[]): ArAgingCustomerTotal[] {
  const map = new Map<string, ArAgingCustomerTotal>();
  for (const r of rows) {
    let t = map.get(r.custCode);
    if (!t) {
      t = {
        custCode: r.custCode, custName: r.custName, creditLimit: r.creditLimit, ssName: r.ssName, lines: 0, balance: 0,
        overdue: 0, overdueLines: 0, maxAge: 0,
        buckets: Object.fromEntries(AR_AGING_BUCKETS.map((b) => [b, 0])) as Record<ArAgingBucket, number>,
      };
      map.set(r.custCode, t);
    }
    t.lines++;
    t.balance += r.invBal;
    if (!t.ssName && r.ssName) t.ssName = r.ssName;
    for (const b of AR_AGING_BUCKETS) t.buckets[b] += r[b];
    // Overdue = every bucket but "Not due" (the script's D15 starts at 0 days), net of credits/payments.
    if (r.ages !== null && r.ages >= 0) {
      t.overdue += r.invBal;
      if (r.invBal > 0) {
        t.overdueLines++;
        t.maxAge = Math.max(t.maxAge, r.ages);
      }
    }
  }
  return [...map.values()];
}
