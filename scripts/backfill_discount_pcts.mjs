/**
 * One-time (idempotent) backfill: fills period_disc_pct, contract_disc_pct,
 * and promo_disc_pct on legacy order_lines rows where all three are NULL
 * (orders placed before those columns were added).
 *
 * Uses the SAME discount waterfall as src/lib/pricing/productPricing.ts:
 *   Period   → period_discount     (scoped to price list + item, date-valid)
 *   Contract → contract_discount   (scoped to customer/group + item/category)
 *   Promo    → promotion_discount  (scoped to BP/group + item/category via
 *                                   bp_type/it_type, date-valid)
 *
 * Date validity is checked against each order's own created_at (not CURDATE())
 * so historical discount rates are captured rather than today's active ones.
 *
 * Run:  node scripts/backfill_discount_pcts.mjs
 * Safe to re-run — only rows where ALL THREE columns are NULL are touched.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// ── Config helpers (same pattern as migrate_root_admin.mjs) ──────────────────

function resolveEnvSecret(envVarName) {
  const envContent = readFileSync(join(rootDir, '.env'), 'utf-8');
  const match = envContent.match(new RegExp(`${envVarName}=[\"']?([^\"'\\r\\n]+)[\"']?`));
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

// ── Discount lookup helpers ──────────────────────────────────────────────────

/**
 * Period discount: best row in period_discount for (price_list_num, item_code)
 * where date_from/date_to bracket the given order date.
 * Returns the discount_percent or null.
 */
async function lookupPeriodDisc(conn, priceListNum, sapItemCode, orderDate) {
  if (!priceListNum) return null;
  const [rows] = await conn.execute(
    `SELECT discount_percent
     FROM period_discount
     WHERE price_list_num = ?
       AND sap_item_code = ?
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

/**
 * Contract discount: best row in contract_discount for (customer, item) pair.
 * Specificity score mirrors productPricing.ts ORDER BY logic (item first, then customer).
 * Returns the u_base_disc_pct or null.
 */
async function lookupContractDisc(
  conn,
  cardCode, grp01, grp02, grp03,
  sapItemCode, itemCat01, itemCat02, itemCat03, itemCat04, itemCat05, itemCat06,
  orderDate
) {
  const custCodes = [cardCode, grp01, grp02, grp03].filter(Boolean);
  if (custCodes.length === 0) return null;

  // Build the item-code IN list from item and its category codes (nulls filtered)
  const itemCodes = [sapItemCode, itemCat01, itemCat02, itemCat03, itemCat04, itemCat05, itemCat06].filter(Boolean);
  const itemPlaceholders = itemCodes.map(() => '?').join(', ');
  const custPlaceholders = custCodes.map(() => '?').join(', ');

  const [rows] = await conn.execute(
    `SELECT u_base_disc_pct
     FROM contract_discount
     WHERE (canceled IS NULL OR canceled != 'Y')
       AND u_code_cust IN (${custPlaceholders})
       AND u_code_item IN (${itemPlaceholders})
       AND (u_valid_from IS NULL OR u_valid_from <= ?)
       AND (u_valid_to   IS NULL OR u_valid_to   >= ?)
     ORDER BY
       (CASE u_code_item
          WHEN ? THEN 600
          WHEN ? THEN 60  WHEN ? THEN 50  WHEN ? THEN 40
          WHEN ? THEN 30  WHEN ? THEN 20  WHEN ? THEN 10
          ELSE 0 END)
       +
       (CASE u_code_cust
          WHEN ? THEN 600
          WHEN ? THEN 300 WHEN ? THEN 200 WHEN ? THEN 100
          ELSE 0 END) DESC,
       u_base_disc_pct DESC
     LIMIT 1`,
    [
      ...custCodes,
      ...itemCodes,
      orderDate,
      orderDate,
      // item specificity weights (exact, cat06 → cat01):
      sapItemCode,
      itemCat06 || '', itemCat05 || '', itemCat04 || '',
      itemCat03 || '', itemCat02 || '', itemCat01 || '',
      // customer specificity weights (exact BP, grp03, grp02, grp01):
      cardCode || '',
      grp03 || '', grp02 || '', grp01 || '',
    ]
  );
  return rows.length > 0 && rows[0].u_base_disc_pct != null
    ? Number(rows[0].u_base_disc_pct)
    : null;
}

/**
 * Promotion discount: best percent-discount row in promotion_discount for
 * (customer, item) pair — same bp_type/it_type logic as productPricing.ts.
 *
 * If the order line already has a promotion_code we prefer that program;
 * otherwise we pick the highest-specificity / highest-discount one.
 * Returns the disc_pct or null.
 */
async function lookupPromoDisc(
  conn,
  cardCode, grp01, grp02, grp03,
  sapItemCode, itemCat01, itemCat02, itemCat03, itemCat04, itemCat05, itemCat06,
  orderDate,
  promotionCode
) {
  const [rows] = await conn.execute(
    `SELECT promotion_code, disc_pct,
       (CASE it_type
          WHEN '4'   THEN 600 WHEN 'IC6' THEN 60  WHEN 'IC5' THEN 50 WHEN 'IC4' THEN 40
          WHEN 'IC3' THEN 30  WHEN 'IC2' THEN 20  WHEN 'IC1' THEN 10 ELSE 0 END)
       +
       (CASE bp_type
          WHEN '2'   THEN 600 WHEN 'CG3' THEN 300 WHEN 'CG2' THEN 200 WHEN 'CG1' THEN 100 ELSE 0 END)
       AS score
     FROM promotion_discount
     WHERE disc_pct IS NOT NULL
       AND (selling_qty IS NULL OR selling_qty <= 1)
       AND (begin_date IS NULL OR begin_date <= ?)
       AND (end_date   IS NULL OR end_date   >= ?)
       AND (
         (bp_type = '2'   AND bp_code = ?)
         OR (bp_type = 'CG1' AND bp_code = ?)
         OR (bp_type = 'CG2' AND bp_code = ?)
         OR (bp_type = 'CG3' AND bp_code = ?)
         OR (bp_type IS NULL AND bp_code IS NULL)
       )
       AND (
         (it_type = '4'   AND selling_item_code = ?)
         OR (it_type = 'IC1' AND selling_item_code = ?)
         OR (it_type = 'IC2' AND selling_item_code = ?)
         OR (it_type = 'IC3' AND selling_item_code = ?)
         OR (it_type = 'IC4' AND selling_item_code = ?)
         OR (it_type = 'IC5' AND selling_item_code = ?)
         OR (it_type = 'IC6' AND selling_item_code = ?)
       )
     ORDER BY score DESC, disc_pct DESC`,
    [
      orderDate, orderDate,
      cardCode || '', grp01 || '', grp02 || '', grp03 || '',
      sapItemCode,
      itemCat01 || '', itemCat02 || '', itemCat03 || '',
      itemCat04 || '', itemCat05 || '', itemCat06 || '',
    ]
  );

  if (rows.length === 0) return null;

  // If the line recorded a specific promotion_code, prefer that program's pct
  if (promotionCode) {
    const matching = rows.find((r) => r.promotion_code === promotionCode);
    if (matching) return Number(matching.disc_pct);
  }

  // Otherwise take the best-scoring / highest-pct match (index 0)
  return Number(rows[0].disc_pct);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql.createConnection(getDbConfig());

  try {
    // Fetch all legacy order lines where all three discount columns are NULL,
    // joining to the order + user to get customer pricing context,
    // and to items to get item category codes.
    console.log('[backfill] Fetching legacy order lines with NULL discount columns...');
    const [lines] = await conn.execute(`
      SELECT
        ol.id                 AS line_id,
        ol.sap_item_code,
        ol.promotion_code,
        ol.is_gift_line,
        DATE(o.created_at)    AS order_date,
        u.sap_card_code,
        u.sap_cus_grp01      AS grp01,
        u.sap_cus_grp02      AS grp02,
        u.sap_cus_grp03      AS grp03,
        u.sap_price_list_num AS price_list_num,
        i.item_cat01, i.item_cat02, i.item_cat03,
        i.item_cat04, i.item_cat05, i.item_cat06
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      JOIN users  u ON u.id = o.user_id
      LEFT JOIN items i ON i.sap_item_code = ol.sap_item_code
      WHERE ol.period_disc_pct   IS NULL
        AND ol.contract_disc_pct IS NULL
        AND ol.promo_disc_pct    IS NULL
      ORDER BY ol.id
    `);

    console.log(`[backfill] Found ${lines.length} line(s) to process.`);
    if (lines.length === 0) {
      console.log('[backfill] Nothing to do — all lines already have discount data.');
      return;
    }

    let updated = 0;
    let errors  = 0;

    for (const line of lines) {
      try {
        const {
          line_id, sap_item_code, promotion_code, is_gift_line, order_date,
          sap_card_code, grp01, grp02, grp03, price_list_num,
          item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06,
        } = line;

        // Gift lines (free items) have no meaningful discount percent —
        // set all three to 0 so they stop being NULL without misrepresenting data.
        if (is_gift_line) {
          await conn.execute(
            `UPDATE order_lines SET period_disc_pct = 0, contract_disc_pct = 0, promo_disc_pct = 0 WHERE id = ?`,
            [line_id]
          );
          console.log(`[backfill]  line ${line_id} (${sap_item_code}) → gift line, set all to 0`);
          updated++;
          continue;
        }

        const periodPct   = await lookupPeriodDisc(
          conn, price_list_num, sap_item_code, order_date
        );
        const contractPct = await lookupContractDisc(
          conn, sap_card_code, grp01, grp02, grp03,
          sap_item_code, item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06,
          order_date
        );
        const promoPct    = await lookupPromoDisc(
          conn, sap_card_code, grp01, grp02, grp03,
          sap_item_code, item_cat01, item_cat02, item_cat03, item_cat04, item_cat05, item_cat06,
          order_date, promotion_code
        );

        await conn.execute(
          `UPDATE order_lines
           SET period_disc_pct   = ?,
               contract_disc_pct = ?,
               promo_disc_pct    = ?
           WHERE id = ?`,
          [periodPct ?? 0, contractPct ?? 0, promoPct ?? 0, line_id]
        );

        console.log(
          `[backfill]  line ${line_id} (${sap_item_code}, ${order_date}): ` +
          `STD=${periodPct ?? 0}%  CT=${contractPct ?? 0}%  PM=${promoPct ?? 0}%`
        );
        updated++;
      } catch (err) {
        console.error(`[backfill]  line ${line.line_id} ERROR:`, err.message);
        errors++;
      }
    }

    console.log(
      `\n[backfill] Done.  Updated: ${updated}  Errors: ${errors}`
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[backfill] Fatal:', err);
  process.exit(1);
});
