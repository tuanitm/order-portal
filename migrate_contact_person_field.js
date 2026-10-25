/**
 * migrate_contact_person_field.js
 *
 * Adds `registration_contact_person` to `users` — an optional contact-
 * person name collected at new-company signup (separate from full_name,
 * the login account holder), pushed to SAP as ContactEmployees.Name on
 * BP creation when provided — see POST /api/admin/customers/[id]/create-bp.
 *
 * Safe to re-run — the ALTER checks current state first.
 * Run once: node migrate_contact_person_field.js
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

  const [cols] = await conn.query("SHOW COLUMNS FROM users WHERE Field = 'registration_contact_person'");
  if (cols.length > 0) {
    console.log('- users.registration_contact_person: already exists — skipping');
  } else {
    await conn.query(`ALTER TABLE users ADD COLUMN registration_contact_person VARCHAR(255) NULL AFTER registration_remark`);
    console.log('✓ users: added column registration_contact_person');
  }

  await conn.end();
  console.log('\n✓ contact-person-field migration complete!');
}

main().catch((e) => { console.error('DB Error:', e.message); process.exit(1); });
