import type { NextRequest } from "next/server";
import { query } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

export type AuditActorType = "admin" | "customer";

/**
 * One row written to `audit_logs` (see schema.sql for the table's own
 * comment on the design). `actorId` is nullable — a failed login before
 * any account row matched has no id yet, only whatever was typed.
 * `actorLabel` is a denormalized snapshot (email/name), not a live lookup,
 * so a log entry still reads correctly after that account is later
 * renamed or removed — same reasoning as order_messages.sender_name.
 */
export interface AuditLogEntry {
  actorType: AuditActorType;
  actorId?: number | null;
  actorLabel?: string | null;
  /** Short machine-readable event name, e.g. "login_success", "login_failed", "order_confirm". */
  action: string;
  /** What the action targeted, e.g. "order", "admin_user" — omitted for a pure auth event. */
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

/**
 * Writes one audit_logs row. Never throws — logging must never be the
 * reason a login, approval, or order action fails; a write failure is
 * logged to the server console instead and otherwise swallowed. Callers
 * fire this right before their own success/failure response, not awaited
 * defensively (the `await` here is only to let a thrown error be caught
 * locally, not to block the caller on the write finishing).
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const ip = entry.request ? clientIp(entry.request) : null;
    const userAgent = entry.request?.headers.get("user-agent")?.slice(0, 255) || null;
    await query(
      `INSERT INTO audit_logs
         (company_id, actor_type, actor_id, actor_label, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        getCompanyId(),
        entry.actorType,
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
