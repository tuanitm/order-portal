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

  // SAP Customer Master cache — mirrors `items` for Business Partners.
  // Scoped to customer_groups pairs declared in custgroup.json (same
  // pattern as items being scoped to itemgroup.json pairs), not the full
  // SAP customer base. Distinct from `users` (portal-registered accounts).
  await conn.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sap_card_code VARCHAR(50) UNIQUE NOT NULL,
      card_name VARCHAR(255),
      mst_code VARCHAR(50),
      price_list_num INT NULL,
      cus_grp01 VARCHAR(20) NULL,
      cus_grp02 VARCHAR(20) NULL,
      cus_grp03 VARCHAR(20) NULL,
      phone VARCHAR(50) NULL,
      email VARCHAR(255) NULL,
      address TEXT NULL,
      last_synced TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mst_code (mst_code),
      INDEX idx_cus_grp01 (cus_grp01),
      INDEX idx_cus_grp02 (cus_grp02)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured customers table');

  await conn.end();
  console.log('\n✓ Migration complete!');
}

main().catch((e) => console.error('DB Error:', e.message));
