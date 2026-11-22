/**
 * Staff notifications (SO Approval inbox): who must approve, and the outcome
 * for whoever created / pushed the SO.
 *
 *   node scripts/migrate_staff_notifications.mjs           dry run
 *   node scripts/migrate_staff_notifications.mjs --apply   apply (idempotent)
 *
 * Additive only — safe on the DB shared with Order-Portal2 (ADS):
 *  - staff_notifications: one row per recipient (admin_users.id); read_at
 *    NULL = new (bell count, flashing NEW marker in SO Approval / Orders).
 *  - orders.sap_pushed_by_admin_id: who pushed the order to SAP.
 *  - sync_schedule_settings.notif_last_wdd_code: the last SAP approval
 *    request (OWDD.WddCode) the SAP-request poller has notified about.
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
if (!(await hasTable("staff_notifications"))) {
  await run("CREATE staff_notifications", `CREATE TABLE staff_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id VARCHAR(50) NOT NULL,
    admin_user_id INT NOT NULL,
    kind VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NULL,
    url VARCHAR(500) NULL,
    sap_doc_entry INT NULL,
    order_id INT NULL,
    actor_label VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME NULL,
    INDEX idx_recipient (company_id, admin_user_id, read_at, id),
    INDEX idx_recipient_doc (company_id, admin_user_id, sap_doc_entry),
    INDEX idx_recipient_order (company_id, admin_user_id, order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
if (!(await cols("staff_notifications")).has("processed_at")) {
  // "SO waits for your approval" stays counted on the bell until the SO no longer waits for that user.
  await run("staff_notifications + processed_at", "ALTER TABLE staff_notifications ADD COLUMN processed_at DATETIME NULL AFTER read_at");
}
if (!(await cols("orders")).has("sap_pushed_by_admin_id")) {
  await run("orders + sap_pushed_by_admin_id", "ALTER TABLE orders ADD COLUMN sap_pushed_by_admin_id INT NULL");
}
if (!(await cols("sync_schedule_settings")).has("notif_last_wdd_code")) {
  await run("sync_schedule_settings + notif_last_wdd_code", "ALTER TABLE sync_schedule_settings ADD COLUMN notif_last_wdd_code INT NULL");
}
console.log("\ndone");
await db.end();
