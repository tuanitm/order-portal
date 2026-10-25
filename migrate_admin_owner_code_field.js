/**
 * migrate_admin_owner_code_field.js
 *
 * Adds `owner_code` to `admin_users` — this admin's SAP Employee lookup key
 * (matched against EmployeesInfo.ExternalEmployeeNumber at order-push time),
 * used to set the pushed Sales Order's DocumentsOwner/U_OwnerName header
 * fields — see SapB1Client.resolveOrderOwner and POST
 * /api/admin/orders/[id]/confirm.
 *
 * Safe to re-run — the ALTER checks current state first.
 * Run once: node migrate_admin_owner_code_field.js
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

  const [cols] = await conn.query("SHOW COLUMNS FROM admin_users WHERE Field = 'owner_code'");
  if (cols.length > 0) {
    console.log('- admin_users.owner_code: already exists — skipping');
  } else {
    await conn.query(`ALTER TABLE admin_users ADD COLUMN owner_code VARCHAR(50) NULL AFTER department_code`);
    console.log('✓ admin_users: added column owner_code');
  }

  await conn.end();
  console.log('\n✓ admin-owner-code-field migration complete!');
}

main().catch((e) => { console.error('DB Error:', e.message); process.exit(1); });
