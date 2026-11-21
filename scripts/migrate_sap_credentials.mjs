/**
 * Accountants keep their SAP user + password in My Profile (entered once).
 *
 *   node scripts/migrate_sap_credentials.mjs           dry run
 *   node scripts/migrate_sap_credentials.mjs --apply   apply (idempotent)
 *
 * Additive only — safe on the DB shared with Order-Portal2 (ADS):
 *  - admin_users.sap_password_enc: the SAP B1 password, Fernet-encrypted
 *    ("FERNET:gAAAA…", key scripts/.encryption_key — same as .env secrets).
 *  - admin_users.sap_password_updated_at: when it was last saved + verified.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf-8"));
const COMPANY = config.admin?.entityID;
if (!COMPANY) throw new Error("config.json admin.entityID is missing");

function secret(name) {
  const env = readFileSync(join(root, ".env"), "utf-8");
  const raw = (env.match(new RegExp(`${name}=["']?([^"'\\r\\n]+)["']?`)) || [])[1] || "";
  const token = raw.replace(/^FERNET:/, "");
  if (!token.startsWith("gAAAAA")) return raw;
  const key = join(root, "scripts", ".encryption_key");
  return execSync(`python -c "from cryptography.fernet import Fernet; print(Fernet(open(r'${key}','rb').read()).decrypt(b'${token}').decode(), end='')"`, { encoding: "utf-8" });
}

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST || config.mysql.dbIp, port: Number(process.env.MYSQL_PORT) || config.mysql.dbPort,
  user: config.mysql.dpUser, password: secret("MYSQL_DB_PASS"), database: config.mysql.dbName, charset: "utf8mb4",
});
const q = async (sql, params = []) => (await db.query(sql, params))[0];
const log = (...a) => console.log(APPLY ? "[apply]" : "[plan] ", ...a);
const run = async (label, sql, params = []) => { log(label); if (APPLY) return (await db.query(sql, params))[0]; return null; };
const cols = async (t) => new Set((await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [t])).map((r) => r.c));
const hasTable = async (t) => (await q("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [t])).length > 0;
const hasIndex = async (t, name) => (await q("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", [t, name])).length > 0;

console.log(`Company ${COMPANY} — ${APPLY ? "APPLYING" : "dry run (add --apply)"}\n`);
const c = await cols("admin_users");
if (!c.has("sap_password_enc")) await run("admin_users + sap_password_enc", "ALTER TABLE admin_users ADD COLUMN sap_password_enc TEXT NULL AFTER sap_user_code");
if (!c.has("sap_password_updated_at")) await run("admin_users + sap_password_updated_at", "ALTER TABLE admin_users ADD COLUMN sap_password_updated_at TIMESTAMP NULL AFTER sap_password_enc");
console.log("\ndone");
await db.end();
