import { VN_TIME_ZONE } from "@/lib/vnTime";

/**
 * Time-of-day windows for the Inventory Stock sync schedule (Vietnam time).
 * Each window says "between start and end, run every N minutes"; outside
 * every window the stock sync does NOT run at all — so root can keep SAP
 * load off-peak-free, e.g. nothing 22:00–08:00, every 10 min in office
 * hours, every 30 min in the evening.
 *
 * Pure (no DB / server imports) so the settings page can share the same
 * validation the API and the scheduler use.
 */
export interface StockSyncWindow {
  /** "HH:MM", inclusive. */
  start: string;
  /** "HH:MM", exclusive; "24:00" = end of day. If end < start the window crosses midnight. */
  end: string;
  intervalMinutes: number;
}

export const STOCK_SYNC_MIN_MINUTES = 5;
export const STOCK_SYNC_MAX_MINUTES = 1440;
export const STOCK_SYNC_MAX_WINDOWS = 12;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

/** "HH:MM" -> minutes since midnight (0–1440), or null if malformed. */
export function timeToMinutes(t: string): number | null {
  if (typeof t !== "string" || !TIME_RE.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes of the day [start, end) the window covers, as half-open ranges (two when it crosses midnight). */
function windowRanges(w: StockSyncWindow): [number, number][] {
  const s = timeToMinutes(w.start)!;
  const e = timeToMinutes(w.end)!;
  return s < e ? [[s, e]] : [[s, 1440], [0, e]];
}

/**
 * Validate a windows list from the client/DB. Returns an error message, or
 * null when valid. Rules: well-formed HH:MM, start ≠ end, interval within
 * range, and no two windows overlapping (so exactly one interval applies at
 * any moment).
 */
export function validateStockSyncWindows(windows: unknown): string | null {
  if (!Array.isArray(windows)) return "windows must be a list";
  if (windows.length > STOCK_SYNC_MAX_WINDOWS) return `At most ${STOCK_SYNC_MAX_WINDOWS} time windows`;
  const covered = new Array<number>(1440).fill(-1);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] as StockSyncWindow;
    const label = `Window ${i + 1}`;
    const s = timeToMinutes(w?.start);
    const e = timeToMinutes(w?.end);
    if (s === null || e === null || s === 1440) return `${label}: time must be HH:MM (00:00–24:00)`;
    // Full day = 00:00–24:00 (00:00–00:00 is rejected as ambiguous).
    if (s === e) return `${label}: start and end must differ`;
    if (
      !Number.isInteger(w.intervalMinutes) ||
      w.intervalMinutes < STOCK_SYNC_MIN_MINUTES ||
      w.intervalMinutes > STOCK_SYNC_MAX_MINUTES
    ) {
      return `${label}: interval must be a whole number of minutes, ${STOCK_SYNC_MIN_MINUTES}–${STOCK_SYNC_MAX_MINUTES}`;
    }
    for (const [a, b] of windowRanges(w)) {
      for (let m = a; m < b; m++) {
        if (covered[m] !== -1) return `${label} overlaps window ${covered[m] + 1}`;
        covered[m] = i;
      }
    }
  }
  return null;
}

/** Normalize whatever the DB returned (JSON column may arrive parsed or as text) into a windows list. */
export function parseStockSyncWindows(raw: unknown): StockSyncWindow[] {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) && validateStockSyncWindows(v) === null ? (v as StockSyncWindow[]) : [];
}

/** Current minute of the day in Vietnam time (0–1439), whatever the server's own time zone is. */
export function vnMinuteOfDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** The window active at `minuteOfDay`, or null when none covers it (= stock sync must not run). */
export function findActiveStockSyncWindow(windows: StockSyncWindow[], minuteOfDay: number): StockSyncWindow | null {
  return windows.find((w) => windowRanges(w).some(([a, b]) => minuteOfDay >= a && minuteOfDay < b)) ?? null;
}
