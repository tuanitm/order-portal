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

  // ── users.sap_price_list_num ──
  const [userCols] = await conn.query('SHOW COLUMNS FROM users');
  if (!userCols.some((c) => c.Field === 'sap_price_list_num')) {
    await conn.query(
      `ALTER TABLE users ADD COLUMN sap_price_list_num INT NULL AFTER sap_card_name`
    );
    console.log('✓ Added users.sap_price_list_num');
  } else {
    console.log('- users.sap_price_list_num already exists');
  }

  // ── items.items_group_code ──
  const [itemCols] = await conn.query('SHOW COLUMNS FROM items');
  if (!itemCols.some((c) => c.Field === 'items_group_code')) {
    await conn.query(
      `ALTER TABLE items ADD COLUMN items_group_code INT NULL AFTER category`
    );
    console.log('✓ Added items.items_group_code');
  } else {
    console.log('- items.items_group_code already exists');
  }

  // ── item_channel_prices table ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS item_channel_prices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sap_item_code VARCHAR(50) NOT NULL,
      price_list_num INT NOT NULL,
      price DECIMAL(18,2) NOT NULL DEFAULT 0,
      last_synced TIMESTAMP NULL,
      UNIQUE KEY uk_item_pricelist (sap_item_code, price_list_num),
      INDEX idx_item_code (sap_item_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured item_channel_prices table');

  await conn.end();
  console.log('\n✓ Migration complete!');
}

main().catch((e) => console.error('DB Error:', e.message));
