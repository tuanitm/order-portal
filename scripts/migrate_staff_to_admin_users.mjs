/**
 * Staff (Super Admin / Admin / Sales) live in `admin_users`; customers in `users`.
 * Reverses the staff half of migrate_unified_users.mjs for THIS app's company
 * (config.json admin.entityID). Roles stay one list (admin_roles + kind).
 *
 *   node scripts/migrate_staff_to_admin_users.mjs                     dry run
 *   node scripts/migrate_staff_to_admin_users.mjs --apply             step 1 (safe any time)
 *   node scripts/migrate_staff_to_admin_users.mjs --apply --finalize  step 2 (at deploy)
 *
 * Step 1 — additive, old code keeps working:
 *   - admin_users + userid, phone, must_change_password; UNIQUE (company_id,
 *     userid) next to the existing UNIQUE (company_id, email). Email is
 *     compulsory for staff (NOT NULL). Staff sign in by userid or email.
 *     Order-Portal2 (ADS) rows and code are unaffected.
 *   - every staff row of users is copied into admin_users: onto the admin_users
 *     row it originally came from (users.legacy_admin_user_id — so staff get
 *     their original ids back), or as a new row. is_root = 0 with the role
 *     (this app uses the Super Admin role kind, not is_root).
 * Step 2 — run right after deploying the code that reads admin_users:
 *   - step 1 again (picks up password / profile changes made in between),
 *   - re-points staff ids from users.id to admin_users.id: orders.created_by_admin_id,
 *     audit_logs (actor_type 'admin'), order_seen, customer_requests,
 *     order_attachments (this company's rows only),
 *   - deletes the staff rows from users.
 * Idempotent.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const FINALIZE = process.argv.includes("--finalize");
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
const tag = APPLY ? "[apply]" : "[plan] ";
const log = (...a) => console.log(tag, ...a);
const run = async (label, sql, params = []) => { log(label); if (APPLY) return (await db.query(sql, params))[0]; return null; };
const cols = async (t) => new Set((await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [t])).map((r) => r.c));
const hasIndex = async (t, name) => (await q("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", [t, name])).length > 0;

console.log(`Company ${COMPANY} — ${APPLY ? (FINALIZE ? "APPLYING step 1 + 2" : "APPLYING step 1") : "dry run (add --apply)"}\n`);

// ── Step 1a: schema ──
const ac = await cols("admin_users");
if (!ac.has("userid")) await run("admin_users + userid", "ALTER TABLE admin_users ADD COLUMN userid VARCHAR(100) NULL AFTER company_id");
if (!ac.has("phone")) await run("admin_users + phone", "ALTER TABLE admin_users ADD COLUMN phone VARCHAR(20) NULL AFTER email");
if (!ac.has("must_change_password")) await run("admin_users + must_change_password", "ALTER TABLE admin_users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active");
// Staff email is compulsory: keep / make it NOT NULL (refuses while any row lacks one).
const emailCol = (await q("SELECT IS_NULLABLE n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'admin_users' AND column_name = 'email'"))[0];
if (emailCol?.n === "YES") {
  const missing = await q("SELECT id, company_id, userid FROM admin_users WHERE email IS NULL OR TRIM(email) = ''");
  if (missing.length) {
    console.error("Staff without an email — set one first:", missing);
    process.exit(1);
  }
  await run("admin_users.email NOT NULL", "ALTER TABLE admin_users MODIFY email VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL");
}
if (!(await hasIndex("admin_users", "uk_company_email"))) {
  await run("admin_users UNIQUE (company_id, email)", "ALTER TABLE admin_users ADD UNIQUE KEY uk_company_email (company_id, email)");
}
if (!(await hasIndex("admin_users", "uk_company_userid"))) {
  // Before the index: fill userid for this company's existing rows (email local part).
  await run("admin_users: userid for existing rows", "UPDATE admin_users SET userid = SUBSTRING_INDEX(email, '@', 1) WHERE company_id = ? AND userid IS NULL AND email IS NOT NULL", [COMPANY]);
  await run("admin_users UNIQUE (company_id, userid)", "ALTER TABLE admin_users ADD UNIQUE KEY uk_company_userid (company_id, userid)");
}

// ── Step 1b: copy staff ──
async function copyStaff() {
  const staff = await q(
    `SELECT u.id, u.userid, u.email, u.phone, u.password_hash, u.full_name, u.role_id, u.is_active,
            u.must_change_password, u.department_code, u.owner_code, u.created_at, u.legacy_admin_user_id
       FROM users u JOIN admin_roles r ON r.id = u.role_id
      WHERE u.company_id = ? AND r.kind <> 'customer' ORDER BY u.id`,
    [COMPANY]
  );
  const map = new Map(); // users.id -> admin_users.id
  for (const s of staff) {
    let target = null;
    if (s.legacy_admin_user_id) {
      target = (await q("SELECT id FROM admin_users WHERE company_id = ? AND id = ?", [COMPANY, s.legacy_admin_user_id]))[0]?.id ?? null;
    }
    if (!target) {
      target = (await q("SELECT id FROM admin_users WHERE company_id = ? AND (LOWER(userid) = LOWER(?) OR (email IS NOT NULL AND LOWER(email) = LOWER(?))) LIMIT 1",
        [COMPANY, s.userid ?? "", s.email ?? ""]))[0]?.id ?? null;
    }
    const values = [s.userid, s.email, s.phone, s.password_hash, s.full_name, s.role_id, s.is_active ? 1 : 0, s.must_change_password ? 1 : 0, s.department_code, s.owner_code];
    if (target) {
      await run(`users #${s.id} ${s.userid} -> admin_users #${target} (update)`,
        `UPDATE admin_users SET userid = ?, email = ?, phone = ?, password_hash = ?, full_name = ?, role_id = ?, is_root = 0,
                is_active = ?, must_change_password = ?, department_code = ?, owner_code = ? WHERE id = ?`,
        [...values, target]);
      map.set(s.id, target);
    } else {
      const r = await run(`users #${s.id} ${s.userid} -> new admin_users row`,
        `INSERT INTO admin_users (userid, email, phone, password_hash, full_name, role_id, is_active, must_change_password,
                                  department_code, owner_code, company_id, is_root, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [...values, COMPANY, s.created_at]);
      map.set(s.id, r?.insertId ?? `(new)`);
    }
  }
  return map;
}

let map = await copyStaff();
console.log(`\n${map.size} staff account(s):`, [...map].map(([u, a]) => `users#${u}→admin_users#${a}`).join(", ") || "none");

// ── Step 2 ──
if (FINALIZE) {
  console.log("\nStep 2");
  const refs = [
    ["orders", "created_by_admin_id", ""],
    ["audit_logs", "actor_id", "AND actor_type = 'admin'"],
    ["order_seen", "admin_id", ""],
    ["customer_requests", "requested_by_admin_id", ""],
    ["order_attachments", "uploaded_by_admin_id", ""],
  ];
  if (APPLY) await db.beginTransaction();
  try {
    // Two passes through negative ids so a new id can never be mistaken for an old one.
    for (const [t, c, extra] of refs) {
      for (const [uid, aid] of map) {
        if (typeof aid !== "number") continue;
        const r = await run(`${t}.${c}: ${uid} -> ${aid}`, `UPDATE ${t} SET ${c} = ? WHERE company_id = ? AND ${c} = ? ${extra}`, [-aid, COMPANY, uid]);
        if (r) log(`  ${r.affectedRows} row(s)`);
      }
      await run(`${t}.${c}: finalize`, `UPDATE ${t} SET ${c} = -${c} WHERE company_id = ? AND ${c} < 0 ${extra}`, [COMPANY]);
    }
    const ids = [...map.keys()];
    if (ids.length) {
      await run(`delete ${ids.length} staff row(s) from users`, `DELETE FROM users WHERE company_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [COMPANY, ...ids]);
    }
    if (APPLY) await db.commit();
  } catch (e) {
    if (APPLY) await db.rollback();
    throw e;
  }
}

await db.end();
console.log(APPLY ? "\nDone." : "\nDry run only — nothing changed.");
