/**
 * One-time migration: adds sap_so_number column and 'delivered' ENUM value
 * to the orders table. Safe to re-run — each ALTER is guarded.
 *
 * Run:  node scripts/migrate_sap_so_number.mjs
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
  const match = envContent.match(new RegExp(String.raw`${envVarName}=["']?([^"'\r\n]+)["']?`));
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
  const dbPassword = resolveEnvSecret('MYSQL_DB_PASS');
  const conn = await mysql.createConnection({
    host: mysqlCfg.dbIp, port: mysqlCfg.dbPort, database: mysqlCfg.dbName,
    user: mysqlCfg.dpUser, password: dbPassword,
  });

  try {
    // 1. Add sap_so_number column (idempotent — catches ER_DUP_FIELDNAME)
    try {
      await conn.execute('ALTER TABLE orders ADD COLUMN sap_so_number VARCHAR(50) NULL AFTER sap_doc_num');
      console.log('[migrate] Added sap_so_number column to orders');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('[migrate] sap_so_number already exists — skipping');
      } else {
        throw e;
      }
    }

    // 2. Add delivered to status ENUM (MODIFY is idempotent for ENUM changes)
    await conn.execute(
      "ALTER TABLE orders MODIFY COLUMN status ENUM('draft','submitted','processing','sap_draft_created','approved','delivered','rejected','completed','cancelled') DEFAULT 'draft'"
    );
    console.log('[migrate] Added delivered to orders.status ENUM');

    console.log('[migrate] Done.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});