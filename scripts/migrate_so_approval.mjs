/**
 * Accountant (AR / Credit Control) Sales Order approval.
 *
 *   node scripts/migrate_so_approval.mjs           dry run
 *   node scripts/migrate_so_approval.mjs --apply   apply (idempotent)
 *
 * Additive only — safe on the DB shared with Order-Portal2 (ADS):
 *  - admin_roles.kind + 'account' (Accountant role kind -> /account area).
 *  - admin_users.sap_user_code: the SAP B1 user an Accountant approves as
 *    (the password is typed at approval time, never stored).
 *  - sync_schedule_settings.so_approval_required (default OFF): when ON, a
 *    Sales Order pushed from the portal stays U_DataStatus = 'I' until an
 *    Accountant approves it (then 'C').
 *  - orders.ar_status / ar_decided_at / ar_decided_by (admin_users.id).
 *  - so_approvals: one row per decision, with the six check results and notes.
 *  - an "Accountant" role (kind account, permission so-approval, channels =
 *    config.json masterdata.customerGroup) for THIS company if none exists.
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

const kindType = (await q("SELECT COLUMN_TYPE t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'admin_roles' AND column_name = 'kind'"))[0]?.t ?? "";
if (!kindType.includes("'account'")) {
  await run("admin_roles.kind + 'account'", "ALTER TABLE admin_roles MODIFY kind ENUM('super_admin','admin','sales','customer','account') NOT NULL");
}

if (!(await cols("admin_users")).has("sap_user_code")) {
  await run("admin_users + sap_user_code", "ALTER TABLE admin_users ADD COLUMN sap_user_code VARCHAR(50) NULL AFTER owner_code");
}

if (!(await cols("sync_schedule_settings")).has("so_approval_required")) {
  await run("sync_schedule_settings + so_approval_required (default OFF)", "ALTER TABLE sync_schedule_settings ADD COLUMN so_approval_required BOOLEAN NOT NULL DEFAULT FALSE");
}

const oc = await cols("orders");
if (!oc.has("ar_status")) await run("orders + ar_status", "ALTER TABLE orders ADD COLUMN ar_status ENUM('pending','approved','rejected') NULL");
if (!oc.has("ar_decided_at")) await run("orders + ar_decided_at", "ALTER TABLE orders ADD COLUMN ar_decided_at TIMESTAMP NULL");
if (!oc.has("ar_decided_by")) await run("orders + ar_decided_by", "ALTER TABLE orders ADD COLUMN ar_decided_by INT NULL");
if (!(await hasIndex("orders", "idx_company_ar_status"))) await run("orders INDEX (company_id, ar_status)", "ALTER TABLE orders ADD INDEX idx_company_ar_status (company_id, ar_status)");

if (!(await hasTable("so_approvals"))) {
  await run("CREATE TABLE so_approvals", `CREATE TABLE so_approvals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id VARCHAR(50) NOT NULL,
    order_id INT NOT NULL,
    sap_doc_entry INT NULL,
    decision ENUM('approved','rejected') NOT NULL,
    admin_user_id INT NOT NULL,
    admin_label VARCHAR(255) NULL,
    sap_user_code VARCHAR(50) NULL,
    checks JSON NULL,
    step_notes JSON NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_company_order (company_id, order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

const existing = APPLY || kindType.includes("'account'")
  ? await q("SELECT id, name FROM admin_roles WHERE company_id = ? AND kind = 'account'", [COMPANY])
  : [];
if (existing.length === 0) {
  const channels = (config.masterdata?.customerGroup || "").split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
  await run(`create role "Accountant" (channels ${JSON.stringify(channels)})`,
    `INSERT INTO admin_roles (company_id, name, kind, description, permissions, brands, channels, customer_groups, item_groups, warehouses)
     VALUES (?, 'Accountant', 'account', 'AR / Credit Control — approves Sales Orders', ?, '[]', ?, '[]', '[]', '[]')`,
    [COMPANY, JSON.stringify(["so-approval"]), JSON.stringify(channels)]);
} else {
  console.log("Accountant role(s) already exist:", existing.map((r) => `#${r.id} ${r.name}`).join(", "));
}

await db.end();
console.log(APPLY ? "\nDone." : "\nDry run only — nothing changed.");
