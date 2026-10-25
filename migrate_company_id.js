/**
 * Adds multi-company support: a `company_id` column on every table, backfilled
 * with the currently-configured admin.entityID (config.json), then every
 * UNIQUE/PRIMARY key that assumed a business key was globally unique is
 * rebuilt as composite with company_id leading. See schema.sql's top-of-file
 * comment and the plan this came from for the full rationale.
 *
 * Safe to re-run — every step checks current state first.
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const { execSync } = require('child_process');

async function main() {
  const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
  const companyId = config.admin && config.admin.entityID;
  if (!companyId) {
    throw new Error('config.json admin.entityID is not set — refusing to backfill company_id with nothing.');
  }
  console.log(`Using company_id = ${JSON.stringify(companyId)} (config.json admin.entityID)`);

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

  async function addCompanyColumnAndBackfill(table) {
    if (!(await hasColumn(table, 'company_id'))) {
      // Cosmetic only (doesn't affect correctness): match schema.sql's
      // column order on a fresh install — right after `id` when the table
      // has a surrogate PK, otherwise first (tables with no surrogate id —
      // cost_centers/warehouses/price_lists/sync_schedule_settings).
      const position = (await hasColumn(table, 'id')) ? 'AFTER id' : 'FIRST';
      await conn.query(`ALTER TABLE ?? ADD COLUMN company_id VARCHAR(50) NULL ${position}`, [table]);
      console.log(`✓ ${table}: added company_id`);
    }
    const [result] = await conn.query('UPDATE ?? SET company_id = ? WHERE company_id IS NULL', [table, companyId]);
    if (result.affectedRows > 0) {
      console.log(`✓ ${table}: backfilled ${result.affectedRows} row(s) with company_id`);
    }
  }

  async function makeCompanyIdNotNull(table) {
    await conn.query('ALTER TABLE ?? MODIFY COLUMN company_id VARCHAR(50) NOT NULL', [table]);
  }

  /** Drops the auto-named UNIQUE index MySQL creates for an inline `col UNIQUE` column (if present), whatever its actual name turned out to be. */
  async function dropUniqueIndexOnColumn(table, column) {
    const [idx] = await conn.query(
      "SHOW INDEX FROM ?? WHERE Column_name = ? AND Non_unique = 0 AND Key_name != 'PRIMARY' AND Seq_in_index = 1",
      [table, column]
    );
    for (const row of idx) {
      // Only a single-column key, not a composite one that happens to start with this column.
      const [full] = await conn.query('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, row.Key_name]);
      if (full.length === 1) {
        await conn.query('ALTER TABLE ?? DROP INDEX ??', [table, row.Key_name]);
        console.log(`✓ ${table}: dropped single-column unique index ${row.Key_name} on ${column}`);
      }
    }
  }

  async function dropIndexIfExists(table, indexName) {
    const [idx] = await conn.query('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, indexName]);
    if (idx.length > 0) {
      await conn.query('ALTER TABLE ?? DROP INDEX ??', [table, indexName]);
      console.log(`✓ ${table}: dropped index ${indexName}`);
    }
  }

  async function addUniqueIfMissing(table, indexName, columnsSql) {
    const [idx] = await conn.query('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, indexName]);
    if (idx.length === 0) {
      await conn.query(`ALTER TABLE ?? ADD UNIQUE KEY ${indexName} (${columnsSql})`, [table]);
      console.log(`✓ ${table}: added ${indexName} (${columnsSql})`);
    }
  }

  /** Full handling for a table whose only change is: add company_id, backfill, NOT NULL, replace one OLD named composite unique key with a NEW one that leads with company_id. */
  async function migrateComposite(table, oldKeyName, newKeyName, newColumnsSql) {
    await addCompanyColumnAndBackfill(table);
    await dropIndexIfExists(table, oldKeyName);
    await makeCompanyIdNotNull(table);
    await addUniqueIfMissing(table, newKeyName, newColumnsSql);
    await conn.query('ALTER TABLE ?? ADD INDEX idx_company (company_id)', [table]).catch(() => {});
  }

  /** Same, but the old constraint was an inline single-column `col UNIQUE`, not a named composite key. */
  async function migrateInlineUnique(table, column, newKeyName) {
    await addCompanyColumnAndBackfill(table);
    await dropUniqueIndexOnColumn(table, column);
    await makeCompanyIdNotNull(table);
    await addUniqueIfMissing(table, newKeyName, `company_id, ${column}`);
  }

  /** Table with no unique key to touch — just add + backfill + NOT NULL + a plain index. */
  async function migratePlain(table) {
    await addCompanyColumnAndBackfill(table);
    await makeCompanyIdNotNull(table);
    await conn.query('ALTER TABLE ?? ADD INDEX idx_company (company_id)', [table]).catch(() => {});
  }

  // ── users: two inline UNIQUE columns ──
  await addCompanyColumnAndBackfill('users');
  await dropUniqueIndexOnColumn('users', 'email');
  await dropUniqueIndexOnColumn('users', 'phone');
  await makeCompanyIdNotNull('users');
  await addUniqueIfMissing('users', 'uk_company_email', 'company_id, email');
  await addUniqueIfMissing('users', 'uk_company_phone', 'company_id, phone');
  await conn.query("ALTER TABLE users ADD INDEX idx_company (company_id)").catch(() => {});

  // ── items ──
  await migrateInlineUnique('items', 'sap_item_code', 'uk_company_item');
  await conn.query("ALTER TABLE items ADD INDEX idx_company (company_id)").catch(() => {});

  // ── cost_centers: composite PK, no surrogate id ──
  await addCompanyColumnAndBackfill('cost_centers');
  await conn.query('ALTER TABLE cost_centers DROP PRIMARY KEY, ADD PRIMARY KEY (company_id, ocr_code, dimension)');
  console.log('✓ cost_centers: rebuilt PRIMARY KEY as (company_id, ocr_code, dimension)');

  // ── item_groups ──
  await migrateComposite('item_groups', 'uk_level_code', 'uk_company_level_code', 'company_id, level, code');

  // ── item_channel_prices ──
  await migrateComposite('item_channel_prices', 'uk_item_pricelist', 'uk_company_item_pricelist', 'company_id, sap_item_code, price_list_num');

  // ── special_prices ──
  await migrateComposite('special_prices', 'uk_bp_item', 'uk_company_bp_item', 'company_id, sap_card_code, sap_item_code');

  // ── period_discount ──
  await migrateComposite('period_discount', 'uk_pricelist_item_from', 'uk_company_pricelist_item_from', 'company_id, price_list_num, sap_item_code, date_from');

  // ── special_discount ──
  await migrateComposite('special_discount', 'uk_bp_item_from', 'uk_company_bp_item_from', 'company_id, sap_card_code, sap_item_code, valid_from');

  // ── customer_group_warehouses: drop its FK to warehouses BEFORE warehouses' PK changes shape ──
  {
    const [fks] = await conn.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_group_warehouses'
         AND REFERENCED_TABLE_NAME = 'warehouses'`
    );
    for (const fk of fks) {
      await conn.query('ALTER TABLE customer_group_warehouses DROP FOREIGN KEY ??', [fk.CONSTRAINT_NAME]);
      console.log(`✓ customer_group_warehouses: dropped FK ${fk.CONSTRAINT_NAME} to warehouses (PK is becoming composite — see schema.sql's note)`);
    }
  }

  // ── warehouses: composite PK, no surrogate id ──
  await addCompanyColumnAndBackfill('warehouses');
  await conn.query('ALTER TABLE warehouses DROP PRIMARY KEY, ADD PRIMARY KEY (company_id, sap_warehouse_code)');
  console.log('✓ warehouses: rebuilt PRIMARY KEY as (company_id, sap_warehouse_code)');

  // ── item_warehouse_stock ──
  await migrateComposite('item_warehouse_stock', 'uk_item_warehouse', 'uk_company_item_warehouse', 'company_id, sap_item_code, warehouse_code');

  // ── contract_discount ──
  await migrateComposite('contract_discount', 'uk_doc_line', 'uk_company_doc_line', 'company_id, doc_entry, line_id');

  // ── customer_require_shelflife ──
  await migrateComposite('customer_require_shelflife', 'uk_doc_itemgroup', 'uk_company_doc_itemgroup', 'company_id, doc_entry, item_group_code');

  // ── promotion_discount / promotions: no unique key ──
  await migratePlain('promotion_discount');
  await migratePlain('promotions');

  // ── orders ──
  await migrateInlineUnique('orders', 'order_number', 'uk_company_order_number');
  await dropIndexIfExists('orders', 'idx_order_number'); // superseded by the composite unique's own leading-column usability

  // ── order_lines / order_status_history / order_messages: denormalized, no unique key ──
  await migratePlain('order_lines');
  await migratePlain('order_status_history');
  await migratePlain('order_messages');

  // ── push_subscriptions ──
  await addCompanyColumnAndBackfill('push_subscriptions');
  await dropIndexIfExists('push_subscriptions', 'uk_endpoint');
  await makeCompanyIdNotNull('push_subscriptions');
  await addUniqueIfMissing('push_subscriptions', 'uk_company_endpoint', 'company_id, endpoint(255)');

  // ── admin_roles ──
  await migrateInlineUnique('admin_roles', 'name', 'uk_company_name');

  // ── admin_users ──
  await migrateInlineUnique('admin_users', 'email', 'uk_company_email');

  // ── price_lists: composite PK, no surrogate id ──
  await addCompanyColumnAndBackfill('price_lists');
  await conn.query('ALTER TABLE price_lists DROP PRIMARY KEY, ADD PRIMARY KEY (company_id, price_list_num)');
  console.log('✓ price_lists: rebuilt PRIMARY KEY as (company_id, price_list_num)');

  // ── customer_groups ──
  await migrateComposite('customer_groups', 'uk_level_code', 'uk_company_level_code', 'company_id, level, code');

  // ── catalog_visibility ──
  await migrateComposite('catalog_visibility', 'uk_group_itemcat', 'uk_company_group_itemcat', 'company_id, customer_group_id, item_category_level, item_category_code');

  // ── customer_group_warehouses (its own company_id/unique key — FK already dropped above) ──
  await migrateComposite('customer_group_warehouses', 'uk_group_warehouse', 'uk_company_group_warehouse', 'company_id, customer_group_id, warehouse_code');

  // ── admin_user_customer_groups / admin_user_item_groups ──
  await migrateComposite('admin_user_customer_groups', 'uk_admin_cg', 'uk_company_admin_cg', 'company_id, admin_user_id, customer_group_id');
  await migrateComposite('admin_user_item_groups', 'uk_admin_ig', 'uk_company_admin_ig', 'company_id, admin_user_id, item_group_id');

  // ── customers ──
  await migrateInlineUnique('customers', 'sap_card_code', 'uk_company_card_code');

  // ── sync_schedule_settings: singleton `id` PK -> one row per company, company_id itself is the PK ──
  {
    const hasId = await hasColumn('sync_schedule_settings', 'id');
    if (hasId) {
      await addCompanyColumnAndBackfill('sync_schedule_settings');
      const [checks] = await conn.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sync_schedule_settings' AND CONSTRAINT_TYPE = 'CHECK'`
      );
      for (const c of checks) {
        await conn.query('ALTER TABLE sync_schedule_settings DROP CHECK ??', [c.CONSTRAINT_NAME]);
      }
      await conn.query('ALTER TABLE sync_schedule_settings DROP PRIMARY KEY, ADD PRIMARY KEY (company_id)');
      await conn.query('ALTER TABLE sync_schedule_settings MODIFY COLUMN company_id VARCHAR(50) NOT NULL');
      await conn.query('ALTER TABLE sync_schedule_settings DROP COLUMN id');
      console.log('✓ sync_schedule_settings: rebuilt as one-row-per-company (company_id is now the PRIMARY KEY, old singleton id column dropped)');
    } else {
      console.log('- sync_schedule_settings: already migrated (no id column)');
    }
  }

  await conn.end();
  console.log('\n✓ company_id migration complete!');
}

main().catch((e) => { console.error('DB Error:', e.message); process.exit(1); });
