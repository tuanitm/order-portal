import type { AdminSession } from "@/lib/auth/adminSession";
import { getCompanyId } from "@/lib/config";
import { queryOne } from "@/lib/db/connection";
import { getCustomerForAdmin, getCustomerDetail } from "@/lib/adminOrderCreate";
import { ArError, getVatGroups, prepareArInvoice, saveArInvoice, type ArInvoiceInput } from "./service";

/**
 * AR Invoice (CK) — Import Excel: many draft AR Invoices from one sheet,
 * one invoice per Brand + Warehouse + Customer Code (rows in sheet order). The
 * header is filled the way New AR Invoice fills it when a customer is picked
 * (default bill-to / ship-to, invoice name / tax no. / address, the user's
 * department); Brand / Warehouse come from their columns (empty: brand from
 * the items, the customer's first warehouse), Remarks → the header remarks;
 * the posting and due dates come from the dialog. Saved as portal Drafts only —
 * each is posted to SAP from its own page.
 *
 * Per line: Total (excl. VAT) blank → Qty × Unit price × (1 − Disc %);
 * Unit price blank but Total given → price worked back from the total;
 * both given and they disagree by more than 1 ₫ → error. VAT accepts a VAT
 * group code (S08) or a rate (8, 8%, 0.08); blank → the item's own VAT group.
 *
 * Each invoice runs through the same checks as Save on New AR Invoice
 * (prepareArInvoice). `dryRun` only checks; otherwise the valid invoices are
 * saved as drafts and invalid ones skipped.
 */

export interface ArImportRow {
  /** Excel row number, for messages. */
  row: number;
  /** Header Brand (U_ProdBrand); empty = from the items. */
  brandCode?: string | null;
  /** Header warehouse; empty = the customer's default. */
  warehouseCode?: string | null;
  /** Header remarks (Comments). */
  remarks?: string | null;
  cardCode: string;
  cardName?: string | null;
  itemCode: string;
  description?: string | null;
  /** Numbers; a string = the cell's text when it isn't a number (reported). */
  quantity: number | string | null;
  unitPrice: number | string | null;
  discountPct: number | string | null;
  vat?: string | null;
  total: number | string | null;
}

/** A cell → number | null, or an error message. */
function cellNum(v: unknown, label: string): { n: number | null; error?: string } {
  if (v === null || v === undefined || v === "") return { n: null };
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/[\s,₫]/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? { n } : { n: null, error: `${label} "${String(v).slice(0, 30)}" is not a number` };
}

export interface ArImportResult {
  brandCode: string | null;
  warehouseCode: string | null;
  comments: string | null;
  cardCode: string;
  cardName: string | null;
  rows: number[];
  lines: { row: number; itemCode: string; itemName: string | null; description: string | null; quantity: number; unitPrice: number; discountPct: number; vatGroup: string | null; lineTotal: number }[];
  totalBefore: number;
  vatSum: number;
  docTotal: number;
  errors: string[];
  id?: number;
  docNumber?: string | null;
}

const MAX_INVOICES = 200;

function vatCodeOf(raw: string | null | undefined, codes: string[]): { code: string | null; error?: string } {
  const v = (raw ?? "").trim();
  if (!v) return { code: null };
  const byCode = codes.find((c) => c.toUpperCase() === v.toUpperCase());
  if (byCode) return { code: byCode };
  let n = Number(v.replace(/%$/, "").replace(",", "."));
  if (!Number.isFinite(n)) return { code: null, error: `VAT "${v}" is not a VAT group (${codes.join(", ")}) or a rate` };
  if (n > 0 && n < 1 && !v.endsWith("%")) n = n * 100; // 0.08 → 8%
  const code = `S${String(Math.round(n)).padStart(2, "0")}`;
  const hit = codes.find((c) => c.toUpperCase() === code);
  return hit ? { code: hit } : { code: null, error: `No VAT group for ${v}${v.endsWith("%") ? "" : "%"} (${codes.join(", ")})` };
}

export async function importArInvoices(
  session: AdminSession,
  input: { docDate: string; dueDate: string; rows: ArImportRow[]; dryRun: boolean }
): Promise<{ invoices: ArImportResult[]; created: number }> {
  const groups = new Map<string, ArImportRow[]>();
  for (const r of input.rows ?? []) {
    const code = String(r.cardCode ?? "").trim();
    const brand = String(r.brandCode ?? "").trim().toUpperCase() || null;
    const whs = String(r.warehouseCode ?? "").trim() || null;
    const key = `${brand ?? ""}|${whs ?? ""}|${code.toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...r, cardCode: code, brandCode: brand, warehouseCode: whs });
  }
  if (groups.size === 0) throw new ArError("The file has no lines");
  if (groups.size > MAX_INVOICES) throw new ArError(`At most ${MAX_INVOICES} customers (AR Invoices) per file`);

  const vatCodes = (await getVatGroups()).map((v) => v.code);
  const me = await queryOne<{ department_code: string | null }>(
    `SELECT department_code FROM admin_users WHERE company_id = ? AND id = ?`, [getCompanyId(), session.adminId]
  );

  const invoices: ArImportResult[] = [];
  let created = 0;
  for (const rows of groups.values()) {
    const cardCode = rows[0].cardCode;
    const comments = [...new Set(rows.map((r) => String(r.remarks ?? "").trim()).filter(Boolean))].join(" / ").slice(0, 254) || null;
    const res: ArImportResult = { brandCode: rows[0].brandCode ?? null, warehouseCode: rows[0].warehouseCode ?? null, comments, cardCode, cardName: rows.find((r) => r.cardName)?.cardName ?? null, rows: rows.map((r) => r.row), lines: [], totalBefore: 0, vatSum: 0, docTotal: 0, errors: [] };
    invoices.push(res);
    if (!cardCode) { res.errors.push(`Row ${rows.map((r) => r.row).join(", ")}: Customer Code is empty`); continue; }

    // Lines: work out quantity / price / VAT per Excel row.
    const lines: ArInvoiceInput["lines"] = [];
    for (const r of rows) {
      const at = `Row ${r.row}`;
      if (!String(r.itemCode ?? "").trim()) { res.errors.push(`${at}: Item code is empty`); continue; }
      const q = cellNum(r.quantity, "Qty"), p = cellNum(r.unitPrice, "Unit price"), dc = cellNum(r.discountPct, "Disc %"), tt = cellNum(r.total, "Total (excl. VAT)");
      const bad = [q, p, dc, tt].find((x) => x.error);
      if (bad) { res.errors.push(`${at}: ${bad.error}`); continue; }
      const quantity = q.n, total = tt.n;
      const disc = dc.n ?? 0;
      if (quantity === null || !Number.isFinite(quantity) || quantity === 0) { res.errors.push(`${at}: enter a Qty (not 0)`); continue; }
      if (!Number.isFinite(disc) || disc < 0 || disc > 100) { res.errors.push(`${at}: Disc % must be 0–100`); continue; }
      let unitPrice = p.n;
      if (unitPrice === null) {
        if (total === null) { res.errors.push(`${at}: enter a Unit price or a Total (excl. VAT)`); continue; }
        if (disc === 100) { res.errors.push(`${at}: with Disc % 100 enter the Unit price`); continue; }
        unitPrice = Math.round((total / quantity / (1 - disc / 100)) * 1e6) / 1e6;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) { res.errors.push(`${at}: Unit price must be 0 or more (a decrease is a negative Qty, e.g. −1)`); continue; }
      const computed = Math.round(quantity * unitPrice * (1 - disc / 100));
      if (total !== null && Math.abs(computed - total) > 1) {
        res.errors.push(`${at}: Total (excl. VAT) ${total.toLocaleString("en-US")} ≠ Qty × Unit price × (1 − Disc %) = ${computed.toLocaleString("en-US")} — leave Total empty to calculate it`);
        continue;
      }
      const vat = vatCodeOf(r.vat, vatCodes);
      if (vat.error) { res.errors.push(`${at}: ${vat.error}`); continue; }
      lines.push({ itemCode: r.itemCode.trim(), quantity, unitPrice, discountPct: disc, vatGroup: vat.code, description: r.description ?? null });
    }
    if (res.errors.length) continue;

    const customer = await getCustomerForAdmin(session, cardCode);
    if (!customer) { res.errors.push(`Customer ${cardCode} not found or not within your data permissions`); continue; }
    res.cardCode = customer.sap_card_code;
    res.cardName = customer.card_name;
    const d = await getCustomerDetail(session, customer);
    const bill = d.billTo.find((a) => a.name === customer.bill_to_default) ?? d.billTo[0];
    const header: ArInvoiceInput = {
      cardCode: customer.sap_card_code,
      billToCode: bill?.name ?? null,
      shipToCode: customer.ship_to_default ?? d.shipTo[0]?.name ?? null,
      invName: customer.card_name,
      invTaxNo: customer.mst_code,
      invAddress: (bill?.address ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
      docDate: input.docDate,
      dueDate: input.dueDate,
      taxDate: input.docDate,
      warehouseCode: rows[0].warehouseCode || d.warehouses[0]?.code || null,
      departmentCode: me?.department_code ?? null,
      brandCode: rows[0].brandCode || null,
      comments,
      lines,
    };

    try {
      const p = await prepareArInvoice(session, null, header);
      res.warehouseCode = p.wh;
      res.brandCode = p.headerBrand ?? ([...new Set(p.clean.map((l) => l.brand_code).filter(Boolean))].length === 1 ? p.clean[0].brand_code : null);
      res.lines = p.clean.map((l, i) => ({
        row: rows[i]?.row ?? 0, itemCode: l.item_code, itemName: l.item_name, description: l.description,
        quantity: l.quantity, unitPrice: l.unit_price, discountPct: l.discount_pct, vatGroup: l.vat_group, lineTotal: l.line_total,
      }));
      res.totalBefore = p.totalBefore;
      res.vatSum = p.vatSum;
      res.docTotal = p.totalBefore + p.vatSum;
      if (!input.dryRun) {
        res.id = await saveArInvoice(session, null, header);
        res.docNumber = (await queryOne<{ doc_number: string | null }>(`SELECT doc_number FROM ar_documents WHERE company_id = ? AND id = ?`, [getCompanyId(), res.id]))?.doc_number ?? null;
        created += 1;
      }
    } catch (e) {
      if (!(e instanceof ArError)) throw e;
      // "Line 3: …" → the Excel row of that line.
      res.errors.push(e.message.replace(/^Line (\d+)/, (_, n) => `Row ${rows[Number(n) - 1]?.row ?? n}`));
    }
  }
  return { invoices, created };
}
