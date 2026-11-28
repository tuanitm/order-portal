import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
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
 * The SAP sync, split into groups that each run on their own interval
 * (Settings → SAP Sync Schedule, Super Admin): e.g. Master Data every 6 h,
 * Price List and Discount every 24 h, Promotion every 12 h, SO status every 4 h.
 * Inventory Stock is NOT here: it has its own, faster schedule (see
 * stockSyncSchedule.ts). The in-process scheduler (src/instrumentation.ts)
 * runs whichever groups are due, one at a time; "Run now" runs one group or all.
 * Groups run in this order (Master Data first: prices and discounts need its
 * items / customers).
 */
export type SyncGroupKey = "master" | "price" | "discount" | "promotion" | "order_status";
type Step = [string, () => Promise<unknown>];

const priceListNums = async () =>
  (await query<{ price_list_num: number }[]>(`SELECT price_list_num FROM price_lists WHERE company_id = ?`, [getCompanyId()])).map((l) => l.price_list_num);

export const SYNC_GROUPS: { key: SyncGroupKey; label: string; defaultHours: number; steps: Step[] }[] = [
  {
    key: "master", label: "Master Data", defaultHours: 6,
    steps: [
      ["Customer Group", () => syncCustomerGroupsFromHana()],
      ["Item Group", () => syncItemGroupsFromHana()],
      ["SAP Customers", () => syncSapCustomers()],
      ["Items", () => syncItems()],
      ["Warehouse", () => syncWarehouses()],
    ],
  },
  {
    key: "price", label: "Price List", defaultHours: 24,
    steps: [
      ["Price List", () => syncPriceLists()],
      ["Channel Price List", async () => {
        const results: Record<number, { customersProcessed: number; rowsSynced: number }> = {};
        for (const n of await priceListNums()) results[n] = await syncSpecialDiscountsForChannel(n);
        return results;
      }],
    ],
  },
  {
    key: "discount", label: "Discount", defaultHours: 24,
    steps: [
      ["Period Discount", async () => {
        const results: Record<number, { rowsSynced: number }> = {};
        for (const n of await priceListNums()) results[n] = await syncPeriodDiscounts(n);
        return results;
      }],
      ["Contract Discount", () => syncContractDiscounts()],
    ],
  },
  {
    key: "promotion", label: "Promotion", defaultHours: 12,
    steps: [["Promotion Discount", () => syncPromotionDiscountsFromHana()]],
  },
  {
    key: "order_status", label: "SO / Order Status", defaultHours: 4,
    steps: [[
      "SAP Order Status",
      async () => {
        // Sync status back from SAP for every order that has been pushed
        // (sap_doc_entry set) but isn't already in a local terminal state
        // (completed/cancelled/rejected are final on the portal side).
        const pending = await query<{ id: number }[]>(
          `SELECT id FROM orders
           WHERE company_id = ?
             AND sap_doc_entry IS NOT NULL
             AND status NOT IN ('completed', 'cancelled', 'rejected')
           ORDER BY id`,
          [getCompanyId()]
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
    ]],
  },
];

export const SYNC_INTERVAL_MIN_HOURS = 1;
export const SYNC_INTERVAL_MAX_HOURS = 24 * 30;

export interface SyncGroupSchedule {
  key: SyncGroupKey;
  label: string;
  steps: string[];
  isEnabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  lastRunStatus: "success" | "partial" | "failed" | null;
  lastRunSummary: string | null;
  /** When the scheduler runs it next (null = disabled). */
  nextRunAt: string | null;
}

let groupTableMissing = false;
const isMissingTable = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

/**
 * Every group's schedule. A group without a row yet starts from the old
 * combined schedule (is_enabled / interval_hours / last_run_at) — so upgrading
 * changes nothing until Super Admin sets the new intervals. Before the
 * sync_group_schedule table exists (scripts/migrate_sync_group_schedule.mjs)
 * every group simply follows the combined schedule.
 */
export async function getSyncGroupSchedules(): Promise<SyncGroupSchedule[]> {
  const companyId = getCompanyId();
  const legacy = await query<{ is_enabled: number; interval_hours: number; last_run_at: Date | string | null; last_run_status: string | null }[]>(
    `SELECT is_enabled, interval_hours, last_run_at, last_run_status FROM sync_schedule_settings WHERE company_id = ?`, [companyId]
  ).then((r) => r[0] ?? null);
  let rows: { group_key: string; is_enabled: number; interval_hours: number; last_run_at: Date | string | null; last_run_status: string | null; last_run_summary: string | null }[] = [];
  try {
    rows = await query(`SELECT group_key, is_enabled, interval_hours, last_run_at, last_run_status, last_run_summary FROM sync_group_schedule WHERE company_id = ?`, [companyId]);
    groupTableMissing = false;
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    groupTableMissing = true;
  }
  const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
  return SYNC_GROUPS.map((g) => {
    const r = rows.find((x) => x.group_key === g.key);
    const isEnabled = r ? !!r.is_enabled : !!legacy?.is_enabled;
    const intervalHours = Math.max(SYNC_INTERVAL_MIN_HOURS, Number(r ? r.interval_hours : legacy?.interval_hours) || g.defaultHours);
    const lastRunAt = iso(r ? r.last_run_at : legacy?.last_run_at);
    return {
      key: g.key, label: g.label, steps: g.steps.map(([l]) => l), isEnabled, intervalHours,
      lastRunAt, lastRunStatus: ((r ? r.last_run_status : legacy?.last_run_status) ?? null) as SyncGroupSchedule["lastRunStatus"],
      lastRunSummary: r?.last_run_summary ?? null,
      nextRunAt: isEnabled ? new Date((lastRunAt ? new Date(lastRunAt).getTime() : 0) + intervalHours * 3600 * 1000).toISOString() : null,
    };
  });
}

/** Whether sync_group_schedule exists (false until the migration has been run). */
export async function syncGroupTableReady(): Promise<boolean> {
  await getSyncGroupSchedules();
  return !groupTableMissing;
}

/** Save one group's on/off + interval (Super Admin). */
export async function saveSyncGroupSchedule(key: SyncGroupKey, isEnabled: boolean, intervalHours: number): Promise<void> {
  if (!SYNC_GROUPS.some((g) => g.key === key)) throw new Error(`Unknown sync group ${key}`);
  const current = (await getSyncGroupSchedules()).find((g) => g.key === key)!;
  if (groupTableMissing) throw new Error("Run scripts/migrate_sync_group_schedule.mjs --apply first (per-group schedule table is missing)");
  await query(
    `INSERT INTO sync_group_schedule (company_id, group_key, is_enabled, interval_hours, last_run_at) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), interval_hours = VALUES(interval_hours)`,
    [getCompanyId(), key, isEnabled, intervalHours, current.lastRunAt ? new Date(current.lastRunAt) : null]
  );
}

/** Run one group's steps and record the result on that group (and on the combined "last run"). */
export async function runSyncGroup(key: SyncGroupKey): Promise<{ status: "success" | "partial" | "failed"; summary: string }> {
  const group = SYNC_GROUPS.find((g) => g.key === key);
  if (!group) throw new Error(`Unknown sync group ${key}`);
  const lines: string[] = [];
  let okCount = 0;
  for (const [label, fn] of group.steps) {
    const t0 = Date.now();
    try {
      const result = await fn();
      lines.push(`✓ ${label} (${((Date.now() - t0) / 1000).toFixed(0)} s): ${JSON.stringify(result)}`);
      okCount++;
    } catch (error) {
      lines.push(`✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const status: "success" | "partial" | "failed" = okCount === group.steps.length ? "success" : okCount === 0 ? "failed" : "partial";
  const summary = lines.join("\n");
  const companyId = getCompanyId();
  const current = (await getSyncGroupSchedules()).find((g) => g.key === key)!;
  try {
    await query(
      `INSERT INTO sync_group_schedule (company_id, group_key, is_enabled, interval_hours, last_run_at, last_run_status, last_run_summary)
       VALUES (?, ?, ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE last_run_at = NOW(), last_run_status = VALUES(last_run_status), last_run_summary = VALUES(last_run_summary)`,
      [companyId, key, current.isEnabled, current.intervalHours, status, summary]
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  return { status, summary };
}

/** The groups due now (enabled and their interval passed since their last run), in run order. */
export async function dueSyncGroups(): Promise<SyncGroupKey[]> {
  const now = Date.now();
  return (await getSyncGroupSchedules()).filter((g) => g.isEnabled && g.nextRunAt && new Date(g.nextRunAt).getTime() <= now).map((g) => g.key);
}

/**
 * Run several groups (default: all) one after another — "Run all now", and the
 * scheduler for whatever is due. Also kept on the combined "last run" columns
 * (sync_schedule_settings), so anything reading those still works.
 */
export async function runScheduledSync(keys: SyncGroupKey[] = SYNC_GROUPS.map((g) => g.key)): Promise<{ status: "success" | "partial" | "failed"; summary: string }> {
  const companyId = getCompanyId();
  const parts: string[] = [];
  const statuses: string[] = [];
  for (const key of keys) {
    const label = SYNC_GROUPS.find((g) => g.key === key)?.label ?? key;
    const r = await runSyncGroup(key);
    statuses.push(r.status);
    parts.push(`[${label}] ${r.status}\n${r.summary}`);
  }
  const status: "success" | "partial" | "failed" =
    statuses.every((x) => x === "success") ? "success" : statuses.every((x) => x === "failed") ? "failed" : "partial";
  const summary = parts.join("\n\n");

  // sync_schedule_settings is one row PER COMPANY (company_id is the PRIMARY
  // KEY) — upsert: a company's row may not exist yet.
  await query(
    `INSERT INTO sync_schedule_settings (company_id, last_run_at, last_run_status, last_run_summary)
     VALUES (?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE last_run_at = NOW(), last_run_status = VALUES(last_run_status), last_run_summary = VALUES(last_run_summary)`,
    [companyId, status, summary]
  );
  return { status, summary };
}
