/**
 * SO Approval lists every SAP Sales Order approval request (not only portal
 * orders), from a configurable DocDate.
 *
 *   node scripts/migrate_so_approval_sap_queue.mjs           dry run
 *   node scripts/migrate_so_approval_sap_queue.mjs --apply   apply (idempotent)
 *
 * Additive only — safe on the DB shared with Order-Portal2 (ADS):
 *  - sync_schedule_settings.so_approval_from_date: only SOs with DocDate on or
 *    after it are shown for approval (NULL = all).
 *  - so_approvals.order_id NULL-able: a decision on a Sales Order made in SAP
 *    (no portal order) is keyed by sap_doc_entry only.
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
if (!(await cols("sync_schedule_settings")).has("so_approval_from_date")) {
  await run("sync_schedule_settings + so_approval_from_date", "ALTER TABLE sync_schedule_settings ADD COLUMN so_approval_from_date DATE NULL");
}
const nullable = (await q("SELECT IS_NULLABLE n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'so_approvals' AND column_name = 'order_id'"))[0]?.n;
if (nullable === "NO") await run("so_approvals.order_id NULL-able", "ALTER TABLE so_approvals MODIFY order_id INT NULL");
if (!(await hasIndex("so_approvals", "idx_company_doc_entry"))) await run("so_approvals INDEX (company_id, sap_doc_entry)", "ALTER TABLE so_approvals ADD INDEX idx_company_doc_entry (company_id, sap_doc_entry)");
console.log("\ndone");
await db.end();
