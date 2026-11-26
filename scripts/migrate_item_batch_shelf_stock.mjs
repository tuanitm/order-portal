/**
 * Creates item_batch_shelf_stock: on-hand qty per item × warehouse × batch
 * shelf-life %, so the storefront / Admin Create & Edit order count only the
 * batches that meet the customer's required shelf life (customer_require_shelflife),
 * the same rule as the Admin order review (lib/orderStock.ts).
 *
 * Additive only (a new table) — safe on the DB shared with ADS.
 * No auto-increment id (rows are replaced on every stock sync): the key is
 * company + item + warehouse + seq.
 *
 * Run:  node scripts/migrate_item_batch_shelf_stock.mjs   (idempotent)
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

const mysqlCfg = JSON.parse(readFileSync(join(rootDir, 'config.json'), 'utf-8')).mysql;
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST || mysqlCfg.dbIp,
  port: Number(process.env.MYSQL_PORT) || mysqlCfg.dbPort,
  database: mysqlCfg.dbName,
  user: mysqlCfg.dpUser,
  password: resolveEnvSecret('MYSQL_DB_PASS'),
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS item_batch_shelf_stock (
    company_id     VARCHAR(50)   NOT NULL,
    sap_item_code  VARCHAR(50)   NOT NULL,
    warehouse_code VARCHAR(20)   NOT NULL,
    seq            SMALLINT      NOT NULL COMMENT 'row number within item x warehouse',
    shelf_life_pct DECIMAL(6,2)  NULL COMMENT 'remaining shelf life %; NULL = batch has no Mfg/Exp date',
    qty            DECIMAL(19,6) NOT NULL COMMENT 'on-hand qty of the batches with this shelf life %',
    refreshed_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id, sap_item_code, warehouse_code, seq),
    KEY idx_whs (company_id, warehouse_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
console.log('item_batch_shelf_stock ready');
await conn.end();
