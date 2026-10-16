/**
 * fix_period_disc_l_items.mjs
 *
 * 1. Widens order_lines period/contract/promo_disc_pct from DECIMAL(5,2) → DECIMAL(7,4)
 *    so 4-decimal values like 20.0003 can be stored and displayed.
 *
 * 2. Re-backfills period_disc_pct for every non-gift order_line whose
 *    sap_item_code starts with 'L', looking up the correct discount from
 *    period_discount at the order's own created_at date (historical rate).
 *    Unlike the original backfill_discount_pcts.mjs this script OVERWRITES
 *    any existing period_disc_pct value (not just NULL ones) so corrections
 *    in the period_discount table flow back into portal orders.
 *
 * Run: node scripts/fix_period_disc_l_items.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// ── Exact copy of the config helpers from backfill_discount_pcts.mjs ─────────
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

function getDbConfig() {
  const config = JSON.parse(readFileSync(join(rootDir, 'config.json'), 'utf-8'));
  const mysqlCfg = config.mysql;
  const dbPassword = resolveEnvSecret('MYSQL_DB_PASS');
  return {
    host: process.env.MYSQL_HOST || mysqlCfg.dbIp || 'localhost',
    port: Number(process.env.MYSQL_PORT) || mysqlCfg.dbPort || 3306,
    database: mysqlCfg.dbName || 'orderdatasource',
    user: mysqlCfg.dpUser || 'orderdata',
    password: dbPassword,
    timezone: '+07:00',
  };
}

// ── Step 1: widen DECIMAL columns ────────────────────────────────────────────
async function widenColumns(conn) {
  console.log('\n[fix] Step 1 — Widening discount % columns to DECIMAL(7,4)...');
  const dbCfg = getDbConfig();
  const [cols] = await conn.execute(
    `SELECT COLUMN_NAME, COLUMN_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'order_lines'
       AND COLUMN_NAME IN ('period_disc_pct','contract_disc_pct','promo_disc_pct')`,
    [dbCfg.database]
  );

  const needsWiden = cols.filter(c => {
    const t = c.COLUMN_TYPE.toLowerCase();
    return !(t === 'decimal(7,4)' || t.includes('(7,4)'));
  });

  if (needsWiden.length === 0) {
    console.log('[fix]   All three columns already DECIMAL(7,4) — no ALTER needed.');
    return;
  }

  for (const col of needsWiden) {
    console.log(`[fix]   ALTER ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} → DECIMAL(7,4)...`);
    await conn.execute(
      `ALTER TABLE order_lines MODIFY COLUMN \`${col.COLUMN_NAME}\` DECIMAL(7,4) NULL`
    );
    console.log(`[fix]   ✓ Done.`);
  }
}

// ── Step 2: re-backfill period_disc_pct for L* items ─────────────────────────
async function lookupPeriodDisc(conn, priceListNum, sapItemCode, orderDate) {
  if (!priceListNum) return null;
  const [rows] = await conn.execute(
    `SELECT discount_percent
     FROM period_discount
     WHERE price_list_num = ?
       AND sap_item_code  = ?
       AND (date_from IS NULL OR date_from <= ?)
       AND (date_to   IS NULL OR date_to   >= ?)
     ORDER BY date_from DESC
     LIMIT 1`,
    [priceListNum, sapItemCode, orderDate, orderDate]
  );
  return rows.length > 0 && rows[0].discount_percent != null
    ? Number(rows[0].discount_percent)
    : null;
}

async function rebackfillLItems(conn) {
  console.log('\n[fix] Step 2 — Fetching order lines for items starting with "L"...');

  const [lines] = await conn.execute(`
    SELECT
      ol.id                 AS line_id,
      ol.sap_item_code,
      ol.is_gift_line,
      ol.period_disc_pct    AS old_pct,
      DATE(o.created_at)    AS order_date,
      u.sap_price_list_num  AS price_list_num
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    JOIN users  u ON u.id = o.user_id
    WHERE ol.sap_item_code LIKE 'L%'
    ORDER BY ol.id
  `);

  console.log(`[fix]   Found ${lines.length} line(s) with item starting "L".`);
  if (lines.length === 0) { console.log('[fix]   Nothing to update.'); return; }

  let updated = 0, unchanged = 0, errors = 0;

  for (const line of lines) {
    try {
      const { line_id, sap_item_code, is_gift_line, order_date, price_list_num, old_pct } = line;

      // Gift lines: period discount is always 0
      const newPct = is_gift_line ? 0 : (await lookupPeriodDisc(conn, price_list_num, sap_item_code, order_date) ?? 0);
      const oldNum = old_pct != null ? Number(old_pct) : null;

      await conn.execute(
        `UPDATE order_lines SET period_disc_pct = ? WHERE id = ?`,
        [newPct, line_id]
      );

      if (oldNum !== newPct) {
        console.log(
          `[fix]   line ${line_id} (${sap_item_code}, ${order_date}): ` +
          `period_disc_pct  ${oldNum !== null ? oldNum.toFixed(4) : 'NULL'} → ${newPct.toFixed(4)}%`
        );
        updated++;
      } else {
        unchanged++;
      }
    } catch (err) {
      console.error(`[fix]   line ${line.line_id} ERROR:`, err.message);
      errors++;
    }
  }

  console.log(`\n[fix]   Done.  Updated: ${updated}  Unchanged: ${unchanged}  Errors: ${errors}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[fix] Connecting...');
  const conn = await mysql.createConnection(getDbConfig());
  try {
    await widenColumns(conn);
    await rebackfillLItems(conn);
    console.log('\n[fix] All done.');
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error('[fix] Fatal:', err); process.exit(1); });
