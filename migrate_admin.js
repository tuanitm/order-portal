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

  async function addColumnIfMissing(table, column, ddl) {
    const [cols] = await conn.query(`SHOW COLUMNS FROM ${table}`);
    if (!cols.some((c) => c.Field === column)) {
      await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      console.log(`✓ Added ${table}.${column}`);
    } else {
      console.log(`- ${table}.${column} already exists`);
    }
  }

  // ── users: SAP customer-group codes ──
  await addColumnIfMissing('users', 'sap_cus_grp01', 'sap_cus_grp01 VARCHAR(20) NULL AFTER sap_price_list_num');
  await addColumnIfMissing('users', 'sap_cus_grp02', 'sap_cus_grp02 VARCHAR(20) NULL AFTER sap_cus_grp01');
  await addColumnIfMissing('users', 'sap_cus_grp03', 'sap_cus_grp03 VARCHAR(20) NULL AFTER sap_cus_grp02');

  // ── admin_roles ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS admin_roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(255),
      permissions JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured admin_roles table');

  // ── admin_users ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role_id INT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (role_id) REFERENCES admin_roles(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured admin_users table');

  // Note: the OITB-based item_groups table this script used to create/seed
  // was superseded by item_categories (see migrate_item_categories.js) and
  // is dropped there. Nothing to do for it here.

  // ── price_lists ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS price_lists (
      price_list_num INT PRIMARY KEY,
      list_name VARCHAR(255),
      is_base BOOLEAN DEFAULT FALSE,
      is_channel BOOLEAN DEFAULT FALSE,
      last_synced TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured price_lists table');

  const priceListSeed = [
    [11, 'S01. IMV Price List', true, false],
    [12, 'S02. GT Price List', false, true],
    [13, 'S03. MT Price List', false, true],
    [14, 'S04. EC Price List', false, true],
    [15, 'S05. BB Price List', false, true],
    [16, 'S06. OT Price List', false, true],
  ];
  for (const [num, name, isBase, isChannel] of priceListSeed) {
    await conn.query(
      `INSERT INTO price_lists (price_list_num, list_name, is_base, is_channel) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_base = VALUES(is_base), is_channel = VALUES(is_channel)`,
      [num, name, isBase, isChannel]
    );
  }
  console.log('✓ Seeded price lists (base + channels)');

  // ── customer_groups ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS customer_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      level TINYINT NOT NULL,
      code VARCHAR(20) NOT NULL,
      parent_code VARCHAR(20) NULL,
      name VARCHAR(255) NULL,
      UNIQUE KEY uk_level_code (level, code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured customer_groups table');

  // ── catalog_visibility ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS catalog_visibility (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_group_id INT NOT NULL,
      item_group_code INT NOT NULL,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE KEY uk_group_itemgroup (customer_group_id, item_group_code),
      FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured catalog_visibility table');

  // ── customer_item_group_overrides ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS customer_item_group_overrides (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      item_group_code INT NOT NULL,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE KEY uk_user_itemgroup (user_id, item_group_code),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured customer_item_group_overrides table');

  // ── Bootstrap: a default "Super Admin" role for reference (config.json admin
  // is always a super-admin regardless of this table; this row exists so any
  // admin_users created can point at a sensible starting role) ──
  await conn.query(
    `INSERT INTO admin_roles (name, description, permissions) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [
      'Super Admin',
      'Full access to all admin sections',
      JSON.stringify([
        'dashboard', 'customers', 'sap-customers', 'customer-groups', 'catalog-visibility',
        'items', 'item-groups', 'price-lists', 'contract-discounts',
        'orders', 'admin-users', 'admin-roles',
      ]),
    ]
  );
  console.log('✓ Seeded default Super Admin role');

  await conn.end();
  console.log('\n✓ Migration complete!');
}

main().catch((e) => console.error('DB Error:', e.message));
