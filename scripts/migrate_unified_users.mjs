/**
 * One-off migration: one `users` table for everyone + data permissions on roles.
 *
 *   node scripts/migrate_unified_users.mjs            (dry run — prints the plan)
 *   node scripts/migrate_unified_users.mjs --apply    (applies it)
 *
 * Safe to re-run. Only ADDS columns, never drops or renames anything, and only
 * moves rows of THIS app's company (config.json admin.entityID) — another app
 * sharing the database (Order-Portal2 / company ADS) keeps using admin_users /
 * admin_users_* and is not touched.
 *
 *  1. admin_roles + kind (super_admin | admin | sales | customer) and the role's
 *     data permissions: brands, channels, customer_groups, item_groups, warehouses (JSON code lists).
 *  2. users + userid (unique per company), role_id, must_change_password,
 *     department_code, owner_code, legacy_admin_user_id.
 *  3. This company's admin_users rows are copied into users (userid = email's
 *     local part). Roots get the Super Admin role.
 *  4. Per-admin scopes (admin_user_customer_groups / _item_groups / _warehouses)
 *     move onto roles; admins that shared a role but had different scopes get a
 *     role each. Brands = every brand of the company, Channels = the level-1
 *     customer groups above their customer groups — what they could see before.
 *  5. Customers get the Customer role; Sales and Customer roles are created if missing.
 *  6. orders.created_by_admin_id and audit_logs (admin actors) are re-pointed to the new user ids.
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

// ── 1. schema: roles ──
const rc = await cols("admin_roles");
const roleAdds = [
  ["kind", "ENUM('super_admin','admin','sales','customer') NOT NULL DEFAULT 'admin' AFTER name"],
  ["brands", "JSON NULL"], ["channels", "JSON NULL"], ["customer_groups", "JSON NULL"], ["item_groups", "JSON NULL"], ["warehouses", "JSON NULL"],
].filter(([c]) => !rc.has(c));
if (roleAdds.length) await run(`admin_roles: add ${roleAdds.map(([c]) => c)}`, `ALTER TABLE admin_roles ${roleAdds.map(([c, d]) => `ADD COLUMN ${c} ${d}`).join(", ")}`);

// ── 2. schema: users ──
const uc = await cols("users");
const userAdds = [
  ["userid", "VARCHAR(100) NULL AFTER company_id"], ["role_id", "INT NULL AFTER userid"],
  ["must_change_password", "BOOLEAN NOT NULL DEFAULT FALSE"], ["department_code", "VARCHAR(20) NULL"],
  ["owner_code", "VARCHAR(50) NULL"], ["legacy_admin_user_id", "INT NULL"],
].filter(([c]) => !uc.has(c));
if (userAdds.length) await run(`users: add ${userAdds.map(([c]) => c)}`, `ALTER TABLE users ${userAdds.map(([c, d]) => `ADD COLUMN ${c} ${d}`).join(", ")}`);
if (!(await hasIndex("users", "uk_company_userid"))) await run("users: unique (company_id, userid)", "ALTER TABLE users ADD UNIQUE KEY uk_company_userid (company_id, userid)");
if (!(await hasIndex("users", "idx_role"))) await run("users: index role_id", "ALTER TABLE users ADD INDEX idx_role (role_id)");

if (!APPLY && (roleAdds.length || userAdds.length)) {
  console.log("\n(The data steps below need the new columns — run with --apply to see and do them.)");
  await db.end();
  process.exit(0);
}

await db.beginTransaction();
try {
  // ── 3. role kinds ──
  const roles = await q("SELECT id, name, kind, permissions FROM admin_roles WHERE company_id = ?", [COMPANY]);
  for (const r of roles) {
    const kind = /^\s*super\s*admin/i.test(r.name) ? "super_admin" : /^\s*sales/i.test(r.name) ? "sales" : /^\s*customer/i.test(r.name) ? "customer" : "admin";
    if (r.kind !== kind) await run(`role "${r.name}" → ${kind}`, "UPDATE admin_roles SET kind = ? WHERE id = ?", [kind, r.id]);
  }
  const ensureRole = async (name, kind, permissions) => {
    const existing = await q("SELECT id FROM admin_roles WHERE company_id = ? AND kind = ? ORDER BY id LIMIT 1", [COMPANY, kind]);
    if (existing.length) return existing[0].id;
    log(`create role "${name}" (${kind})`);
    const res = (await db.query("INSERT INTO admin_roles (company_id, name, kind, description, permissions) VALUES (?, ?, ?, ?, ?)",
      [COMPANY, name, kind, null, JSON.stringify(permissions)]))[0];
    return res.insertId;
  };
  const superRoleId = await ensureRole("Super Admin", "super_admin", []);
  const customerRoleId = await ensureRole("Customer", "customer", []);
  await ensureRole("Sales", "sales", ["orders", "inventory"]);

  // ── 4. staff → users, with their scopes moved onto roles ──
  const allBrands = (await q("SELECT DISTINCT brand_code FROM items WHERE company_id = ? AND brand_code IS NOT NULL AND brand_code <> '' ORDER BY brand_code", [COMPANY])).map((r) => r.brand_code);
  const groups = await q("SELECT id, level, code, parent_code FROM customer_groups WHERE company_id = ?", [COMPANY]);
  const channelOf = (code) => {
    let g = groups.find((x) => x.code === code);
    while (g && g.level > 1) g = groups.find((x) => x.level === g.level - 1 && x.code === g.parent_code);
    return g?.code ?? null;
  };
  const admins = await q(`SELECT au.*, ar.kind AS role_kind, ar.name AS role_name FROM admin_users au LEFT JOIN admin_roles ar ON ar.id = au.role_id
                           WHERE au.company_id = ? ORDER BY au.id`, [COMPANY]);
  const roleBySignature = new Map();
  const usedUserids = new Set((await q("SELECT LOWER(userid) u FROM users WHERE company_id = ? AND userid IS NOT NULL", [COMPANY])).map((r) => r.u));
  const idMap = new Map(); // admin_users.id → users.id, for admins copied in THIS run only

  for (const a of admins) {
    const already = await q("SELECT id FROM users WHERE company_id = ? AND (legacy_admin_user_id = ? OR LOWER(email) = LOWER(?))", [COMPANY, a.id, a.email]);
    let roleId = a.is_root ? superRoleId : a.role_id;

    if (!a.is_root && a.role_id) {
      const cgs = (await q("SELECT cg.code FROM admin_user_customer_groups x JOIN customer_groups cg ON cg.id = x.customer_group_id WHERE x.admin_user_id = ? ORDER BY cg.code", [a.id])).map((r) => r.code);
      const igs = (await q("SELECT ig.code FROM admin_user_item_groups x JOIN item_groups ig ON ig.id = x.item_group_id WHERE x.admin_user_id = ? ORDER BY ig.code", [a.id])).map((r) => r.code);
      const whs = (await q("SELECT warehouse_code FROM admin_user_warehouses WHERE admin_user_id = ? ORDER BY warehouse_code", [a.id])).map((r) => r.warehouse_code);
      const channels = [...new Set(cgs.map(channelOf).filter(Boolean))].sort();
      const scope = { brands: allBrands, channels, customer_groups: cgs, item_groups: igs, warehouses: whs };
      const signature = `${a.role_id}|${JSON.stringify(scope)}`;
      if (roleBySignature.has(signature)) {
        roleId = roleBySignature.get(signature);
      } else {
        const holders = [...roleBySignature.keys()].filter((s) => s.startsWith(`${a.role_id}|`));
        if (holders.length === 0) {
          await run(`role "${a.role_name}" ← scope of ${a.email} ${JSON.stringify(scope)}`,
            "UPDATE admin_roles SET brands = ?, channels = ?, customer_groups = ?, item_groups = ?, warehouses = ? WHERE id = ?",
            [JSON.stringify(scope.brands), JSON.stringify(scope.channels), JSON.stringify(scope.customer_groups), JSON.stringify(scope.item_groups), JSON.stringify(scope.warehouses), a.role_id]);
          roleId = a.role_id;
        } else {
          const base = (await q("SELECT name, kind, description, permissions FROM admin_roles WHERE id = ?", [a.role_id]))[0];
          let name = `${base.name} (${cgs.join(", ") || "no groups"})`.slice(0, 100);
          if ((await q("SELECT 1 FROM admin_roles WHERE company_id = ? AND name = ?", [COMPANY, name])).length) name = `${name.slice(0, 90)} #${a.id}`;
          log(`create role "${name}" for ${a.email} — same functions as "${base.name}", own scope ${JSON.stringify(scope)}`);
          roleId = (await db.query(
            "INSERT INTO admin_roles (company_id, name, kind, description, permissions, brands, channels, customer_groups, item_groups, warehouses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [COMPANY, name, base.kind, base.description, JSON.stringify(typeof base.permissions === "string" ? JSON.parse(base.permissions) : base.permissions),
             JSON.stringify(scope.brands), JSON.stringify(scope.channels), JSON.stringify(scope.customer_groups), JSON.stringify(scope.item_groups), JSON.stringify(scope.warehouses)]))[0].insertId;
        }
        roleBySignature.set(signature, roleId);
      }
    }

    if (already.length) {
      // Copied by an earlier run — its references were re-pointed then, so not again.
      log(`${a.email} already in users (#${already[0].id})`);
      continue;
    }
    let userid = (a.email.split("@")[0] || `admin${a.id}`).toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (usedUserids.has(userid)) userid = `${userid}${a.id}`;
    usedUserids.add(userid);
    log(`copy ${a.email} → users (userid "${userid}", role #${roleId}${a.is_root ? " Super Admin" : ""})`);
    const res = (await db.query(
      `INSERT INTO users (company_id, userid, role_id, email, password_hash, full_name, is_active, approval_status, approved_at,
                          department_code, owner_code, legacy_admin_user_id, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NOW(), ?, ?, ?, FALSE, ?)`,
      [COMPANY, userid, roleId, a.email.toLowerCase(), a.password_hash, a.full_name || a.email, a.is_active ? 1 : 0,
       a.department_code, a.owner_code, a.id, a.created_at]))[0];
    idMap.set(a.id, res.insertId);
  }

  // ── 5. customers → Customer role ──
  const custCount = (await q("SELECT COUNT(*) n FROM users WHERE company_id = ? AND role_id IS NULL AND legacy_admin_user_id IS NULL", [COMPANY]))[0].n;
  if (custCount) await run(`${custCount} customer(s) → Customer role`, "UPDATE users SET role_id = ? WHERE company_id = ? AND role_id IS NULL AND legacy_admin_user_id IS NULL", [customerRoleId, COMPANY]);

  // ── 6. re-point references to admin ids ──
  for (const [oldId, newId] of idMap) {
    if (oldId === newId) continue;
    const o = (await db.query("UPDATE orders SET created_by_admin_id = ? WHERE company_id = ? AND created_by_admin_id = ?", [newId, COMPANY, oldId]))[0].affectedRows;
    const l = (await db.query("UPDATE audit_logs SET actor_id = ? WHERE company_id = ? AND actor_type = 'admin' AND actor_id = ?", [newId, COMPANY, oldId]))[0].affectedRows;
    if (o || l) log(`admin #${oldId} → user #${newId}: ${o} order(s), ${l} audit row(s)`);
  }
  if (APPLY) await db.commit(); else await db.rollback();
} catch (e) {
  await db.rollback();
  throw e;
}

console.table(await q(`SELECT u.id, u.userid, u.email, r.name role, r.kind, u.sap_card_code, u.is_active FROM users u
                        LEFT JOIN admin_roles r ON r.id = u.role_id WHERE u.company_id = ? ORDER BY r.kind, u.id`, [COMPANY]));
console.table(await q("SELECT id, name, kind, brands, channels, customer_groups, item_groups, warehouses FROM admin_roles WHERE company_id = ? ORDER BY id", [COMPANY]));
await db.end();
