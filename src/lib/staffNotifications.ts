import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { homePathForKind, type RoleKind } from "@/lib/auth/adminSession";
import { queryHana, getHanaSchema } from "@/lib/hana/client";

/**
 * Staff notifications — the inbox bell (every staff area) and the flashing
 * NEW markers in SO Approval and Orders. One row per recipient
 * (admin_users.id); read_at NULL = new. Opening the SO / order, clicking the
 * notification, or "Mark all read" marks it read.
 *
 * Events (all best effort — a notification never fails the action itself):
 *   so_approval_request  an SO waits for you (pushed from the portal, the
 *                        next stage after an approval, an approval undone,
 *                        or a request raised in the SAP client — found by
 *                        pollSapApprovalRequests every minute)
 *   so_approved / so_rejected / so_stage_approved / so_undone
 *                        to whoever created / pushed the SO (orders.created_by_admin_id,
 *                        orders.sap_pushed_by_admin_id, and the portal users of the
 *                        SAP user that created it — every Sales account sharing it)
 * An unread notification of the same kind for the same SO isn't repeated
 * (for "waits for your approval": while it's still unprocessed).
 *
 * The bell's red number = unread notifications + "waits for your approval"
 * ones still unprocessed (processed_at NULL) — those stay counted, even once
 * opened, until the SO no longer waits for that user: decided (by them or the
 * stage), approved / rejected, or decided in SAP (reconciled by the poller and
 * when the user's SO Approval list loads).
 */
export type NotificationKind = "so_approval_request" | "so_approved" | "so_rejected" | "so_stage_approved" | "so_undone";

export interface StaffNotification {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** Path without the locale, e.g. /account/approvals/21775. */
  url: string | null;
  docEntry: number | null;
  orderId: number | null;
  actor: string | null;
  createdAt: string;
  readAt: string | null;
  /** "Waits for your approval" and the SO still waits for you — counted on the bell until processed. */
  toDo: boolean;
}

const lc = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

interface Recipient { id: number; kind: RoleKind }

/** Active staff whose SAP user is one of these codes (several Sales accounts may share one). */
export async function staffForSapUsers(codes: string[], kinds?: RoleKind[]): Promise<Recipient[]> {
  const clean = [...new Set(codes.map(lc).filter(Boolean))];
  if (clean.length === 0) return [];
  const rows = await query<{ id: number; kind: RoleKind }[]>(
    `SELECT a.id, r.kind FROM admin_users a JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id
      WHERE a.company_id = ? AND a.is_active = 1 AND LOWER(a.sap_user_code) IN (${marks(clean.length)})
        ${kinds?.length ? `AND r.kind IN (${marks(kinds.length)})` : ""}`,
    [getCompanyId(), ...clean, ...(kinds ?? [])]
  );
  return rows;
}

async function staffByIds(ids: number[]): Promise<Recipient[]> {
  const clean = [...new Set(ids.filter((x) => Number.isInteger(x) && x > 0))];
  if (clean.length === 0) return [];
  return query<{ id: number; kind: RoleKind }[]>(
    `SELECT a.id, r.kind FROM admin_users a JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id
      WHERE a.company_id = ? AND a.is_active = 1 AND a.id IN (${marks(clean.length)})`,
    [getCompanyId(), ...clean]
  );
}

/** Insert one notification per recipient, skipping `excludeId` and anyone with the same unread kind for this SO. */
async function insertFor(recipients: Recipient[], n: {
  kind: NotificationKind; title: string; body?: string | null; url: (r: Recipient) => string | null;
  docEntry?: number | null; orderId?: number | null; actor?: string | null;
}, excludeId?: number | null): Promise<number> {
  const companyId = getCompanyId();
  const seen = new Set<number>();
  let count = 0;
  for (const r of recipients) {
    if (seen.has(r.id) || r.id === excludeId) continue;
    seen.add(r.id);
    if (n.docEntry) {
      const dup = await queryOne<{ id: number }>(
        `SELECT id FROM staff_notifications WHERE company_id = ? AND admin_user_id = ? AND sap_doc_entry = ? AND kind = ?
            AND ${n.kind === "so_approval_request" ? "processed_at IS NULL" : "read_at IS NULL"} LIMIT 1`,
        [companyId, r.id, n.docEntry, n.kind]
      );
      if (dup) continue;
    }
    await query(
      `INSERT INTO staff_notifications (company_id, admin_user_id, kind, title, body, url, sap_doc_entry, order_id, actor_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, r.id, n.kind, n.title.slice(0, 255), n.body ?? null, n.url(r), n.docEntry ?? null, n.orderId ?? null, n.actor?.slice(0, 255) ?? null]
    );
    count++;
  }
  return count;
}

/** The SO's number / customer, and the portal order linked to it. */
async function soFacts(docEntry: number) {
  const s = `"${getHanaSchema()}"`;
  const [h] = await queryHana<Record<string, unknown>>(
    `SELECT O."DocNum", O."U_DocNo", O."CardCode", O."CardName", U."USER_CODE" FROM ${s}."ORDR" O LEFT JOIN ${s}."OUSR" U ON U."USERID" = O."UserSign"
      WHERE O."DocEntry" = ${Number(docEntry)}`
  ).catch(() => []);
  const po = await queryOne<{ id: number; order_number: string; created_by_admin_id: number | null; sap_pushed_by_admin_id: number | null }>(
    `SELECT id, order_number, created_by_admin_id, sap_pushed_by_admin_id FROM orders WHERE company_id = ? AND sap_doc_entry = ? ORDER BY id DESC LIMIT 1`,
    [getCompanyId(), docEntry]
  );
  const docNo = h ? String(h.U_DocNo ?? h.DocNum) : po?.order_number ?? String(docEntry);
  return {
    docNo, cardName: h?.CardName ? String(h.CardName) : null, cardCode: h?.CardCode ? String(h.CardCode) : null,
    creatorSapUser: h?.USER_CODE ? String(h.USER_CODE) : null, po,
  };
}

const approvalUrl = (docEntry: number) => () => `/account/approvals/${docEntry}`;

/** An SO waits for these SAP users' approval (Accountants). */
export async function notifyApprovalNeeded(docEntry: number, waitingFor: string[], opts: { actor?: string | null; reason?: string; stage?: string | null; excludeAdminId?: number | null } = {}): Promise<number> {
  const recipients = await staffForSapUsers(waitingFor, ["account"]);
  if (recipients.length === 0) return 0;
  const f = await soFacts(docEntry);
  return insertFor(recipients, {
    kind: "so_approval_request",
    title: `SO ${f.docNo} waits for your approval`,
    body: [f.cardName && `${f.cardCode} · ${f.cardName}`, opts.stage && `Stage ${opts.stage}`, opts.reason, opts.actor && `By ${opts.actor}`].filter(Boolean).join(" — "),
    url: approvalUrl(docEntry), docEntry, orderId: f.po?.id ?? null, actor: opts.actor ?? null,
  }, opts.excludeAdminId);
}

/** Tell whoever created / pushed the SO how its approval went. */
export async function notifySubmitters(docEntry: number, ev: {
  kind: Exclude<NotificationKind, "so_approval_request">; by: string | null; note?: string | null; waitingFor?: string[]; auto?: boolean; excludeAdminId?: number | null;
}): Promise<number> {
  const f = await soFacts(docEntry);
  const ids = [f.po?.created_by_admin_id ?? 0, f.po?.sap_pushed_by_admin_id ?? 0];
  const recipients = [
    ...(await staffByIds(ids)),
    ...(f.creatorSapUser ? await staffForSapUsers([f.creatorSapUser], ["admin", "sales", "super_admin"]) : []),
  ].filter((r) => r.kind !== "account" && r.kind !== "customer");
  if (recipients.length === 0) return 0;
  const head = ev.kind === "so_approved" ? `✓ SO ${f.docNo} approved${ev.auto ? " (Auto SO Approval)" : ""}`
    : ev.kind === "so_rejected" ? `✕ SO ${f.docNo} rejected`
    : ev.kind === "so_stage_approved" ? `SO ${f.docNo}: stage approved`
    : `↶ SO ${f.docNo}: approval undone`;
  const tail = ev.kind === "so_approved" ? "Released in SAP (U_DataStatus C)."
    : ev.kind === "so_rejected" ? "Stays at U_DataStatus I in SAP."
    : ev.kind === "so_stage_approved" ? `Waiting for ${ev.waitingFor?.join(", ") || "the next stage"}.`
    : `Back to U_DataStatus I — waiting for ${ev.waitingFor?.join(", ") || "approval"} again.`;
  return insertFor(recipients, {
    kind: ev.kind, title: head,
    body: [f.cardName && `${f.cardCode} · ${f.cardName}`, ev.by && `By ${ev.by}`, tail, ev.note && `“${ev.note.slice(0, 300)}”`].filter(Boolean).join(" — "),
    // Their own order page (/admin or /sales); an SO made in SAP has no portal page.
    url: (r) => (f.po ? `${homePathForKind(r.kind)}/orders/${f.po.id}` : null),
    docEntry, orderId: f.po?.id ?? null, actor: ev.by,
  }, ev.excludeAdminId);
}

/** Run a notification without ever failing the caller. */
export function notifySafely(label: string, fn: () => Promise<unknown>): void {
  void fn().catch((e) => console.warn(`[Notifications] ${label} failed:`, e));
}

// ── Inbox ──────────────────────────────────────────────────────────────

/** Counted on the bell: unread, or "waits for your approval" not processed yet. */
const OPEN_SQL = `(read_at IS NULL OR (kind = 'so_approval_request' AND processed_at IS NULL))`;

export async function listNotifications(adminUserId: number, limit = 30): Promise<{ items: StaffNotification[]; unread: number; toDo: number }> {
  const [rows, cnt] = await Promise.all([
    query<{ id: number; kind: NotificationKind; title: string; body: string | null; url: string | null; sap_doc_entry: number | null; order_id: number | null; actor_label: string | null; created_at: string; read_at: string | null; processed_at: string | null }[]>(
      // Still-to-do and unread first, then the rest, newest first.
      `SELECT id, kind, title, body, url, sap_doc_entry, order_id, actor_label, created_at, read_at, processed_at FROM staff_notifications
        WHERE company_id = ? AND admin_user_id = ? ORDER BY ${OPEN_SQL} DESC, id DESC LIMIT ${Math.min(100, Math.max(1, limit))}`,
      [getCompanyId(), adminUserId]
    ),
    queryOne<{ n: number; todo: number }>(
      `SELECT COUNT(*) AS n, SUM(kind = 'so_approval_request' AND processed_at IS NULL) AS todo
         FROM staff_notifications WHERE company_id = ? AND admin_user_id = ? AND ${OPEN_SQL}`,
      [getCompanyId(), adminUserId]
    ),
  ]);
  return {
    unread: Number(cnt?.n ?? 0),
    toDo: Number(cnt?.todo ?? 0),
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, url: r.url, docEntry: r.sap_doc_entry, orderId: r.order_id,
      actor: r.actor_label, createdAt: r.created_at, readAt: r.read_at, toDo: r.kind === "so_approval_request" && !r.processed_at,
    })),
  };
}

/**
 * The SO no longer waits for these recipients: mark their "waits for your
 * approval" notifications processed (off the bell's count). `stillWaiting` =
 * SAP users it still / now waits for (they stay counted); null = nobody.
 */
export async function markApprovalProcessed(docEntry: number, stillWaiting: string[] | null): Promise<void> {
  const keep = [...new Set((stillWaiting ?? []).map(lc).filter(Boolean))];
  await query(
    `UPDATE staff_notifications n JOIN admin_users a ON a.company_id = n.company_id AND a.id = n.admin_user_id
        SET n.processed_at = NOW()
      WHERE n.company_id = ? AND n.sap_doc_entry = ? AND n.kind = 'so_approval_request' AND n.processed_at IS NULL
        ${keep.length ? `AND LOWER(IFNULL(a.sap_user_code, '')) NOT IN (${marks(keep.length)})` : ""}`,
    [getCompanyId(), docEntry, ...keep]
  );
}

/** Which of these SOs already have an unprocessed "waits for your approval" for this user. */
export async function docsWithOpenRequest(adminUserId: number, docEntries: number[]): Promise<Set<number>> {
  if (docEntries.length === 0) return new Set();
  const rows = await query<{ d: number }[]>(
    `SELECT DISTINCT sap_doc_entry AS d FROM staff_notifications WHERE company_id = ? AND admin_user_id = ? AND kind = 'so_approval_request'
        AND processed_at IS NULL AND sap_doc_entry IN (${marks(docEntries.length)})`,
    [getCompanyId(), adminUserId, ...docEntries]
  );
  return new Set(rows.map((r) => Number(r.d)));
}

/** This user's to-do notifications for SOs that are not waiting for them any more (their SO Approval list just loaded). */
export async function markProcessedExcept(adminUserId: number, stillWaitingDocs: number[]): Promise<void> {
  await query(
    `UPDATE staff_notifications SET processed_at = NOW()
      WHERE company_id = ? AND admin_user_id = ? AND kind = 'so_approval_request' AND processed_at IS NULL
        ${stillWaitingDocs.length ? `AND sap_doc_entry NOT IN (${marks(stillWaitingDocs.length)})` : ""}`,
    [getCompanyId(), adminUserId, ...stillWaitingDocs]
  );
}

/**
 * Background (poller): to-do notifications whose SO isn't waiting for anyone
 * any more — decided in the SAP client, or a portal-run approval finished —
 * are marked processed.
 */
async function reconcileProcessed(): Promise<void> {
  const docs = (await query<{ d: number }[]>(
    `SELECT DISTINCT sap_doc_entry AS d FROM staff_notifications WHERE company_id = ? AND kind = 'so_approval_request' AND processed_at IS NULL AND sap_doc_entry IS NOT NULL LIMIT 300`,
    [getCompanyId()]
  )).map((r) => Number(r.d));
  if (docs.length === 0) return;
  const s = `"${getHanaSchema()}"`;
  const [sapReqs, runs, undoneRows] = await Promise.all([
    queryHana<Record<string, unknown>>(
      `SELECT W."DocEntry", W."Status" FROM ${s}."OWDD" W WHERE W."ObjType" = '17' AND W."DocEntry" IN (${docs.join(",")})
          AND W."WddCode" = (SELECT MAX(X."WddCode") FROM ${s}."OWDD" X WHERE X."ObjType" = '17' AND X."DocEntry" = W."DocEntry")`
    ),
    query<{ d: number; ar_status: string | null; templates: unknown }[]>(
      `SELECT sap_doc_entry AS d, ar_status, sap_approval_templates AS templates FROM orders WHERE company_id = ? AND sap_doc_entry IN (${marks(docs.length)})`,
      [getCompanyId(), ...docs]
    ),
    query<{ d: number }[]>(
      `SELECT DISTINCT sap_doc_entry AS d FROM so_approvals WHERE company_id = ? AND undone_at IS NOT NULL AND sap_doc_entry IN (${marks(docs.length)})`,
      [getCompanyId(), ...docs]
    ),
  ]);
  const sapState = new Map(sapReqs.map((r) => [Number(r.DocEntry), String(r.Status)]));
  const portal = new Map(runs.map((r) => [Number(r.d), r]));
  const undone = new Set(undoneRows.map((r) => Number(r.d)));
  for (const d of docs) {
    // An SO whose approval was undone is decided in the portal again — its decisions keep the bell
    // right (decideApproval / the user's Pending list); not guessed here.
    if (undone.has(d)) continue;
    const sap = sapState.get(d);
    const po = portal.get(d);
    // An SAP request follows SAP (W = waiting); a portal-run approval follows the portal order.
    const pending = sap !== undefined ? sap === "W" : po?.templates != null ? po.ar_status === "pending" : true;
    if (!pending) await markApprovalProcessed(d, null);
  }
}

export async function markNotificationsRead(adminUserId: number, which: { ids?: number[]; all?: boolean; docEntry?: number; orderId?: number }): Promise<void> {
  const base = `UPDATE staff_notifications SET read_at = NOW() WHERE company_id = ? AND admin_user_id = ? AND read_at IS NULL`;
  const p = [getCompanyId(), adminUserId];
  if (which.all) await query(base, p);
  else if (which.ids?.length) await query(`${base} AND id IN (${marks(which.ids.length)})`, [...p, ...which.ids]);
  else if (which.docEntry) await query(`${base} AND sap_doc_entry = ?`, [...p, which.docEntry]);
  else if (which.orderId) await query(`${base} AND order_id = ?`, [...p, which.orderId]);
}

/** Which of these SOs have an unread notification for this user (the NEW marker). */
export async function unreadDocEntries(adminUserId: number, docEntries: number[]): Promise<Set<number>> {
  if (docEntries.length === 0) return new Set();
  const rows = await query<{ d: number }[]>(
    `SELECT DISTINCT sap_doc_entry AS d FROM staff_notifications WHERE company_id = ? AND admin_user_id = ? AND read_at IS NULL AND sap_doc_entry IN (${marks(docEntries.length)})`,
    [getCompanyId(), adminUserId, ...docEntries]
  );
  return new Set(rows.map((r) => Number(r.d)));
}

/** Which of these portal orders have an unread notification for this user. */
export async function unreadOrderIds(adminUserId: number, orderIds: number[]): Promise<Set<number>> {
  if (orderIds.length === 0) return new Set();
  const rows = await query<{ o: number }[]>(
    `SELECT DISTINCT order_id AS o FROM staff_notifications WHERE company_id = ? AND admin_user_id = ? AND read_at IS NULL AND order_id IN (${marks(orderIds.length)})`,
    [getCompanyId(), adminUserId, ...orderIds]
  );
  return new Set(rows.map((r) => Number(r.o)));
}

// ── SAP approval requests raised in the SAP client ─────────────────────

/**
 * Every minute (instrumentation.ts): SAP approval requests for Sales Orders
 * created since the last check (a salesperson setting U_DataStatus C in the
 * SAP client, …) → notify the current stage's pending authorizers. The
 * first run only records where to start (no flood of old requests).
 */
export async function pollSapApprovalRequests(): Promise<number> {
  const companyId = getCompanyId();
  await reconcileProcessed().catch((e) => console.warn("[Notifications] reconcile failed:", e));
  const st = await queryOne<{ last: number | null; from: string | null }>(
    `SELECT notif_last_wdd_code AS last, DATE_FORMAT(so_approval_from_date, '%Y-%m-%d') AS \`from\` FROM sync_schedule_settings WHERE company_id = ?`, [companyId]
  );
  if (!st) return 0;
  const s = `"${getHanaSchema()}"`;
  if (st.last === null) {
    const [m] = await queryHana<Record<string, unknown>>(`SELECT IFNULL(MAX("WddCode"), 0) AS "M" FROM ${s}."OWDD" WHERE "ObjType" = '17'`);
    await query(`UPDATE sync_schedule_settings SET notif_last_wdd_code = ? WHERE company_id = ?`, [Number(m?.M ?? 0), companyId]);
    return 0;
  }
  const reqs = await queryHana<Record<string, unknown>>(
    `SELECT TOP 200 W."WddCode", W."DocEntry", W."Status", W."CurrStep", U."USER_CODE" AS "Creator",
            (SELECT STRING_AGG(Z."USER_CODE", ',') FROM ${s}."WDD1" D JOIN ${s}."OUSR" Z ON Z."USERID" = D."UserID"
              WHERE D."WddCode" = W."WddCode" AND D."StepCode" = W."CurrStep" AND D."Status" = 'W') AS "Waiting"
       FROM ${s}."OWDD" W JOIN ${s}."ORDR" O ON O."DocEntry" = W."DocEntry" LEFT JOIN ${s}."OUSR" U ON U."USERID" = W."OwnerID"
      WHERE W."ObjType" = '17' AND W."WddCode" > ${Number(st.last)}
        ${st.from ? `AND O."DocDate" >= TO_DATE('${st.from}')` : ""}
      ORDER BY W."WddCode"`
  );
  // Advance the bookmark even past requests skipped by the from-date (so they aren't re-read).
  const [m] = await queryHana<Record<string, unknown>>(`SELECT IFNULL(MAX("WddCode"), 0) AS "M" FROM ${s}."OWDD" WHERE "ObjType" = '17'`);
  let sent = 0;
  for (const r of reqs) {
    if (String(r.Status) !== "W") continue;
    const waiting = String(r.Waiting ?? "").split(",").filter(Boolean);
    sent += await notifyApprovalNeeded(Number(r.DocEntry), waiting, { reason: `SAP approval request #${r.WddCode}`, actor: r.Creator ? String(r.Creator) : null });
  }
  const top = reqs.length === 200 ? Number(reqs[reqs.length - 1].WddCode) : Number(m?.M ?? st.last);
  await query(`UPDATE sync_schedule_settings SET notif_last_wdd_code = ? WHERE company_id = ? AND (notif_last_wdd_code IS NULL OR notif_last_wdd_code < ?)`, [top, companyId, top]);
  return sent;
}
