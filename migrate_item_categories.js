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

  async function dropColumnIfExists(table, column) {
    const [cols] = await conn.query(`SHOW COLUMNS FROM ${table}`);
    if (cols.some((c) => c.Field === column)) {
      await conn.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      console.log(`✓ Dropped ${table}.${column}`);
    } else {
      console.log(`- ${table}.${column} already absent`);
    }
  }

  async function dropIndexIfExists(table, indexName) {
    const [idx] = await conn.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    if (idx.length > 0) {
      await conn.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
      console.log(`✓ Dropped index ${table}.${indexName}`);
    }
  }

  // ── items: 6-level category codes (U_ItemCat01..06 from SAP Items) ──
  for (let i = 1; i <= 6; i++) {
    const n = String(i).padStart(2, '0');
    await addColumnIfMissing('items', `item_cat${n}`, `item_cat${n} VARCHAR(20) NULL`);
  }

  // is_active is now purely sync-driven (reflects the current sellable
  // category filter); is_manually_hidden is a separate admin override that
  // survives resyncs, so a category resync never silently un-hides an item
  // an admin deliberately hid.
  await addColumnIfMissing('items', 'is_manually_hidden', 'is_manually_hidden BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active');

  // ── item_groups: replaces the old OITB-based item groups table ──
  await conn.query(`
    CREATE TABLE IF NOT EXISTS item_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      level TINYINT NOT NULL,
      code VARCHAR(20) NOT NULL,
      parent_code VARCHAR(20) NULL,
      name VARCHAR(255) NULL,
      is_sellable BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE KEY uk_level_code (level, code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ Ensured item_groups table');

  // ── catalog_visibility: item_group_code (OITB) -> item_category_level/code ──
  const [cvCols] = await conn.query('SHOW COLUMNS FROM catalog_visibility');
  if (cvCols.some((c) => c.Field === 'item_group_code')) {
    // uk_group_itemgroup is the only index covering customer_group_id, so the
    // FK to customer_groups depends on it — add a plain index first so the
    // FK survives dropping the composite unique key.
    const [existingIdx] = await conn.query("SHOW INDEX FROM catalog_visibility WHERE Key_name = 'idx_customer_group_id'");
    if (existingIdx.length === 0) {
      await conn.query('ALTER TABLE catalog_visibility ADD INDEX idx_customer_group_id (customer_group_id)');
      console.log('✓ Added supporting index idx_customer_group_id (for FK) before dropping uk_group_itemgroup');
    }
    await dropIndexIfExists('catalog_visibility', 'uk_group_itemgroup');
    await conn.query('DELETE FROM catalog_visibility'); // OITB-keyed rows are meaningless under the new model
    await dropColumnIfExists('catalog_visibility', 'item_group_code');
  }
  await addColumnIfMissing('catalog_visibility', 'item_category_level', 'item_category_level TINYINT NULL AFTER customer_group_id');
  await addColumnIfMissing('catalog_visibility', 'item_category_code', 'item_category_code VARCHAR(20) NULL AFTER item_category_level');
  const [cvIdx] = await conn.query("SHOW INDEX FROM catalog_visibility WHERE Key_name = 'uk_group_itemcat'");
  if (cvIdx.length === 0) {
    await conn.query(
      `ALTER TABLE catalog_visibility ADD UNIQUE KEY uk_group_itemcat (customer_group_id, item_category_level, item_category_code)`
    );
    console.log('✓ Added catalog_visibility.uk_group_itemcat');
  }

  // ── customer_item_group_overrides: same transformation ──
  const [ovCols] = await conn.query('SHOW COLUMNS FROM customer_item_group_overrides');
  if (ovCols.some((c) => c.Field === 'item_group_code')) {
    const [existingOvIdx] = await conn.query("SHOW INDEX FROM customer_item_group_overrides WHERE Key_name = 'idx_user_id'");
    if (existingOvIdx.length === 0) {
      await conn.query('ALTER TABLE customer_item_group_overrides ADD INDEX idx_user_id (user_id)');
      console.log('✓ Added supporting index idx_user_id (for FK) before dropping uk_user_itemgroup');
    }
    await dropIndexIfExists('customer_item_group_overrides', 'uk_user_itemgroup');
    await conn.query('DELETE FROM customer_item_group_overrides');
    await dropColumnIfExists('customer_item_group_overrides', 'item_group_code');
  }
  await addColumnIfMissing('customer_item_group_overrides', 'item_category_level', 'item_category_level TINYINT NULL AFTER user_id');
  await addColumnIfMissing('customer_item_group_overrides', 'item_category_code', 'item_category_code VARCHAR(20) NULL AFTER item_category_level');
  const [ovIdx] = await conn.query("SHOW INDEX FROM customer_item_group_overrides WHERE Key_name = 'uk_user_itemcat'");
  if (ovIdx.length === 0) {
    await conn.query(
      `ALTER TABLE customer_item_group_overrides ADD UNIQUE KEY uk_user_itemcat (user_id, item_category_level, item_category_code)`
    );
    console.log('✓ Added customer_item_group_overrides.uk_user_itemcat');
  }

  // ── item_groups (OITB) is superseded by item_categories; drop it ──
  const [tables] = await conn.query("SHOW TABLES LIKE 'item_groups'");
  if (tables.length > 0) {
    await conn.query('DROP TABLE item_groups');
    console.log('✓ Dropped superseded item_groups (OITB) table');
  }

  await conn.end();
  console.log('\n✓ Migration complete!');
}

main().catch((e) => console.error('DB Error:', e.message));
