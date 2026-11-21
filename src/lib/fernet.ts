import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Fernet (https://github.com/fernet/spec) — the same symmetric encryption
 * and the same key file (scripts/.encryption_key) as the "FERNET:gAAAA…"
 * secrets in .env (decrypted by resolveEnvSecret via Python's
 * cryptography.fernet). Done natively here so a secret never appears on a
 * process command line. Tokens are interchangeable with Python's:
 *   Fernet(open('scripts/.encryption_key','rb').read()).decrypt(b'gAAAA…')
 */
const PREFIX = "FERNET:";

function key(): { signing: Buffer; encryption: Buffer } {
  const raw = readFileSync(join(process.cwd(), "scripts", ".encryption_key"), "utf-8").trim();
  const k = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (k.length !== 32) throw new Error("scripts/.encryption_key is not a valid Fernet key");
  return { signing: k.subarray(0, 16), encryption: k.subarray(16) };
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Encrypt → "FERNET:gAAAA…" (same form as .env values). */
export function fernetEncrypt(plain: string): string {
  const { signing, encryption } = key();
  const iv = randomBytes(16);
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const cipher = createCipheriv("aes-128-cbc", encryption, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const body = Buffer.concat([Buffer.from([0x80]), time, iv, ct]);
  const mac = createHmac("sha256", signing).update(body).digest();
  return PREFIX + b64url(Buffer.concat([body, mac]));
}

/** Decrypt a "FERNET:gAAAA…" (or bare "gAAAA…") token. Throws when it isn't valid for this key. */
export function fernetDecrypt(token: string): string {
  const { signing, encryption } = key();
  const data = unb64url(token.trim().replace(/^FERNET:/, ""));
  if (data.length < 1 + 8 + 16 + 16 + 32 || data[0] !== 0x80) throw new Error("Not a Fernet token");
  const body = data.subarray(0, data.length - 32);
  const mac = data.subarray(data.length - 32);
  const expected = createHmac("sha256", signing).update(body).digest();
  if (!timingSafeEqual(mac, expected)) throw new Error("Fernet token signature mismatch (wrong key?)");
  const iv = body.subarray(9, 25);
  const decipher = createDecipheriv("aes-128-cbc", encryption, iv);
  return Buffer.concat([decipher.update(body.subarray(25)), decipher.final()]).toString("utf8");
}
