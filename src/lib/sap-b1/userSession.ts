import { Agent } from "undici";
import { loadConfig } from "@/lib/config";

/**
 * SAP B1 Service Layer sessions for INDIVIDUAL staff users (an Accountant
 * approving Sales Orders as their own SAP user), separate from the portal's
 * shared integration login in client.ts.
 *
 * The SAP password is sent to /Login once and never stored — only the
 * resulting B1SESSION id is kept, in server memory, keyed by admin_users.id,
 * until SAP's own session timeout (SessionTimeout minutes, sliding) or a
 * server restart. A 401 from SAP clears it; the Accountant then types the
 * password again.
 */
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

interface UserSapSession {
  sapUser: string;
  sessionId: string;
  /** ms epoch; refreshed on every successful call (SAP's timeout is sliding). */
  expiresAt: number;
  timeoutMs: number;
}

const g = globalThis as typeof globalThis & { __userSapSessions?: Map<number, UserSapSession> };
const sessions = (g.__userSapSessions ??= new Map());

export class SapLoginError extends Error {}
export class SapSessionExpiredError extends Error {}

function baseUrl(): string {
  return loadConfig().sapb1.baseUrl;
}

/** Is there a live SAP session for this staff member (and which SAP user)? */
export function getUserSapSession(adminUserId: number): { sapUser: string; expiresAt: number } | null {
  const s = sessions.get(adminUserId);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(adminUserId);
    return null;
  }
  return { sapUser: s.sapUser, expiresAt: s.expiresAt };
}

/** Log in to SAP as `sapUser` for this staff member. The password is not kept. */
export async function loginUserSapSession(adminUserId: number, sapUser: string, password: string): Promise<{ sapUser: string; expiresAt: number }> {
  const res = await fetch(`${baseUrl()}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: loadConfig().sapb1.companyID, UserName: sapUser, Password: password }),
    dispatcher: insecureDispatcher,
  } as RequestInit);
  if (!res.ok) {
    let message = `SAP login failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message?.value || body?.error?.message || message;
    } catch {
      // keep the generic message
    }
    throw new SapLoginError(message);
  }
  const data = await res.json() as { SessionId: string; SessionTimeout?: number };
  const timeoutMs = Math.max(5, Number(data.SessionTimeout) || 30) * 60 * 1000;
  // A minute of slack so we never use a session SAP has just dropped.
  const session: UserSapSession = { sapUser, sessionId: data.SessionId, timeoutMs, expiresAt: Date.now() + timeoutMs - 60_000 };
  sessions.set(adminUserId, session);
  return { sapUser, expiresAt: session.expiresAt };
}

export async function logoutUserSapSession(adminUserId: number): Promise<void> {
  const s = sessions.get(adminUserId);
  sessions.delete(adminUserId);
  if (!s) return;
  await fetch(`${baseUrl()}/Logout`, {
    method: "POST",
    headers: { Cookie: `B1SESSION=${s.sessionId}` },
    dispatcher: insecureDispatcher,
  } as RequestInit).catch(() => undefined);
}

/** One Service Layer call as this staff member's SAP user. */
export async function userSapRequest<T>(adminUserId: number, method: string, endpoint: string, body?: unknown): Promise<T> {
  const s = sessions.get(adminUserId);
  if (!s || s.expiresAt <= Date.now()) {
    sessions.delete(adminUserId);
    throw new SapSessionExpiredError("SAP session expired — enter your SAP password again");
  }
  const res = await fetch(`${baseUrl()}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `B1SESSION=${s.sessionId}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    dispatcher: insecureDispatcher,
  } as RequestInit);
  if (res.status === 401) {
    sessions.delete(adminUserId);
    throw new SapSessionExpiredError("SAP session expired — enter your SAP password again");
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message?.value || parsed?.error?.message || text;
    } catch {
      // not JSON
    }
    throw new Error(`SAP B1 error ${res.status}: ${message}`);
  }
  s.expiresAt = Date.now() + s.timeoutMs - 60_000;
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}
