/**
 * migrate_customer_region_fields.js
 *
 * Adds the columns `users` needs for: a separate Shipping Address (Billing
 * Address was already `registration_address`), a free-text Remark from the
 * customer, and a self-declared region (Customer Group 2 code) used only
 * to route a pending new-company registration's visibility to the
 * matching regional admin — see isCustomerInApprovalScope and
 * POST /api/admin/customers/[id]/create-bp.
 *
 * Safe to re-run — every ALTER checks current state first.
 * Run once: node migrate_customer_region_fields.js
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const { execSync } = require('child_process');

async function main() {
  const env = fs.readFileSync('.env', 'utf-8');
  const m = env.match(/MYSQL_DB_PASS=([^\r\n]+)/);
  const raw = m ? m[1] : '';
  let pass = raw;
  if (raw.startsWith('gAAAAA')) {
    pass = execSync(
      `python -c "from cryptography.fernet import Fernet; key=open(r'scripts/.encryption_key','rb').read(); f=Fernet(key); print(f.decrypt(b'${raw}').decode(),end='')"`,
      { encoding: 'utf-8' }
    ).trim();
  }

  const conn = await mysql.createConnection({
    host: 'mysql8', port: 3386, database: 'orderdatasource',
    user: 'orderdata', password: pass,
  });

  async function hasColumn(table, column) {
    const [cols] = await conn.query('SHOW COLUMNS FROM ?? WHERE Field = ?', [table, column]);
    return cols.length > 0;
  }

  async function addColumnIfMissing(table, column, definitionSql, afterColumn) {
    if (await hasColumn(table, column)) {
      console.log(`- ${table}.${column}: already exists — skipping`);
      return;
    }
    await conn.query(`ALTER TABLE ?? ADD COLUMN ${column} ${definitionSql} AFTER ??`, [table, afterColumn]);
    console.log(`✓ ${table}: added column ${column}`);
  }

  await addColumnIfMissing('users', 'registration_shipping_address', 'TEXT NULL', 'registration_address');
  await addColumnIfMissing('users', 'registration_remark', 'TEXT NULL', 'registration_shipping_address');
  await addColumnIfMissing('users', 'declared_region_code', 'VARCHAR(20) NULL', 'registration_remark');

  await conn.end();
  console.log('\n✓ customer-region-fields migration complete!');
}

main().catch((e) => { console.error('DB Error:', e.message); process.exit(1); });
