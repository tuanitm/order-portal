/**
 * Adds promotion_discount.priority (INT NULL) — the portal-set priority of a
 * promotion program when one selling item has more than one program: 1, 2, 3…,
 * the smaller number wins; NULL = no priority (after every numbered one).
 * Set per program (every row of a promotion_code carries the same value) on
 * Admin → Promotion Program; the HANA sync carries it over to the fresh rows.
 *
 * Additive only (the database is shared with ADS). Dry run by default:
 *   node scripts/migrate_promotion_priority.mjs          # plan
 *   node scripts/migrate_promotion_priority.mjs --apply  # apply
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
if (await hasColumn("promotion_discount", "priority")) {
  console.log("promotion_discount.priority exists");
} else {
  const sql = "ALTER TABLE promotion_discount ADD COLUMN priority INT NULL DEFAULT NULL COMMENT 'portal priority per promotion program: 1 = first; NULL = none' AFTER giving_qty";
  console.log(sql);
  if (APPLY) await q(sql);
}
await db.end();
