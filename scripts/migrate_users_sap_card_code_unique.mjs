/**
 * users: one portal account per SAP customer - UNIQUE (company_id,
 * sap_card_code). The column stays NULLable: staff accounts have no SAP
 * customer, and a new-company signup gets its code only when approval
 * creates the Business Partner (MySQL allows many NULLs in a unique key).
 * Customers always have it (and userid = sap_card_code) once approved.
 *
 * Safe on the DB shared with Order-Portal2 (ADS): only adds an index; refuses
 * to run (and lists them) while duplicate codes exist.
 *
 * Run:  node scripts/migrate_users_sap_card_code_unique.mjs   (idempotent)
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
    const [idx] = await conn.query(`SHOW INDEX FROM users WHERE Key_name = 'uk_company_sap_card_code'`);
    if (idx.length > 0) {
      console.log('[migrate] UNIQUE (company_id, sap_card_code) already exists - skipping');
      return;
    }
    // Blank codes would collide with each other: store them as NULL.
    const [blank] = await conn.query(`UPDATE users SET sap_card_code = NULL WHERE TRIM(sap_card_code) = ''`);
    if (blank.affectedRows) console.log(`[migrate] ${blank.affectedRows} blank sap_card_code set to NULL`);

    const [dups] = await conn.query(
      `SELECT company_id, sap_card_code, COUNT(*) AS n, GROUP_CONCAT(id ORDER BY id) AS user_ids
         FROM users WHERE sap_card_code IS NOT NULL
        GROUP BY company_id, sap_card_code HAVING n > 1`
    );
    if (dups.length > 0) {
      console.error('[migrate] Duplicate SAP customer codes - merge or fix these accounts first, nothing changed:');
      console.table(dups);
      process.exitCode = 1;
      return;
    }
    await conn.query(`ALTER TABLE users ADD UNIQUE KEY uk_company_sap_card_code (company_id, sap_card_code)`);
    console.log('[migrate] Added UNIQUE (company_id, sap_card_code)');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('[migrate] Failed:', e);
  process.exit(1);
});
