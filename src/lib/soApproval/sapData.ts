import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { queryArAging, todayIso, AR_AGING_BUCKETS, type ArAgingBucket, type ArAgingRow } from "@/lib/hana/arAgingQuery";

/**
 * Read-only SAP figures for the Accountant's SO approval screen, straight
 * from HANA (read-only user IMV_REPORT_RO). "Not reconciled" comes from SAP's
 * AR aging query Q504 (src/lib/hana/arAgingQuery.ts): journal lines on the
 * customer's control account minus what is reconciled (uv_GetReconSum_Debit).
 */
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface SapSoHeader {
  docEntry: number;
  docNum: number;
  docNo: string | null;          // U_DocNo
  cardCode: string;
  cardName: string | null;
  docDate: string | null;
  docDueDate: string | null;
  totalInclTax: number;          // DocTotal
  vatSum: number;
  totalExclTax: number;          // DocTotal − VatSum
  discSum: number;
  comments: string | null;
  docStatus: string | null;      // O / C
  cancelled: boolean;
  dataStatus: string | null;     // U_DataStatus: I = waiting, C = released
}

function mapHeader(r: Record<string, unknown>): SapSoHeader {
  const total = num(r.DocTotal);
  const vat = num(r.VatSum);
  return {
    docEntry: num(r.DocEntry), docNum: num(r.DocNum), docNo: str(r.U_DocNo),
    cardCode: String(r.CardCode), cardName: str(r.CardName),
    docDate: str(r.DocDate), docDueDate: str(r.DocDueDate),
    totalInclTax: total, vatSum: vat, totalExclTax: total - vat, discSum: num(r.DiscSum),
    comments: str(r.Comments), docStatus: str(r.DocStatus), cancelled: r.CANCELED === "Y",
    dataStatus: str(r.U_DataStatus),
  };
}

/** Sales Order headers by DocEntry (one HANA query). */
export async function getSapSoHeaders(docEntries: number[]): Promise<Map<number, SapSoHeader>> {
  const ids = [...new Set(docEntries.filter((d) => Number.isInteger(d) && d > 0))];
  if (ids.length === 0) return new Map();
  const s = getHanaSchema();
  const rows = await queryHana<Record<string, unknown>>(
    `SELECT "DocEntry", "DocNum", "U_DocNo", "CardCode", "CardName", "DocDate", "DocDueDate", "DocTotal", "VatSum",
            "DiscSum", "Comments", "DocStatus", "CANCELED", "U_DataStatus"
       FROM "${s}"."ORDR" WHERE "DocEntry" IN (${ids.join(",")})`
  );
  return new Map(rows.map((r) => [num(r.DocEntry), mapHeader(r)]));
}

export interface ArSummary {
  cardCode: string;
  cardName: string | null;
  taxCode: string | null;
  phone: string | null;
  email: string | null;
  /** OCRD.Balance — AR account balance (positive = customer owes us). */
  balance: number;
  /** OCRD.CreditLine — 0 = no credit limit set. */
  creditLimit: number;
  /**
   * Open Sales Orders (includes the one being approved): sum of DocTotal of
   * the customer's open, not-cancelled ORDR. Not OCRD.OrdersBal — that was
   * found negative for some customers (e.g. −409 M for GTNO1904).
   */
  openOrders: number;
  /** OCRD.DNotesBal — delivered, not yet invoiced. */
  openDeliveries: number;
  /** creditLimit − (balance + openOrders + openDeliveries); null when no limit. */
  creditAvailable: number | null;
  /** AR aging (SAP QRM_Q504_AR_Aging2) as of this date, YYYY-MM-DD. */
  agingAsOf: string;
  /** Lines with a positive remaining amount (invoices / debit journal lines not yet reconciled). */
  openInvoiceCount: number;
  openInvoiceAmount: number;
  /** Of those, due (Ages ≥ 0 — every bucket but "Not due"). */
  overdueInvoiceCount: number;
  overdueAmount: number;
  oldestOverdueDays: number;
  /** Payments / credit memos / credit journal lines not yet reconciled against an invoice (positive number). */
  unreconciledCreditCount: number;
  unreconciledCredits: number;
  /** Net remaining balance of all aging lines (debits − unreconciled credits). */
  agingTotal: number;
  /** Q504 buckets, net. */
  aging: Record<ArAgingBucket, number>;
  /** The aging lines themselves (only when asked for). */
  agingRows: ArAgingRow[];
}

function emptySummary(cardCode: string, asOf: string): ArSummary {
  return {
    cardCode, cardName: null, taxCode: null, phone: null, email: null,
    balance: 0, creditLimit: 0, openOrders: 0, openDeliveries: 0, creditAvailable: null, agingAsOf: asOf,
    openInvoiceCount: 0, openInvoiceAmount: 0, overdueInvoiceCount: 0, overdueAmount: 0, oldestOverdueDays: 0,
    unreconciledCreditCount: 0, unreconciledCredits: 0, agingTotal: 0,
    aging: Object.fromEntries(AR_AGING_BUCKETS.map((b) => [b, 0])) as Record<ArAgingBucket, number>, agingRows: [],
  };
}

/**
 * Credit + AR position per customer: OCRD (balance, credit limit), ORDR (open
 * orders) and SAP's AR aging query Q504 (open, not-reconciled lines) — three
 * HANA queries for any number of customers.
 */
export async function getArSummaries(
  cardCodes: string[],
  withAgingRows = false,
  /** The staff member's Brands — aging lines of other brands are left out. null = all. */
  brandCodes: Set<string> | null = null
): Promise<Map<string, ArSummary>> {
  const codes = [...new Set(cardCodes.filter(Boolean))];
  const asOf = todayIso();
  const out = new Map<string, ArSummary>(codes.map((c) => [c, emptySummary(c, asOf)]));
  if (codes.length === 0) return out;
  const s = getHanaSchema();
  const inList = codes.map(lit).join(",");

  const [bps, aging, orders] = await Promise.all([
    queryHana<Record<string, unknown>>(
      `SELECT "CardCode", "CardName", "LicTradNum", "Phone1", "E_Mail", "Balance", "CreditLine", "DNotesBal"
         FROM "${s}"."OCRD" WHERE "CardCode" IN (${inList})`
    ),
    queryArAging({ refDate: asOf, cardCodes: codes, scopeBrandCodes: brandCodes }),
    queryHana<Record<string, unknown>>(
      `SELECT "CardCode", SUM("DocTotal") AS "Open"
         FROM "${s}"."ORDR" WHERE "CardCode" IN (${inList}) AND "DocStatus" = 'O' AND "CANCELED" = 'N'
        GROUP BY "CardCode"`
    ),
  ]);

  for (const b of bps) {
    const a = out.get(String(b.CardCode));
    if (!a) continue;
    a.cardName = str(b.CardName); a.taxCode = str(b.LicTradNum); a.phone = str(b.Phone1); a.email = str(b.E_Mail);
    a.balance = num(b.Balance); a.creditLimit = num(b.CreditLine);
    a.openDeliveries = Math.max(0, num(b.DNotesBal));
  }
  for (const o of orders) {
    const a = out.get(String(o.CardCode));
    if (a) a.openOrders = num(o.Open);
  }
  for (const a of out.values()) {
    a.creditAvailable = a.creditLimit > 0 ? a.creditLimit - (a.balance + a.openOrders + a.openDeliveries) : null;
  }
  for (const r of aging) {
    const a = out.get(r.custCode);
    if (!a) continue;
    a.agingTotal += r.invBal;
    for (const b of AR_AGING_BUCKETS) a.aging[b] += r[b];
    if (r.invBal > 0) {
      a.openInvoiceCount++;
      a.openInvoiceAmount += r.invBal;
      if (r.ages !== null && r.ages >= 0) {
        a.overdueInvoiceCount++;
        a.overdueAmount += r.invBal;
        a.oldestOverdueDays = Math.max(a.oldestOverdueDays, r.ages);
      }
    } else if (r.invBal < 0) {
      a.unreconciledCreditCount++;
      a.unreconciledCredits -= r.invBal;
    }
    if (withAgingRows) a.agingRows.push(r);
  }
  return out;
}
