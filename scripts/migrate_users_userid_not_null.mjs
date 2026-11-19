/**
 * users.userid: NOT NULL, unique per company (uk_company_userid on
 * (company_id, userid) — created by migrate_unified_users.mjs; re-created
 * here if missing).
 *
 * NOT additive: the DB is shared with Order-Portal2 (ADS). Any app that
 * inserts into `users` WITHOUT a userid fails afterwards with
 * "Field 'userid' doesn't have a default value" (strict mode) — so every
 * such insert (e.g. Order-Portal2's signup) must set userid BEFORE this runs.
 *
 * Refuses to run while any row has a NULL / blank userid, and lists them.
 *
 * Run:  node scripts/migrate_users_userid_not_null.mjs   (idempotent)
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function resolveEnvSecret(envVarName) {
  const envContent = readFileSync(join(rootDir, '.env'), 'utf-8');
  const match = envContent.match(new RegExp(`${envVarName}=["']?([^"'\\r\\n]+)["']?`));
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
  const mysqlCfg = config.mysql;
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || mysqlCfg.dbIp,
    port: Number(process.env.MYSQL_PORT) || mysqlCfg.dbPort,
    database: mysqlCfg.dbName,
    user: mysqlCfg.dpUser,
    password: resolveEnvSecret('MYSQL_DB_PASS'),
  });

  try {
    const [missing] = await conn.query(
      `SELECT id, company_id, email, sap_card_code FROM users WHERE userid IS NULL OR TRIM(userid) = ''`
    );
    if (missing.length > 0) {
      console.error(`[migrate] ${missing.length} user(s) have no userid — set one first, nothing changed:`);
      console.table(missing);
      process.exitCode = 1;
      return;
    }

    const [[col]] = await conn.query(
      `SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'userid'`
    );
    if (col.nullable === 'YES') {
      await conn.query(`ALTER TABLE users MODIFY userid VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL`);
      console.log('[migrate] users.userid is now NOT NULL');
    } else {
      console.log('[migrate] users.userid already NOT NULL — skipping');
    }

    const [idx] = await conn.query(`SHOW INDEX FROM users WHERE Key_name = 'uk_company_userid'`);
    if (idx.length === 0) {
      await conn.query(`ALTER TABLE users ADD UNIQUE KEY uk_company_userid (company_id, userid)`);
      console.log('[migrate] Added UNIQUE (company_id, userid)');
    } else {
      console.log('[migrate] UNIQUE (company_id, userid) already exists — skipping');
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('[migrate] Failed:', e);
  process.exit(1);
});
