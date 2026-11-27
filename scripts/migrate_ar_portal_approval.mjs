/**
 * AR Invoice — portal-run approval (the SAP AR01–AR05 templates followed on
 * the portal, as SO Approval does). Adds to ar_documents:
 *   approval_mode   'sap'    = SAP raised the approval request (OWDD)
 *                   'portal' = the portal evaluated the templates, saved the
 *                              invoice in SAP as a Draft, and runs the stages
 *   portal_approval JSON     = { templates: [{ wtmCode, name, stages: [...] }], decisions: [...] }
 *
 * Additive only (the database is shared with ADS). Dry run by default:
 *   node scripts/migrate_ar_portal_approval.mjs          # plan
 *   node scripts/migrate_ar_portal_approval.mjs --apply  # apply
 */
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf-8"));

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
const hasColumn = async (t, c) =>
  (await q("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", [t, c])).length > 0;

console.log(APPLY ? "APPLYING" : "dry run (add --apply)");
for (const [col, ddl] of [
  ["approval_mode", "ALTER TABLE ar_documents ADD COLUMN approval_mode VARCHAR(10) NULL DEFAULT NULL COMMENT 'sap = SAP approval request; portal = portal-run AR template approval' AFTER template_name"],
  ["portal_approval", "ALTER TABLE ar_documents ADD COLUMN portal_approval JSON NULL COMMENT 'portal-run approval: templates/stages snapshot + decisions' AFTER approval_mode"],
]) {
  if (await hasColumn("ar_documents", col)) { console.log(`ar_documents.${col} exists`); continue; }
  console.log(ddl);
  if (APPLY) await q(ddl);
}
await db.end();
