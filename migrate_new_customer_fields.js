/**
 * migrate_new_customer_fields.js
 *
 * Adds the columns `users` needs to support registering a brand-new
 * company that isn't yet a SAP Business Partner: an address to create the
 * BP's BPAddresses from, plus the commercial fields an admin assigns before
 * the portal creates the BP (see POST /api/admin/customers/[id]/create-bp).
 *
 * Safe to re-run — every ALTER checks current state first.
 * Run once: node migrate_new_customer_fields.js
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

  await addColumnIfMissing('users', 'registration_address', 'TEXT NULL', 'sap_cus_grp03');
  await addColumnIfMissing('users', 'sap_group_code', 'INT NULL', 'registration_address');
  await addColumnIfMissing('users', 'pay_terms_grp_code', 'INT NULL', 'sap_group_code');
  await addColumnIfMissing('users', 'salesperson_code', 'INT NULL', 'pay_terms_grp_code');
  await addColumnIfMissing('users', 'credit_limit', 'DECIMAL(18,2) NULL', 'salesperson_code');
  await addColumnIfMissing('users', 'currency', 'VARCHAR(10) NULL', 'credit_limit');

  await conn.end();
  console.log('\n✓ new-customer-fields migration complete!');
}

main().catch((e) => { console.error('DB Error:', e.message); process.exit(1); });
