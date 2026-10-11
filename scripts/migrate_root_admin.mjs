/**
 * One-time (idempotent) migration: provisions the config.json bootstrap
 * admin credential as a real `admin_users` row with is_root=TRUE, so root
 * shows up in Admin Users like any other account instead of being a
 * special-cased config.json comparison at login. Safe to re-run — it
 * upserts by email, resetting the stored hash to match config.json/.env's
 * current password and re-asserting is_root=TRUE/role_id=NULL/is_active=TRUE
 * each time.
 *
 * Does NOT change config.json/.env, which scripts/daily-sync.mjs still reads
 * to log in as admin — that keeps working unchanged, since login now checks
 * the DB row (which this script keeps in sync with the same credential)
 * instead of comparing against config.json directly.
 *
 * Run manually:  node scripts/migrate_root_admin.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function resolveEnvSecret(envVarName) {
  const envContent = readFileSync(join(rootDir, '.env'), 'utf-8');
  const match = envContent.match(new RegExp(`${envVarName}=["']?([^"'\r\n]+)["']?`));
  const rawValue = match ? match[1] : '';
  const token = rawValue.replace(/^FERNET:/, '');
  if (!token.startsWith('gAAAAA')) return rawValue;
  const keyPath = join(rootDir, 'scripts', '.encryption_key');
  return execSync(
    `python -c "from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${token}').decode(), end='')"`,
    { encoding: 'utf-8', timeout: 10000 }
  ).trim();
}

async function main() {
  const config = JSON.parse(readFileSync(join(rootDir, 'config.json'), 'utf-8'));
  const adminConfig = config.admin;
  const email = (adminConfig.email.startsWith('ENV:')
    ? resolveEnvSecret(adminConfig.email.replace('ENV:', ''))
    : adminConfig.email
  ).trim().toLowerCase();
  const password = adminConfig.password.startsWith('ENV:')
    ? resolveEnvSecret(adminConfig.password.replace('ENV:', ''))
    : adminConfig.password;

  const mysqlCfg = config.mysql;
  const dbPassword = resolveEnvSecret('MYSQL_DB_PASS');
  const conn = await mysql.createConnection({
    host: mysqlCfg.dbIp, port: mysqlCfg.dbPort, database: mysqlCfg.dbName,
    user: mysqlCfg.dpUser, password: dbPassword,
  });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [existing] = await conn.query(`SELECT id, is_root FROM admin_users WHERE email = ?`, [email]);

    if (existing.length > 0) {
      await conn.query(
        `UPDATE admin_users SET password_hash = ?, full_name = COALESCE(NULLIF(full_name, ''), 'Root'),
                role_id = NULL, is_root = TRUE, is_active = TRUE WHERE id = ?`,
        [passwordHash, existing[0].id]
      );
      console.log(`[migrate_root_admin] Updated existing admin_users row (id=${existing[0].id}) for ${email} -> is_root=TRUE`);
    } else {
      const [result] = await conn.query(
        `INSERT INTO admin_users (email, password_hash, full_name, role_id, is_root, is_active)
         VALUES (?, ?, 'Root', NULL, TRUE, TRUE)`,
        [email, passwordHash]
      );
      console.log(`[migrate_root_admin] Created admin_users row (id=${result.insertId}) for ${email} -> is_root=TRUE`);
    }

    const [roots] = await conn.query(`SELECT id, email FROM admin_users WHERE is_root = TRUE`);
    console.log(`[migrate_root_admin] Root account(s) now in admin_users:`, roots);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate_root_admin] Failed:', err);
  process.exit(1);
});
