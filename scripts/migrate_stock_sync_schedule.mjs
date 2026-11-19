/**
 * Adds the separate Inventory Stock sync schedule columns to
 * sync_schedule_settings (see schema.sql / src/lib/sap-b1/stockSyncSchedule.ts).
 *
 * Additive only (new columns with defaults) — safe on the DB shared with
 * Order-Portal2 (ADS): its rows just get the defaults (disabled).
 *
 * Also turns the stock schedule ON for THIS portal's own
 * company (config.json admin.entityID) — only when the columns were newly
 * added, so re-running never overrides what root later set on the page.
 *
 * Run:  node scripts/migrate_stock_sync_schedule.mjs   (idempotent)
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

const COLUMNS = [
  ['stock_sync_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
  ['stock_sync_interval_minutes', 'INT NOT NULL DEFAULT 10'],
  ['stock_last_run_at', 'TIMESTAMP NULL'],
  ['stock_last_run_status', "ENUM('success', 'failed') NULL"],
  ['stock_last_run_summary', 'TEXT NULL'],
  // Time windows (Vietnam time), each with its own interval — see src/lib/stockSyncWindows.ts.
  ['stock_sync_windows', 'JSON NULL'],
  // Option 1 "sync" (scheduled) or option 2 "live" (on demand from SAP) — see src/lib/stock/liveStock.ts.
  ['stock_source', "ENUM('sync', 'live') NOT NULL DEFAULT 'sync'"],
  ['stock_live_cache_seconds', 'INT NOT NULL DEFAULT 30'],
  ['stock_live_refreshed_at', 'TIMESTAMP NULL'],
  ['stock_live_shelf_refreshed_at', 'TIMESTAMP NULL'],
  ['stock_live_last_status', "ENUM('success', 'failed') NULL"],
  ['stock_live_last_summary', 'TEXT NULL'],
];

// Live stock (option 2). Composite primary key, NO auto-increment id: it is
// refreshed every ~30 s while customers browse, which would burn millions of
// ids a day. Same stock columns as item_warehouse_stock, so the storefront's
// queries work on either table.
const CREATE_LIVE_TABLE = `CREATE TABLE IF NOT EXISTS item_warehouse_stock_live (
  company_id VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  warehouse_code VARCHAR(20) NOT NULL,
  in_stock DECIMAL(18,3) NOT NULL DEFAULT 0,
  committed DECIMAL(18,3) NOT NULL DEFAULT 0,
  shelf_life_pct DECIMAL(6,2) NULL,
  refreshed_at TIMESTAMP NULL,
  PRIMARY KEY (company_id, sap_item_code, warehouse_code),
  INDEX idx_live_item_code (sap_item_code),
  INDEX idx_live_warehouse_code (warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// Seeded for this portal's company when it has no windows yet (outside every window = no run).
const DEFAULT_WINDOWS = [
  { start: '08:00', end: '17:00', intervalMinutes: 10 },
  { start: '17:00', end: '22:00', intervalMinutes: 30 },
];

async function main() {
  const config = JSON.parse(readFileSync(join(rootDir, 'config.json'), 'utf-8'));
  const mysqlCfg = config.mysql;
  const companyId = config.admin.entityID;
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || mysqlCfg.dbIp,
    port: Number(process.env.MYSQL_PORT) || mysqlCfg.dbPort,
    database: mysqlCfg.dbName,
    user: mysqlCfg.dpUser,
    password: resolveEnvSecret('MYSQL_DB_PASS'),
  });

  try {
    let addedEnabledColumn = false;
    for (const [name, def] of COLUMNS) {
      try {
        await conn.execute(`ALTER TABLE sync_schedule_settings ADD COLUMN ${name} ${def}`);
        console.log(`[migrate] Added sync_schedule_settings.${name}`);
        if (name === 'stock_sync_enabled') addedEnabledColumn = true;
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') console.log(`[migrate] ${name} already exists — skipping`);
        else throw e;
      }
    }

    if (addedEnabledColumn) {
      await conn.execute(
        `INSERT INTO sync_schedule_settings (company_id, stock_sync_enabled, stock_sync_interval_minutes)
         VALUES (?, TRUE, 10)
         ON DUPLICATE KEY UPDATE stock_sync_enabled = TRUE, stock_sync_interval_minutes = 10`,
        [companyId]
      );
      console.log(`[migrate] Enabled stock sync every 10 minutes for ${companyId}`);
    }

    const [seeded] = await conn.execute(
      `UPDATE sync_schedule_settings SET stock_sync_windows = ? WHERE company_id = ? AND stock_sync_windows IS NULL`,
      [JSON.stringify(DEFAULT_WINDOWS), companyId]
    );
    if (seeded.affectedRows) {
      console.log(`[migrate] Set ${companyId} stock sync windows: 08:00-17:00 every 10 min, 17:00-22:00 every 30 min`);
    }

    await conn.execute(CREATE_LIVE_TABLE);
    console.log('[migrate] item_warehouse_stock_live table ready');

    console.log('[migrate] Done.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
