import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";
import { fernetEncrypt, fernetDecrypt } from "@/lib/fernet";
import {
  getUserSapSession, loginUserSapSession, logoutUserSapSession, userSapRequest, SapLoginError, SapSessionExpiredError,
} from "@/lib/sap-b1/userSession";

/**
 * An Accountant's own SAP B1 login (user + password), entered ONCE — in My
 * Profile by the Accountant, or on the Users page by Super Admin — and kept
 * Fernet-encrypted in admin_users.sap_password_enc ("FERNET:gAAAA…", same key
 * as the .env secrets). Saving always verifies it with a real SAP login.
 * Approving then signs in to SAP with it automatically; when SAP refuses it
 * (the password was changed in SAP) the Accountant is asked to update it.
 *
 * Who has one: Accountants (role kind "account" — they approve Sales Orders
 * as this user) and Admin / Sales users (kinds "admin", "sales" — they push
 * orders to SAP as this user, so SAP's creator / originator is the real
 * person). Super Admin pushes with the portal's integration login (admin02).
 *
 * Sales accounts (Salesman): several Sales accounts may share ONE SAP user
 * (e.g. a sales team on sa01) — only System Admin sets it (Users page), the
 * Salesman sees it read only. Its password is the same SAP login for all of
 * them, so saving it on one copies it to every Sales account on that SAP
 * user, and a Sales account newly given that SAP user adopts it. Accountant
 * and Admin SAP users stay one-to-one.
 */
export const SAP_ACCOUNT_KINDS = ["account", "admin", "sales"] as const;
export const hasSapAccountKind = (kind: string | null | undefined) => (SAP_ACCOUNT_KINDS as readonly string[]).includes(kind ?? "");
export class SapCredentialError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}
/** The saved password no longer works in SAP — update it in My Profile. */
export class SapPasswordInvalidError extends Error {
  code = "sap_password_invalid";
}

export interface SapCredentialStatus {
  sapUserCode: string | null;
  hasPassword: boolean;
  updatedAt: string | null;
}

async function accountUser(adminUserId: number) {
  return queryOne<{ id: number; kind: string | null; sap_user_code: string | null; sap_password_enc: string | null; sap_password_updated_at: string | null }>(
    `SELECT a.id, r.kind, a.sap_user_code, a.sap_password_enc, a.sap_password_updated_at
       FROM admin_users a LEFT JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id
      WHERE a.company_id = ? AND a.id = ?`,
    [getCompanyId(), adminUserId]
  );
}

export async function getSapCredentialStatus(adminUserId: number): Promise<SapCredentialStatus> {
  const u = await accountUser(adminUserId);
  return { sapUserCode: u?.sap_user_code ?? null, hasPassword: !!u?.sap_password_enc, updatedAt: u?.sap_password_updated_at ?? null };
}

/**
 * Can `adminUserId` (role kind `kind`) use SAP user `code`? Returns the error
 * message, or null. Shared only when this AND every other holder is a Sales account.
 */
export async function sapUserCodeClash(code: string, adminUserId: number | null, kind: string | null | undefined): Promise<string | null> {
  const holders = await query<{ id: number; userid: string | null; kind: string | null }[]>(
    `SELECT a.id, a.userid, r.kind FROM admin_users a LEFT JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id
      WHERE a.company_id = ? AND LOWER(a.sap_user_code) = LOWER(?) AND a.id <> ?`,
    [getCompanyId(), code.trim(), adminUserId ?? 0]
  );
  if (holders.length === 0) return null;
  if (kind === "sales" && holders.every((h) => h.kind === "sales")) return null;
  const h = holders.find((x) => kind !== "sales" || x.kind !== "sales") ?? holders[0];
  return `SAP user ${code.trim()} is already linked to ${h.userid ?? `user ${h.id}`} — only Sales accounts can share one SAP user`;
}

/**
 * A Sales account just given a SAP user that other Sales accounts already
 * have a saved password for: take that saved (encrypted) password over.
 */
export async function adoptSharedSapPassword(adminUserId: number): Promise<boolean> {
  const u = await accountUser(adminUserId);
  if (!u || u.kind !== "sales" || !u.sap_user_code || u.sap_password_enc) return false;
  const sib = await queryOne<{ sap_password_enc: string; sap_password_updated_at: string | null }>(
    `SELECT a.sap_password_enc, a.sap_password_updated_at FROM admin_users a JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id AND r.kind = 'sales'
      WHERE a.company_id = ? AND LOWER(a.sap_user_code) = LOWER(?) AND a.id <> ? AND a.sap_password_enc IS NOT NULL
      ORDER BY a.sap_password_updated_at DESC LIMIT 1`,
    [getCompanyId(), u.sap_user_code, adminUserId]
  );
  if (!sib) return false;
  await query(`UPDATE admin_users SET sap_password_enc = ?, sap_password_updated_at = ? WHERE company_id = ? AND id = ?`,
    [sib.sap_password_enc, sib.sap_password_updated_at, getCompanyId(), adminUserId]);
  return true;
}

/** Is this staff user an Accountant (role kind "account")? */
export async function isAccountantUser(adminUserId: number): Promise<boolean> {
  return (await accountUser(adminUserId))?.kind === "account";
}

/** Can this staff user have their own SAP login (Accountant / Admin / Sales)? */
export async function canHaveSapAccount(adminUserId: number): Promise<boolean> {
  return hasSapAccountKind((await accountUser(adminUserId))?.kind);
}

/**
 * Verify with SAP, then store (encrypted). One SAP user belongs to one portal
 * user. The verifying login is kept as the user's live SAP session.
 */
export async function saveSapCredentials(adminUserId: number, sapUserCodeRaw: string, password: string): Promise<SapCredentialStatus> {
  const sapUserCode = sapUserCodeRaw.trim();
  if (!sapUserCode || sapUserCode.length > 50 || !/^[\w.@-]+$/.test(sapUserCode)) throw new SapCredentialError("Enter a valid SAP user code");
  if (!password) throw new SapCredentialError("Enter the SAP password");
  if (password.length > 200) throw new SapCredentialError("SAP password is too long");
  const u = await accountUser(adminUserId);
  if (!u) throw new SapCredentialError("User not found", 404);
  if (!hasSapAccountKind(u.kind)) throw new SapCredentialError("SAP credentials are only for Admin, Sales and Accountant users", 403);
  const clash = await sapUserCodeClash(sapUserCode, adminUserId, u.kind);
  if (clash) throw new SapCredentialError(clash, 409);

  try {
    await loginUserSapSession(adminUserId, sapUserCode, password);
  } catch (e) {
    if (e instanceof SapLoginError) throw new SapCredentialError(`SAP refused the login for ${sapUserCode}: ${e.message}`, 422, "sap_login_failed");
    throw e;
  }
  const enc = fernetEncrypt(password);
  await query(
    `UPDATE admin_users SET sap_user_code = ?, sap_password_enc = ?, sap_password_updated_at = NOW() WHERE company_id = ? AND id = ?`,
    [sapUserCode, enc, getCompanyId(), adminUserId]
  );
  if (u.kind === "sales") {
    // The same SAP login for every Sales account sharing this SAP user; their old sessions are dropped.
    const sibs = await query<{ id: number }[]>(
      `SELECT a.id FROM admin_users a JOIN admin_roles r ON r.company_id = a.company_id AND r.id = a.role_id AND r.kind = 'sales'
        WHERE a.company_id = ? AND LOWER(a.sap_user_code) = LOWER(?) AND a.id <> ?`,
      [getCompanyId(), sapUserCode, adminUserId]
    );
    if (sibs.length) {
      await query(`UPDATE admin_users SET sap_password_enc = ?, sap_password_updated_at = NOW() WHERE company_id = ? AND id IN (${sibs.map(() => "?").join(",")})`,
        [enc, getCompanyId(), ...sibs.map((x) => x.id)]);
      await Promise.all(sibs.map((x) => logoutUserSapSession(x.id).catch(() => undefined)));
    }
  }
  return getSapCredentialStatus(adminUserId);
}

/** Forget the saved password (the SAP user code stays) and end the live SAP session. */
export async function clearSapPassword(adminUserId: number): Promise<void> {
  await query(
    `UPDATE admin_users SET sap_password_enc = NULL, sap_password_updated_at = NULL WHERE company_id = ? AND id = ?`,
    [getCompanyId(), adminUserId]
  );
  await logoutUserSapSession(adminUserId);
}

/**
 * A live SAP session for this user: the current one, or a new login with the
 * saved credentials. null = nothing saved. Throws SapPasswordInvalidError
 * when SAP refuses the saved password.
 */
export async function ensureUserSapSession(adminUserId: number, forceNew = false): Promise<{ sapUser: string; expiresAt: number } | null> {
  if (!forceNew) {
    const live = getUserSapSession(adminUserId);
    if (live) return live;
  }
  const u = await accountUser(adminUserId);
  if (!u?.sap_user_code || !u.sap_password_enc) return getUserSapSession(adminUserId);
  let password: string;
  try {
    password = fernetDecrypt(u.sap_password_enc);
  } catch {
    throw new SapPasswordInvalidError("The saved SAP password can't be decrypted (encryption key changed?) — enter it again in My Profile.");
  }
  try {
    return await loginUserSapSession(adminUserId, u.sap_user_code, password);
  } catch (e) {
    if (e instanceof SapLoginError) {
      throw new SapPasswordInvalidError(`SAP refused the saved password for ${u.sap_user_code} (${e.message}) — if it was changed in SAP, update it in My Profile.`);
    }
    throw e;
  }
}

/**
 * One Service Layer call as this staff member's own SAP user: the live
 * session, or a login with the saved password; when SAP has dropped the
 * session, signs in again once and retries. Throws SapPasswordInvalidError
 * (saved password refused) or SapSessionExpiredError (nothing saved).
 */
export async function sapRequestAsUser<T>(adminUserId: number, method: string, endpoint: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  if (!(await ensureUserSapSession(adminUserId))) throw new SapSessionExpiredError("No SAP user and password saved — set them in My Profile");
  try {
    return await userSapRequest<T>(adminUserId, method, endpoint, body, extraHeaders);
  } catch (e) {
    if (!(e instanceof SapSessionExpiredError)) throw e;
    if (!(await ensureUserSapSession(adminUserId, true))) throw e;
    return userSapRequest<T>(adminUserId, method, endpoint, body, extraHeaders);
  }
}
