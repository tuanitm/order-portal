import { query } from "@/lib/db/connection";
import {
  syncSapCustomers,
  syncItems,
  syncWarehouses,
  syncPriceLists,
  syncSpecialDiscountsForChannel,
  syncPeriodDiscounts,
  syncContractDiscounts,
} from "@/lib/sap-b1/sync";
import { syncPromotionDiscountsFromHana } from "@/lib/hana/sync";
import { syncCustomerGroupsFromHana } from "@/lib/customerGroups";
import { syncItemGroupsFromHana } from "@/lib/itemCategories";
import { syncOneOrderStatusFromSap } from "@/lib/orderStatusSync";

/**
 * Everything scripts/daily-sync.mjs already did (SAP Customers, Items,
 * Price Lists, Contract Discount agreements, Promotions) PLUS Customer
 * Group, Item Group, Warehouse, Channel Price List, and Period Discount —
 * the ones that external script never covered. Run via POST
 * /api/admin/settings/sync-schedule/run-now (manual) or by the in-process
 * scheduler in src/instrumentation.ts (automatic, on the interval set on
 * the Admin Settings page).
 */
export async function runScheduledSync(): Promise<{ status: "success" | "partial" | "failed"; summary: string }> {
  const steps: [string, () => Promise<unknown>][] = [
    ["Customer Group", () => syncCustomerGroupsFromHana()],
    ["Item Group", () => syncItemGroupsFromHana()],
    ["SAP Customers", () => syncSapCustomers()],
    ["Items", () => syncItems()],
    ["Warehouse", () => syncWarehouses()],
    ["Price List", () => syncPriceLists()],
    [
      "Channel Price List",
      async () => {
        const lists = await query<{ price_list_num: number }[]>(`SELECT price_list_num FROM price_lists`);
        const results: Record<number, { customersProcessed: number; rowsSynced: number }> = {};
        for (const l of lists) {
          results[l.price_list_num] = await syncSpecialDiscountsForChannel(l.price_list_num);
        }
        return results;
      },
    ],
    [
      "Period Discount",
      async () => {
        const lists = await query<{ price_list_num: number }[]>(`SELECT price_list_num FROM price_lists`);
        const results: Record<number, { rowsSynced: number }> = {};
        for (const l of lists) {
          results[l.price_list_num] = await syncPeriodDiscounts(l.price_list_num);
        }
        return results;
      },
    ],
    ["Contract Discount", () => syncContractDiscounts()],
    ["Promotion Discount", () => syncPromotionDiscountsFromHana()],
    [
      "SAP Order Status",
      async () => {
        // Sync status back from SAP for every order that has been pushed
        // (sap_doc_entry set) but isn't already in a local terminal state
        // (completed/cancelled/rejected are final on the portal side).
        const pending = await query<{ id: number }[]>(
          `SELECT id FROM orders
           WHERE sap_doc_entry IS NOT NULL
             AND status NOT IN ('completed', 'cancelled', 'rejected')
           ORDER BY id`
        );
        let updated = 0;
        let errors = 0;
        for (const { id } of pending) {
          try {
            const r = await syncOneOrderStatusFromSap(id);
            if (r.changed) updated++;
          } catch {
            errors++;
          }
        }
        return { checked: pending.length, updated, errors };
      },
    ],
  ];

  const lines: string[] = [];
  let okCount = 0;
  for (const [label, fn] of steps) {
    try {
      const result = await fn();
      lines.push(`✓ ${label}: ${JSON.stringify(result)}`);
      okCount++;
    } catch (error) {
      lines.push(`✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const status: "success" | "partial" | "failed" =
    okCount === steps.length ? "success" : okCount === 0 ? "failed" : "partial";
  const summary = lines.join("\n");

  await query(
    `UPDATE sync_schedule_settings SET last_run_at = NOW(), last_run_status = ?, last_run_summary = ? WHERE id = 1`,
    [status, summary]
  );

  return { status, summary };
}
