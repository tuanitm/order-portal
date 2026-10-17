import { query, queryOne } from "@/lib/db/connection";
import { getSapClient } from "@/lib/sap-b1/client";
import { recordOrderStatus, notifyCustomerOfStatusChange } from "@/lib/orderHistory";

/**
 * Map SAP Sales Order DocStatus + Cancelled flag to the portal's orders.status ENUM.
 *
 * SAP DocStatus values (Service Layer):
 *   "bost_Open"       → Sales Order is open / approved in SAP
 *   "bost_Delivered"  → Delivery Note has been issued
 *   "bost_Closed"     → fully closed (all qty delivered + invoiced)
 * Cancelled = "tYES"  → order was cancelled in SAP
 */
export function mapSapStatusToPortal(
  docStatus: string | null,
  cancelled: string | null
): string {
  if (cancelled === "tYES") return "cancelled";
  switch (docStatus) {
    case "bost_Closed":    return "completed";
    case "bost_Delivered": return "delivered";
    case "bost_Open":
    default:               return "approved";
  }
}

/**
 * Fetch the SAP Sales Order status for one portal order and write it back:
 *   - sap_so_number  ← SAP U_DocNo (e.g. "SOO261015001")
 *   - status         ← mapped from SAP DocStatus / Cancelled
 *
 * Queries /Orders(docEntry) — the confirmed Sales Order endpoint, not
 * /Drafts.  Returns unchanged state when:
 *   - The order has no sap_doc_entry (never pushed to SAP)
 *   - The /Orders(docEntry) endpoint 404s (draft not yet approved in SAP)
 *
 * Safe to call repeatedly — idempotent when nothing changed.
 * Used by:
 *   - POST /api/admin/orders/[id]/sync-status (manual "Update Status" button)
 *   - runScheduledSync (cron, via scheduledSync.ts)
 */
export async function syncOneOrderStatusFromSap(orderId: number): Promise<{
  sapSoNumber: string | null;
  sapStatus: string | null;
  portalStatus: string;
  changed: boolean;
}> {
  const order = await queryOne<{
    id: number;
    order_number: string;
    sap_doc_entry: number | null;
    status: string;
    sap_so_number: string | null;
  }>(
    `SELECT id, order_number, sap_doc_entry, status, sap_so_number FROM orders WHERE id = ?`,
    [orderId]
  );
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (!order.sap_doc_entry) {
    return { sapSoNumber: null, sapStatus: null, portalStatus: order.status, changed: false };
  }

  const sap = getSapClient();
  const sapOrder = await sap.getSalesOrderStatus(order.sap_doc_entry, order.order_number);

  // null → draft not yet converted to a confirmed Sales Order in SAP
  if (!sapOrder) {
    return { sapSoNumber: order.sap_so_number, sapStatus: null, portalStatus: order.status, changed: false };
  }

  const newSoNumber = sapOrder.U_DocNo || null;
  const newPortalStatus = mapSapStatusToPortal(sapOrder.DocStatus, sapOrder.Cancelled);
  const changed =
    newSoNumber !== order.sap_so_number ||
    newPortalStatus !== order.status;

  if (changed) {
    await query(
      `UPDATE orders SET sap_so_number = ?, status = ? WHERE id = ?`,
      [newSoNumber, newPortalStatus, orderId]
    );
    if (newPortalStatus !== order.status) {
      await recordOrderStatus(orderId, newPortalStatus);
      await notifyCustomerOfStatusChange(orderId, newPortalStatus);
    }
  }

  return {
    sapSoNumber: newSoNumber,
    sapStatus: sapOrder.DocStatus,
    portalStatus: newPortalStatus,
    changed,
  };
}