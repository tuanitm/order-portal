/**
 * Adds audit_logs.actor_role (super_admin / admin / sales / customer) so the
 * Audit Logs page can tell Root / Admin / Sales / Customer apart, and fills it
 * for this company's existing rows from the actor's current role.
 * Additive only — other companies sharing this database are untouched.
 *
 *   node scripts/migrate_audit_actor_role.mjs            (dry run)
 *   node scripts/migrate_audit_actor_role.mjs --apply
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
const run = async (label, sql, params = []) => { log(label); if (APPLY) await db.query(sql, params); };
const cols = async (t) => new Set((await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [t])).map((r) => r.c));
const hasIndex = async (t, name) => (await q("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", [t, name])).length > 0;

console.log(`Company ${COMPANY} — ${APPLY ? "APPLYING" : "dry run (add --apply to apply)"}\n`);


const auditCols = await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs'");
if (!auditCols.some((r) => r.c === "actor_role")) {
  await run("audit_logs: add actor_role", "ALTER TABLE audit_logs ADD COLUMN actor_role VARCHAR(20) NULL AFTER actor_type");
}
if (!APPLY && !auditCols.some((r) => r.c === "actor_role")) { await db.end(); process.exit(0); }

const [{ n }] = await q(
  `SELECT COUNT(*) n FROM audit_logs a JOIN users u ON u.id = a.actor_id AND u.company_id = a.company_id
     LEFT JOIN admin_roles r ON r.id = u.role_id
    WHERE a.company_id = ? AND a.actor_role IS NULL AND a.actor_id IS NOT NULL`, [COMPANY]);
await run(`audit_logs: fill actor_role on ${n} rows`,
  `UPDATE audit_logs a JOIN users u ON u.id = a.actor_id AND u.company_id = a.company_id
     LEFT JOIN admin_roles r ON r.id = u.role_id
      SET a.actor_role = COALESCE(r.kind, 'customer')
    WHERE a.company_id = ? AND a.actor_role IS NULL AND a.actor_id IS NOT NULL`, [COMPANY]);
await db.end();
console.log("done");
