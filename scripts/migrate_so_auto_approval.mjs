/**
 * Auto SO Approval (per Accountant, on time windows) + Undo approval.
 *
 *   node scripts/migrate_so_auto_approval.mjs           dry run
 *   node scripts/migrate_so_auto_approval.mjs --apply   apply (idempotent)
 *
 * Additive only — safe on the DB shared with Order-Portal2 (ADS):
 *  - so_approvals + method ('manual' | 'bulk' | 'auto' | 'sap' = decided in
 *    the SAP client, recorded when undone), wdd_code (SAP request OWDD),
 *    undone_at / undone_by / undone_by_label / undo_reason.
 *  - so_auto_approval_settings: one row per Accountant (enabled + windows).
 *  - so_auto_approval_runs: one row per run (schedule / manual).
 *  - so_auto_approval_log: per run, per SO — approved / skipped / failed, the
 *    six checks' results and why. A repeated identical "skipped" is not
 *    re-inserted: its last_checked_at / check_count are bumped.
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

console.log(`Company ${COMPANY} — ${APPLY ? "APPLYING" : "dry run (add --apply)"}\n`);

const sa = await cols("so_approvals");
const add = [
  ["method", "ADD COLUMN method VARCHAR(10) NOT NULL DEFAULT 'manual' AFTER decision"],
  ["wdd_code", "ADD COLUMN wdd_code INT NULL AFTER wst_code"],
  ["undone_at", "ADD COLUMN undone_at DATETIME NULL"],
  ["undone_by", "ADD COLUMN undone_by INT NULL"],
  ["undone_by_label", "ADD COLUMN undone_by_label VARCHAR(255) NULL"],
  ["undo_reason", "ADD COLUMN undo_reason VARCHAR(1000) NULL"],
].filter(([c]) => !sa.has(c));
if (add.length) await run(`so_approvals + ${add.map(([c]) => c).join(", ")}`, `ALTER TABLE so_approvals ${add.map(([, d]) => d).join(", ")}`);

if (!(await hasTable("so_auto_approval_settings"))) {
  await run("CREATE so_auto_approval_settings", `CREATE TABLE so_auto_approval_settings (
    company_id VARCHAR(50) NOT NULL,
    admin_user_id INT NOT NULL,
    is_enabled TINYINT(1) NOT NULL DEFAULT 0,
    windows JSON NULL,
    last_run_at DATETIME NULL,
    last_run_status VARCHAR(20) NULL,
    last_run_summary TEXT NULL,
    updated_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id, admin_user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
if (!(await hasTable("so_auto_approval_runs"))) {
  await run("CREATE so_auto_approval_runs", `CREATE TABLE so_auto_approval_runs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id VARCHAR(50) NOT NULL,
    admin_user_id INT NOT NULL,
    trigger_type VARCHAR(10) NOT NULL,
    triggered_by INT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    checked_count INT NOT NULL DEFAULT 0,
    approved_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    summary TEXT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME NULL,
    INDEX idx_company_user (company_id, admin_user_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
if (!(await hasTable("so_auto_approval_log"))) {
  await run("CREATE so_auto_approval_log", `CREATE TABLE so_auto_approval_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id VARCHAR(50) NOT NULL,
    admin_user_id INT NOT NULL,
    run_id INT NOT NULL,
    sap_doc_entry INT NOT NULL,
    doc_no VARCHAR(50) NULL,
    card_code VARCHAR(50) NULL,
    card_name VARCHAR(255) NULL,
    outcome VARCHAR(20) NOT NULL,
    reason TEXT NULL,
    checks JSON NULL,
    approval_outcome VARCHAR(20) NULL,
    check_count INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_company_user (company_id, admin_user_id, id),
    INDEX idx_company_doc (company_id, sap_doc_entry, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
console.log("\ndone");
await db.end();
