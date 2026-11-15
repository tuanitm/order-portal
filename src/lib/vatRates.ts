import { getSapClient } from "@/lib/sap-b1/client";

/**
 * SAP output-tax (VAT) rates by VAT group code, e.g. S08 → 8, S10 → 10 —
 * the code each item carries as items.vat_group (SAP Items.SalesVATGroup),
 * the same code posted on the Sales Order line.
 *
 * Read from SAP's /VatGroups and kept in memory for 12 hours. If SAP can't be
 * reached the last known rates are kept; if they were never loaded, the
 * caller gets an empty map and shows the tax as unknown.
 */
const TTL_MS = 12 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

let cache: Map<string, number> = new Map();
let loadedAt = 0;
let nextAttemptAt = 0;
let inFlight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  try {
    const sap = getSapClient();
    const groups = await sap.getOutputVatGroups();
    const today = new Date().toISOString().slice(0, 10);
    const next = new Map<string, number>();
    for (const g of groups) {
      // The rate in force today: the latest line whose Effectivefrom has passed.
      const lines = (g.VatGroups_Lines ?? [])
        .filter((l) => !l.Effectivefrom || l.Effectivefrom.slice(0, 10) <= today)
        .sort((a, b) => (a.Effectivefrom ?? "").localeCompare(b.Effectivefrom ?? ""));
      const current = lines[lines.length - 1];
      if (current && Number.isFinite(Number(current.Rate))) next.set(g.Code, Number(current.Rate));
    }
    cache = next;
    loadedAt = Date.now();
    nextAttemptAt = loadedAt + TTL_MS;
  } catch (error) {
    console.error("[VAT] Could not load VAT rates from SAP — keeping the last known rates:", error);
    nextAttemptAt = Date.now() + RETRY_AFTER_FAILURE_MS;
  }
}

export async function getVatRates(): Promise<Map<string, number>> {
  if (Date.now() >= nextAttemptAt) {
    inFlight ??= refresh().finally(() => { inFlight = null; });
    // Only wait when nothing is cached yet; otherwise refresh in the background.
    if (loadedAt === 0) await inFlight;
  }
  return cache;
}

/**
 * VAT per order (orderId → amount): each line's Line Total x its item's VAT
 * rate, rounded per line — the same rule as the order detail pages, so the
 * totals agree. Lines with an unknown rate add nothing.
 */
export async function getOrderVatTotals(companyId: string, orderIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (orderIds.length === 0) return result;
  const { query } = await import("@/lib/db/connection");
  const [rates, lines] = await Promise.all([
    getVatRates(),
    query<{ order_id: number; line_total: string; vat_group: string | null }[]>(
      `SELECT ol.order_id, ol.line_total, i.vat_group
         FROM order_lines ol
         LEFT JOIN items i ON i.company_id = ol.company_id AND i.sap_item_code = ol.sap_item_code
        WHERE ol.company_id = ? AND ol.order_id IN (${orderIds.map(() => "?").join(",")})`,
      [companyId, ...orderIds]
    ),
  ]);
  for (const l of lines) {
    const rate = l.vat_group ? rates.get(l.vat_group) : undefined;
    if (rate === undefined) continue;
    result.set(l.order_id, (result.get(l.order_id) ?? 0) + Math.round((Number(l.line_total) * rate) / 100));
  }
  return result;
}
