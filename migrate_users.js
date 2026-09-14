const mysql = require('mysql2/promise');
const fs = require('fs');
const { execSync } = require('child_process');

async function main() {
  // Decrypt DB password
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

  // Check current columns
  const [cols] = await conn.query('SHOW COLUMNS FROM users');
  console.log('Current columns:');
  cols.forEach(c => console.log('  -', c.Field, '(' + c.Type + ')'));

  // Check if migration needed
  const hasApproval = cols.some(c => c.Field === 'approval_status');
  if (hasApproval) {
    console.log('\n✓ approval_status column already exists. No migration needed.');
    await conn.end();
    return;
  }

  console.log('\n⚠ approval_status column missing. Running migration...');

  // Check if user_type exists to drop it
  const hasUserType = cols.some(c => c.Field === 'user_type');
  if (hasUserType) {
    await conn.query('ALTER TABLE users DROP COLUMN user_type');
    console.log('  ✓ Dropped user_type column');
  }

  // Add new columns
  await conn.query(`ALTER TABLE users
    ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' AFTER is_active,
    ADD COLUMN approved_at TIMESTAMP NULL AFTER approval_status,
    ADD COLUMN approved_by VARCHAR(255) NULL AFTER approved_at,
    ADD COLUMN rejection_reason TEXT NULL AFTER approved_by`);
  console.log('  ✓ Added approval_status, approved_at, approved_by, rejection_reason');

  // Add index
  try {
    await conn.query('ALTER TABLE users ADD INDEX idx_approval_status (approval_status)');
    console.log('  ✓ Added index idx_approval_status');
  } catch (e) {
    console.log('  - Index already exists, skipping');
  }

  // Auto-approve existing active users
  const [result] = await conn.query("UPDATE users SET approval_status = 'approved' WHERE is_active = TRUE");
  console.log(`  ✓ Auto-approved ${result.affectedRows} existing active users`);

  console.log('\n✓ Migration complete!');
  await conn.end();
}

main().catch(e => console.error('DB Error:', e.message));
