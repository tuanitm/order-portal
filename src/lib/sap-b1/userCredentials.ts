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
  const clash = await queryOne<{ id: number }>(
    `SELECT id FROM admin_users WHERE company_id = ? AND LOWER(sap_user_code) = LOWER(?) AND id <> ?`,
    [getCompanyId(), sapUserCode, adminUserId]
  );
  if (clash) throw new SapCredentialError(`SAP user ${sapUserCode} is already linked to another portal user`, 409);

  try {
    await loginUserSapSession(adminUserId, sapUserCode, password);
  } catch (e) {
    if (e instanceof SapLoginError) throw new SapCredentialError(`SAP refused the login for ${sapUserCode}: ${e.message}`, 422, "sap_login_failed");
    throw e;
  }
  await query(
    `UPDATE admin_users SET sap_user_code = ?, sap_password_enc = ?, sap_password_updated_at = NOW() WHERE company_id = ? AND id = ?`,
    [sapUserCode, fernetEncrypt(password), getCompanyId(), adminUserId]
  );
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
export async function sapRequestAsUser<T>(adminUserId: number, method: string, endpoint: string, body?: unknown): Promise<T> {
  if (!(await ensureUserSapSession(adminUserId))) throw new SapSessionExpiredError("No SAP user and password saved — set them in My Profile");
  try {
    return await userSapRequest<T>(adminUserId, method, endpoint, body);
  } catch (e) {
    if (!(e instanceof SapSessionExpiredError)) throw e;
    if (!(await ensureUserSapSession(adminUserId, true))) throw e;
    return userSapRequest<T>(adminUserId, method, endpoint, body);
  }
}
