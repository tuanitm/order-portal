import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { getSapClient } from "@/lib/sap-b1/client";
import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { getArApprovalRequest, notifyStage, dropImportedCopies, type ArStatus, type ArApprovalRequest } from "@/lib/arInvoice/service";

/**
 * AR Invoice approval requests raised in the SAP CLIENT (a salesperson adds a
 * CKTM invoice in SAP, AR01–AR05 holds it) → pulled into the portal's AR
 * Invoice list as read-only rows (ar_documents.source = 'sap'), so the
 * Accountants approve / reject them on the portal like SO Approval.
 *
 *   which: OWDD ObjType 13 with DocDate on or after Settings → "Sync SO AR
 *          from" (sync_schedule_settings.so_approval_from_date — the same date
 *          SO Approval uses); no date set → only requests still pending (W).
 *   content: the Draft (pending / approved) or the added A/R Invoice, read
 *          through the Service Layer as the integration user (GET only —
 *          HANA has no grant on ODRF).
 *   bell: a request newer than the last one seen (notif_last_ar_wdd_code)
 *          that is pending notifies its current stage's authorizers. The
 *          first run only records where to start (no flood of old requests).
 *
 * Requests the portal raised itself (Post to SAP) are linked by wdd_code and
 * never imported again; if one slips in before the post links it,
 * postArInvoice drops the copy.
 */

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const cut = (v: unknown, n: number) => str(v)?.trim().slice(0, n) || null;

function statusOf(req: ArApprovalRequest): ArStatus {
  if (req.docEntry && ["Y", "P", "A"].includes(req.status)) return "posted";
  if (req.status === "W") return "pending_approval";
  if (req.status === "Y") return "approved";
  if (req.status === "N") return "rejected";
  return "cancelled";
}

let running: Promise<{ imported: number; notified: number }> | null = null;

/** Pull up to `limit` not-yet-imported SAP AR approval requests (newest first). Never runs twice at once. */
export function importSapArRequests(opts: { limit?: number; notify?: boolean } = {}) {
  if (!running) running = run(opts).finally(() => { running = null; });
  return running;
}

async function run({ limit = 30, notify = true }: { limit?: number; notify?: boolean }) {
  const companyId = getCompanyId();
  const sapDb = getHanaSchema();
  const st = await queryOne<{ from: string | null; last: number | null; lastDb: string | null }>(
    `SELECT DATE_FORMAT(so_approval_from_date, '%Y-%m-%d') AS \`from\`, notif_last_ar_wdd_code AS last, notif_last_ar_db AS lastDb
       FROM sync_schedule_settings WHERE company_id = ?`, [companyId]
  );
  if (!st) return { imported: 0, notified: 0 };
  // The bookmark belongs to one SAP company DB — pointed at another one (test DB), start over.
  if (st.lastDb !== sapDb) st.last = null;
  const s = `"${getHanaSchema()}"`;
  const fromOk = st.from && /^\d{4}-\d{2}-\d{2}$/.test(st.from) ? st.from : null;
  const cands = await queryHana<Record<string, unknown>>(
    `SELECT W."WddCode", U."USER_CODE" AS "Owner" FROM ${s}."OWDD" W LEFT JOIN ${s}."OUSR" U ON U."USERID" = W."OwnerID"
      WHERE W."ObjType" = '13' AND ${fromOk ? `W."DocDate" >= TO_DATE('${fromOk}')` : `W."Status" = 'W'`}
      ORDER BY W."WddCode" DESC LIMIT 1000`
  );
  const [mx] = await queryHana<Record<string, unknown>>(`SELECT IFNULL(MAX("WddCode"), 0) AS "M" FROM ${s}."OWDD" WHERE "ObjType" = '13'`);
  const maxWdd = num(mx?.M);
  let imported = 0, notified = 0;
  await linkRequestsOnPortalDrafts().catch((e) => console.warn("[AR Invoice] linking SAP requests to portal drafts failed:", e instanceof Error ? e.message : e));
  if (cands.length) {
    const codes = cands.map((c) => num(c.WddCode));
    const have = new Set((await query<{ w: number }[]>(
      `SELECT wdd_code AS w FROM ar_documents WHERE company_id = ? AND sap_db = ? AND wdd_code IN (${codes.map(() => "?").join(",")})`, [companyId, sapDb, ...codes]
    )).map((r) => Number(r.w)));
    for (const c of cands.filter((x) => !have.has(num(x.WddCode))).slice(0, limit)) {
      try {
        const id = await importOne(num(c.WddCode), str(c.Owner));
        if (!id) continue;
        imported++;
        if (notify && st.last !== null && num(c.WddCode) > st.last) {
          const req = await getArApprovalRequest(num(c.WddCode));
          if (req) notified += await notifyStage(id, req, { actor: str(c.Owner), reason: "Raised in SAP" });
        }
      } catch (e) {
        console.warn(`[AR Invoice] import of SAP approval request #${c.WddCode} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
  if (st.last === null || maxWdd > st.last) {
    await query(`UPDATE sync_schedule_settings SET notif_last_ar_wdd_code = ?, notif_last_ar_db = ? WHERE company_id = ?`, [maxWdd, sapDb, companyId]);
  }
  return { imported, notified };
}

/**
 * Someone opened a draft the PORTAL created (Adm Confirmed) in the SAP client and
 * added it there: SAP raised its own approval request on that draft. The request
 * then belongs to the portal document — it switches to SAP's approval
 * (approval_mode 'sap', wdd_code) — instead of a second "SAP-…" copy. Copies
 * imported before this existed are removed.
 */
async function linkRequestsOnPortalDrafts(): Promise<void> {
  const companyId = getCompanyId();
  const sapDb = getHanaSchema();
  const docs = await query<{ id: number; sap_draft_entry: number; wdd_code: number | null }[]>(
    `SELECT id, sap_draft_entry, wdd_code FROM ar_documents
      WHERE company_id = ? AND source = 'portal' AND sap_db = ? AND sap_draft_entry IS NOT NULL AND sap_doc_entry IS NULL
        AND status IN ('pending_approval', 'approved', 'rejected', 'failed')`, [companyId, sapDb]
  );
  if (!docs.length) return;
  const reqs = await queryHana<Record<string, unknown>>(
    `SELECT "WddCode", "DraftEntry" FROM "${sapDb}"."OWDD" WHERE "ObjType" = '13' AND "DraftEntry" IN (${[...new Set(docs.map((d) => Number(d.sap_draft_entry)))].join(",")})
      ORDER BY "WddCode" DESC`
  );
  for (const d of docs) {
    const r = reqs.find((x) => num(x.DraftEntry) === Number(d.sap_draft_entry));
    if (!r || num(r.WddCode) === Number(d.wdd_code)) continue;
    const req = await getArApprovalRequest(num(r.WddCode));
    if (!req) continue;
    await query(
      `UPDATE ar_documents SET approval_mode = 'sap', wdd_code = ?, wtm_code = ?, template_name = ?, status = ?, sap_doc_no = NULL WHERE company_id = ? AND id = ?`,
      [req.wddCode, req.wtmCode, req.templateName, statusOf(req), companyId, d.id]
    );
    await query(
      `INSERT INTO ar_document_events (company_id, ar_document_id, action, notes) VALUES (?, ?, 'imported', ?)`,
      [companyId, d.id, `SAP approval request #${req.wddCode} (${req.templateName ?? "template"}) was raised on this draft in SAP — following SAP's approval now`]
    );
    await dropImportedCopies(req.wddCode, d.id);
  }
}

async function importOne(wddCode: number, owner: string | null): Promise<number | null> {
  const req = await getArApprovalRequest(wddCode);
  if (!req) return null;
  // A request on a draft the portal created belongs to that portal document (see linkRequestsOnPortalDrafts).
  if (req.draftEntry && await queryOne(
    `SELECT id FROM ar_documents WHERE company_id = ? AND source = 'portal' AND sap_db = ? AND sap_draft_entry = ? LIMIT 1`,
    [getCompanyId(), getHanaSchema(), req.draftEntry]
  )) return null;
  const status = statusOf(req);
  const entity = req.docEntry ? "Invoices" : "Drafts";
  const entry = req.docEntry ?? req.draftEntry;
  if (!entry) return null;
  const d = await getSapClient().getDocument<Record<string, unknown>>(entity, entry);
  const lines = ((d.DocumentLines as Record<string, unknown>[] | undefined) ?? []);
  const companyId = getCompanyId();

  const rbtRefs = [...new Set(lines.map((l) => num(l.U_RBTRef)).filter((x) => x > 0))];
  const rebates = new Map<number, { code: string | null; name: string | null }>();
  if (rbtRefs.length) {
    const rows = await queryHana<Record<string, unknown>>(
      `SELECT "DocEntry", "U_RBTCode", "U_RBTName" FROM "${getHanaSchema()}"."@SAL_GE_RBT_H" WHERE "DocEntry" IN (${rbtRefs.join(",")})`
    ).catch(() => []);
    for (const r of rows) rebates.set(num(r.DocEntry), { code: str(r.U_RBTCode), name: str(r.U_RBTName) });
  }

  const total = num(d.DocTotal), vat = num(d.VatSum);
  const first = lines[0] ?? {};
  // Portal no. = SAP's AR. No (U_DocNo) when it has one and no other row uses it; else "SAP-<request no.>"
  // (the same number from another SAP company DB — test DB — gets the DB appended).
  const arNo = str(d.U_DocNo)?.slice(0, 30) ?? null;
  let docNo = arNo && !(await queryOne(`SELECT id FROM ar_documents WHERE company_id = ? AND doc_number = ?`, [companyId, arNo])) ? arNo : `SAP-${wddCode}`;
  if (docNo !== arNo && await queryOne(`SELECT id FROM ar_documents WHERE company_id = ? AND doc_number = ?`, [companyId, docNo])) docNo = `${docNo}-${getHanaSchema()}`.slice(0, 30);
  const ins = await query<{ insertId: number }>(
    `INSERT INTO ar_documents (company_id, doc_kind, source, sap_db, brand_code, sap_doc_no, doc_number, status, sap_card_code, card_name, bill_to_code, ship_to_code, inv_name, inv_tax_no, inv_address,
       doc_date, due_date, tax_date, num_at_card, comments, warehouse_code, department_code, total_before_vat, vat_sum, doc_total,
       created_by, created_by_label, posted_sap_user, posted_at, wdd_code, wtm_code, template_name, sap_draft_entry, sap_doc_entry, sap_doc_num)
     VALUES (?, 'invoice', 'sap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, getHanaSchema(), cut(d.U_ProdBrand, 20) ?? cut(first.CostingCode, 20), cut(d.U_DocNo, 50), docNo, status, String(d.CardCode ?? ""), cut(d.CardName, 200), cut(d.PayToCode, 100), cut(d.ShipToCode, 100),
      cut(d.U_InvName, 200), cut(d.U_InvTaxNo, 20), cut(d.U_InvAddress, 200),
      day(d.DocDate), day(d.DocDueDate) ?? day(d.DocDate), day(d.TaxDate) ?? day(d.DocDate), cut(d.NumAtCard, 100), cut(d.Comments, 254),
      cut(first.WarehouseCode, 20), cut(first.CostingCode2, 20), total - vat, vat, total,
      owner, owner, status === "posted" ? new Date() : null, req.wddCode, req.wtmCode, req.templateName, req.draftEntry,
      req.docEntry, req.docEntry ? num(d.DocNum) || null : null,
    ]
  );
  const id = (ins as unknown as { insertId: number }).insertId;
  let n = 0;
  for (const l of lines) {
    const rbt = num(l.U_RBTRef) > 0 ? num(l.U_RBTRef) : null;
    await query(
      `INSERT INTO ar_document_lines (company_id, ar_document_id, line_no, item_code, item_name, uom, quantity, unit_price, discount_pct, vat_group, brand_code, item_tax_class, description, line_total, rbt_ref, rbt_code, rbt_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, id, ++n, String(l.ItemCode ?? ""), cut(l.ItemDescription, 200), cut(l.MeasureUnit, 50), num(l.Quantity), num(l.UnitPrice ?? l.Price),
        num(l.DiscountPercent), cut(l.VatGroup, 20), cut(l.CostingCode, 20), cut(l.U_ItemTaxClass, 100), cut(l.U_INVDesc, 254), num(l.LineTotal),
        rbt, rbt ? rebates.get(rbt)?.code ?? null : null, rbt ? cut(rebates.get(rbt)?.name, 200) : null]
    );
  }
  await query(
    `INSERT INTO ar_document_events (company_id, ar_document_id, action, sap_user_code, notes) VALUES (?, ?, 'imported', ?, ?)`,
    [companyId, id, owner, `SAP approval request #${wddCode} (${req.templateName ?? `template ${req.wtmCode}`}) raised in SAP${owner ? ` by ${owner}` : ""}`]
  );
  return id;
}
