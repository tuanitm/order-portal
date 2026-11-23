import { queryHana, getHanaSchema } from "@/lib/hana/client";
import { getSapClient } from "@/lib/sap-b1/client";
import type { AdminSession } from "@/lib/auth/adminSession";

/**
 * Edit order + "Update SAP" — shared rules for the edit route
 * (PATCH /api/admin/orders/[id]/edit) and the push route's update mode
 * (POST /api/admin/orders/[id]/confirm?mode=update).
 *
 * Who: Admin, Accountant and System Admin (role kinds admin / account /
 * super_admin) with the Orders permission. Sales push their own orders but
 * don't edit / update them.
 */
export function canEditOrders(session: AdminSession): boolean {
  return session.isSuperAdmin || session.kind === "admin" || session.kind === "account";
}

/** Portal statuses whose order can no longer be edited. */
export const NON_EDITABLE_STATUSES = ["cancelled", "completed", "rejected", "delivered"];

/** The SAP document an order already pushed to SAP lives in now. */
export type SapOrderTarget =
  | { kind: "order"; docEntry: number; docNum: number; docDate: string | null; dataStatus: string | null }
  | { kind: "draft"; docEntry: number; docNum: number | null };

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * Find the SAP document of an order already pushed (orders.sap_doc_entry set)
 * and check it can still be changed. Throws an Error with a user-facing
 * message when it can't (closed, cancelled, delivered / invoiced, not found).
 *
 *  - A Sales Order carrying this order's number in U_RelDocs (every push sets
 *    it) — also finds the SO a Draft was turned into in SAP.
 *  - Not found and the order is still a Draft (status sap_draft_created):
 *    the Draft orders.sap_doc_entry points to.
 *  - Else (orders pushed before U_RelDocs): ORDR by orders.sap_doc_entry, for
 *    the same customer.
 */
export async function resolveSapOrderTarget(order: {
  order_number: string; status: string; sap_doc_entry: number | null; sap_card_code: string | null;
}): Promise<SapOrderTarget> {
  if (!order.sap_doc_entry) throw new Error("This order has not been pushed to SAP yet — use Confirm & Push to SAP");
  const s = `"${getHanaSchema()}"`;
  type Head = { DocEntry: number; DocNum: number; DocStatus: string; CANCELED: string; CardCode: string; DocDate: string | null; U_DataStatus: string | null };
  const cols = `"DocEntry", "DocNum", "DocStatus", "CANCELED", "CardCode", TO_VARCHAR("DocDate", 'YYYY-MM-DD') AS "DocDate", "U_DataStatus"`;
  let head: Head | undefined = (await queryHana<Head>(
    `SELECT ${cols} FROM ${s}."ORDR" WHERE "U_RelDocs" = ${lit(order.order_number)} AND "CANCELED" = 'N' ORDER BY "DocEntry" DESC LIMIT 1`
  ))[0];

  if (!head && order.status === "sap_draft_created") {
    type DraftInfo = { DocEntry?: number; DocNum?: number; DocumentStatus?: string; CardCode?: string };
    let draft = null as DraftInfo | null;
    try {
      draft = (await getSapClient().getDraftSalesOrder(order.sap_doc_entry)) as unknown as DraftInfo;
    } catch (e) {
      throw new Error(`SAP Draft ${order.sap_doc_entry} could not be read (${e instanceof Error ? e.message.slice(0, 160) : String(e)}) — use Update Status first`);
    }
    if (!draft?.DocEntry) throw new Error(`SAP Draft ${order.sap_doc_entry} no longer exists — use Update Status first`);
    if (draft.CardCode && order.sap_card_code && draft.CardCode !== order.sap_card_code) throw new Error(`SAP Draft ${order.sap_doc_entry} belongs to another customer (${draft.CardCode})`);
    if (draft.DocumentStatus && draft.DocumentStatus !== "bost_Open") throw new Error(`SAP Draft ${order.sap_doc_entry} is closed — it can't be updated`);
    return { kind: "draft", docEntry: draft.DocEntry, docNum: draft.DocNum ?? null };
  }
  if (!head && order.status !== "sap_draft_created") {
    head = (await queryHana<Head>(`SELECT ${cols} FROM ${s}."ORDR" WHERE "DocEntry" = ${Number(order.sap_doc_entry)}`))[0];
    if (head && order.sap_card_code && head.CardCode !== order.sap_card_code) head = undefined;
  }
  if (!head) throw new Error(`The SAP Sales Order of ${order.order_number} was not found — use Update Status first`);
  const docNum = Number(head.DocNum);
  if (head.CANCELED !== "N") throw new Error(`SAP Sales Order ${docNum} is cancelled — it can't be updated`);
  if (head.DocStatus !== "O") throw new Error(`SAP Sales Order ${docNum} is closed — it can't be updated`);
  const copied = await queryHana<{ n: number }>(
    `SELECT COUNT(*) AS "n" FROM ${s}."RDR1" WHERE "DocEntry" = ${Number(head.DocEntry)} AND ("TargetType" <> -1 OR "LineStatus" = 'C')`
  );
  if (Number(copied[0]?.n) > 0) {
    throw new Error(`SAP Sales Order ${docNum} is already (partly) delivered or invoiced — it can't be updated`);
  }
  return { kind: "order", docEntry: Number(head.DocEntry), docNum, docDate: head.DocDate ?? null, dataStatus: head.U_DataStatus ?? null };
}

/**
 * Quantity this Sales Order itself already reserves per item in a warehouse
 * (its open lines' OpenQty). Live "available" = in stock − committed counts
 * the SO's own lines as committed, so an update adds them back before
 * capping (a Draft reserves nothing).
 */
export async function committedBySalesOrder(docEntry: number, warehouseCode: string): Promise<Map<string, number>> {
  const s = `"${getHanaSchema()}"`;
  const rows = await queryHana<{ ItemCode: string; q: number }>(
    `SELECT "ItemCode", SUM("OpenQty") AS "q" FROM ${s}."RDR1"
      WHERE "DocEntry" = ${Number(docEntry)} AND "WhsCode" = ${lit(warehouseCode)} AND "Quantity" > 0 AND "LineStatus" = 'O'
      GROUP BY "ItemCode"`
  );
  return new Map(rows.map((r) => [String(r.ItemCode), Number(r.q) || 0]));
}
