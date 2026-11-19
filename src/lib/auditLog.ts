import type { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

export type AuditActorType = "admin" | "customer";
/** The actor's role kind at the time — Root/Super Admin, Admin, Sales or Customer. */
export type AuditActorRole = "super_admin" | "admin" | "sales" | "customer";

/**
 * One row written to `audit_logs` (see schema.sql for the table's own
 * comment on the design). `actorId` is nullable — a failed login before
 * any account row matched has no id yet, only whatever was typed.
 * `actorLabel` is a denormalized snapshot (userid/email/name), not a live
 * lookup, so a log entry still reads correctly after that account is later
 * renamed or removed — same reasoning as order_messages.sender_name.
 */
export interface AuditLogEntry {
  actorType: AuditActorType;
  actorId?: number | null;
  actorLabel?: string | null;
  /** Looked up from the actor's role when omitted (and actorId is set). */
  actorRole?: AuditActorRole | null;
  /** Short machine-readable event name, e.g. "login_success", "login_failed", "order_confirm". */
  action: string;
  /** What the action targeted, e.g. "order", "user" — omitted for a pure auth event. */
  entityType?: string;
  entityId?: string | number | null;
  /** Free-form extra context (old/new values, failure reason, ...) — stored as JSON, never queried into. */
  details?: Record<string, unknown>;
  /** Passed through so the IP/User-Agent can be captured — omit for contexts with no request (e.g. a background job). */
  request?: NextRequest;
}

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

/** Staff (actorType "admin") are admin_users rows; customers are users rows. */
async function roleOf(actorType: AuditActorType, actorId: number): Promise<AuditActorRole | null> {
  if (actorType === "customer") return "customer";
  const row = await queryOne<{ kind: AuditActorRole | null }>(
    `SELECT r.kind FROM admin_users a LEFT JOIN admin_roles r ON r.id = a.role_id WHERE a.company_id = ? AND a.id = ?`,
    [getCompanyId(), actorId]
  );
  return row?.kind ?? null;
}

/**
 * Writes one audit_logs row. Never throws — logging must never be the
 * reason a login, approval, or order action fails; a write failure is
 * logged to the server console instead and otherwise swallowed.
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const ip = entry.request ? clientIp(entry.request) : null;
    const userAgent = entry.request?.headers.get("user-agent")?.slice(0, 255) || null;
    const role = entry.actorRole !== undefined ? entry.actorRole : entry.actorId ? await roleOf(entry.actorType, entry.actorId) : null;
    await query(
      `INSERT INTO audit_logs
         (company_id, actor_type, actor_role, actor_id, actor_label, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        getCompanyId(),
        entry.actorType,
        role,
        entry.actorId ?? null,
        entry.actorLabel ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId != null ? String(entry.entityId) : null,
        entry.details ? JSON.stringify(entry.details) : null,
        ip,
        userAgent,
      ]
    );
  } catch (error) {
    console.error("[AuditLog] Failed to write audit log entry:", entry.action, error);
  }
}

// ── Route wrapper ────────────────────────────────────────────────────────────

const SECRET_KEY = /pass|token|otp|secret|hash/i;
const MAX_DETAILS_CHARS = 6000;

/** Drop secrets (passwords, tokens, OTPs) from a logged request body, at any depth. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "***" : redact(v, depth + 1)])
  );
}

/** The response's top-level plain values (e.g. { success, customersSynced: 226, orderNumber }) — not lists or objects. */
function summarize(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = typeof v === "string" ? v.slice(0, 300) : v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Who is calling: staff (admin-token) on /api/admin, else the storefront customer. */
async function resolveActor(request: NextRequest): Promise<{ type: AuditActorType; id: number; label: string; role: AuditActorRole } | null> {
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    const { getAdminSession } = await import("@/lib/auth/adminSession");
    const s = await getAdminSession(request);
    return s && s.adminId ? { type: "admin", id: s.adminId, label: s.userid || s.email, role: s.kind } : null;
  }
  const { getSessionUser } = await import("@/lib/auth/session");
  const u = await getSessionUser(request);
  if (!u) return null;
  const row = await queryOne<{ userid: string | null }>(`SELECT userid FROM users WHERE company_id = ? AND id = ?`, [getCompanyId(), u.id]);
  return { type: "customer", id: u.id, label: row?.userid || u.email || u.sapCardCode || u.fullName, role: "customer" };
}

export interface AuditSpec {
  /** Event name, e.g. "order_update". A failed call (HTTP 4xx/5xx) is logged as `${action}_failed`. */
  action: string;
  /** What it targets, e.g. "order". */
  entityType?: string;
  /** Route param holding the target's id, e.g. "id" for /orders/[id]. */
  entityParam?: string;
  /** Log the (redacted) request body — on by default. */
  logBody?: boolean;
  /** Only log failed calls — for routes that already write their own detailed success entry. */
  failuresOnly?: boolean;
}

/**
 * Wraps a route handler so every call is written to the audit log: who
 * (userid, role), what (action, target id), the request body (passwords and
 * tokens masked), and the outcome (HTTP status, the response's summary
 * values or its error). Calls with no signed-in user are not logged
 * (they're rejected before doing anything). Logging never changes or
 * delays the response beyond one insert, and never throws.
 */
export function audited<C>(spec: AuditSpec, handler: (request: NextRequest, context: C) => Promise<Response>) {
  return async (request: NextRequest, context: C): Promise<Response> => {
    const body = spec.logBody === false ? undefined : await request.clone().json().catch(() => undefined);
    const response = await handler(request, context);
    if (spec.failuresOnly && response.status < 400) return response;
    try {
      const actor = await resolveActor(request);
      if (!actor) return response;
      const params = (context as { params?: Promise<Record<string, string>> } | undefined)?.params;
      const entityId = spec.entityParam && params ? (await params)[spec.entityParam] : undefined;
      const ok = response.status < 400;
      const resBody = await response.clone().json().catch(() => undefined);
      let details: Record<string, unknown> = {
        status: response.status,
        ...(body !== undefined ? { request: redact(body) } : {}),
        ...(ok ? { result: summarize(resBody) } : { error: summarize(resBody) ?? "failed" }),
      };
      if (JSON.stringify(details).length > MAX_DETAILS_CHARS) {
        details = {
          status: response.status, truncated: true,
          requestKeys: body && typeof body === "object" ? Object.keys(body as object) : undefined,
          ...(ok ? { result: summarize(resBody) } : { error: summarize(resBody) }),
        };
      }
      await logAuditEvent({
        actorType: actor.type, actorId: actor.id, actorLabel: actor.label, actorRole: actor.role,
        action: ok ? spec.action : `${spec.action}_failed`,
        entityType: spec.entityType, entityId: entityId ?? null, details, request,
      });
    } catch (error) {
      console.error("[AuditLog] audited() failed:", spec.action, error);
    }
    return response;
  };
}
