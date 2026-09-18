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

  // Contract Discounts (synced from SAP B1 CBD — @MDM_CD_CBD_H/@MDM_CD_CBD_L).
  // One row per (header, line): a header targets a customer (specific
  // CardCode or a customer_groups level 1-3 code); each line targets items
  // (a specific ItemCode or an item_categories level 1-6 code) with a
  // discount percentage. U_Type/U_TypeName encode which targeting mode
  // applies — see sync.ts CONTRACT_DISCOUNT_TYPE constants.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS contract_discount (
      id INT AUTO_INCREMENT PRIMARY KEY,
      doc_entry INT NOT NULL,
      doc_num INT NULL,
      line_id INT NOT NULL,
      period INT NULL,
      status VARCHAR(10) NULL,
      create_date DATE NULL,
      update_date DATE NULL,
      canceled VARCHAR(1) NULL,
      u_type_cust VARCHAR(10) NULL,
      u_type_name_cust VARCHAR(100) NULL,
      u_code_cust VARCHAR(50) NULL,
      u_name_cust VARCHAR(255) NULL,
      u_valid_from DATE NULL,
      u_valid_to DATE NULL,
      u_type_item VARCHAR(10) NULL,
      u_type_name_item VARCHAR(100) NULL,
      u_code_item VARCHAR(50) NULL,
      u_name_item VARCHAR(255) NULL,
      u_base_disc_pct DECIMAL(6,2) NULL,
      last_synced TIMESTAMP NULL,
      UNIQUE KEY uk_doc_line (doc_entry, line_id),
      INDEX idx_code_cust (u_code_cust),
      INDEX idx_code_item (u_code_item)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured contract_discount table');

  await conn.end();
  console.log('\n✓ Migration complete!');
}

main().catch((e) => console.error('DB Error:', e.message));
