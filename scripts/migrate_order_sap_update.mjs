/**
 * Order edit + "Update SAP" (PATCH the SAP Sales Order / Draft after a staff edit).
 *
 *   node scripts/migrate_order_sap_update.mjs           dry run
 *   node scripts/migrate_order_sap_update.mjs --apply   apply (idempotent)
 *
 * Additive only — safe on the DB shared with Order-Portal2 (ADS):
 *  - orders.sap_outdated_at: set when an order already in SAP is edited in the
 *    portal; cleared by a successful "Update SAP" (NULL = SAP matches the portal).
 *  - orders.sap_updated_at / sap_updated_by_admin_id: the last "Update SAP".
 *  - orders.edited_at / edited_by_admin_id: the last staff edit (Edit order).
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
const log = (...a) => console.log(APPLY ? "[apply]" : "[plan] ", ...a);
const run = async (label, sql) => { log(label); if (APPLY) await db.query(sql); };
const cols = new Set((await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders'")).map((r) => r.c));

console.log(APPLY ? "APPLYING\n" : "dry run (add --apply)\n");
const add = [
  ["sap_outdated_at", "DATETIME NULL"],
  ["sap_updated_at", "DATETIME NULL"],
  ["sap_updated_by_admin_id", "INT NULL"],
  ["edited_at", "DATETIME NULL"],
  ["edited_by_admin_id", "INT NULL"],
];
let n = 0;
for (const [c, def] of add) {
  if (cols.has(c)) continue;
  n++;
  await run(`ALTER orders ADD ${c}`, `ALTER TABLE orders ADD COLUMN ${c} ${def}`);
}
if (!n) console.log("Nothing to do — all columns exist.");
await db.end();
