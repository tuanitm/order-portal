/**
 * SAP Sync split into groups (Settings → SAP Sync Schedule), each with its own
 * interval: master · price · discount · promotion · order_status. One row per
 * company × group; seeded from the old combined schedule (is_enabled,
 * interval_hours, last_run_at in sync_schedule_settings) so nothing changes
 * until Super Admin sets the new intervals.
 *
 * Additive only (the database is shared with ADS). Dry run by default:
 *   node scripts/migrate_sync_group_schedule.mjs          # plan
 *   node scripts/migrate_sync_group_schedule.mjs --apply  # apply
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
const hasTable = async (t) => (await q("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [t])).length > 0;

console.log(`${config.mysql.dbName} · company ${COMPANY} — ${APPLY ? "APPLYING" : "dry run (add --apply)"}`);
if (await hasTable("sync_group_schedule")) {
  console.log("sync_group_schedule exists");
} else {
  console.log("CREATE TABLE sync_group_schedule");
  if (APPLY) {
    await q(`CREATE TABLE sync_group_schedule (
      company_id VARCHAR(50) NOT NULL,
      group_key VARCHAR(30) NOT NULL COMMENT 'master | price | discount | promotion | order_status',
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      interval_hours INT NOT NULL DEFAULT 24,
      last_run_at DATETIME NULL,
      last_run_status VARCHAR(10) NULL COMMENT 'success | partial | failed',
      last_run_summary TEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (company_id, group_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'SAP Sync: per-group schedule (Settings → SAP Sync Schedule)'`);
  }
}
if (APPLY || (await hasTable("sync_group_schedule"))) {
  const [old] = await q(`SELECT is_enabled, interval_hours, last_run_at FROM sync_schedule_settings WHERE company_id = ?`, [COMPANY]);
  for (const key of ["master", "price", "discount", "promotion", "order_status"]) {
    const have = (await q(`SELECT 1 FROM sync_group_schedule WHERE company_id = ? AND group_key = ?`, [COMPANY, key])).length > 0;
    if (have) { console.log(`  ${key}: exists`); continue; }
    console.log(`  seed ${key}: enabled=${old?.is_enabled ?? 0}, every ${old?.interval_hours ?? 24} h (from the combined schedule)`);
    if (APPLY) {
      await q(`INSERT INTO sync_group_schedule (company_id, group_key, is_enabled, interval_hours, last_run_at) VALUES (?, ?, ?, ?, ?)`,
        [COMPANY, key, old?.is_enabled ?? 0, Math.max(1, Number(old?.interval_hours) || 24), old?.last_run_at ?? null]);
    }
  }
}
await db.end();
