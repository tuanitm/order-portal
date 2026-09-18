const mysql = require('mysql2/promise');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Reads SAP_Customer_Group.xlsx and upserts into the `customer_groups` table.
 * Columns: CUSTGRPCODE1, CUSTGRPNAME1, CUSTGRPCODE2, CUSTGRPNAME2, CUSTGRPCODE3, CUSTGRPNAME3
 * → 3-level hierarchy (level, code, parent_code, name).
 */
async function main() {
  // ── resolve DB password (may be Fernet-encrypted) ──
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

  // ── read Excel ──
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    console.error('xlsx package not found. Install it first: npm install xlsx');
    process.exit(1);
  }

  const xlsxPath = 'SAP_Customer_Group.xlsx';
  if (!fs.existsSync(xlsxPath)) {
    console.error(`${xlsxPath} not found in project root`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log(`Read ${rows.length} rows from ${xlsxPath}`);

  if (rows.length === 0) {
    console.warn('No data rows — nothing to import.');
    return;
  }

  // ── connect to MySQL ──
  const conn = await mysql.createConnection({
    host: 'mysql8', port: 3386, database: 'orderdatasource',
    user: 'orderdata', password: pass,
  });

  // ── ensure table exists ──
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

  // ── upsert hierarchy ──
  let upserted = 0;

  for (const row of rows) {
    const levels = [
      { code: row.CUSTGRPCODE1, name: row.CUSTGRPNAME1 },
      { code: row.CUSTGRPCODE2, name: row.CUSTGRPNAME2 },
      { code: row.CUSTGRPCODE3, name: row.CUSTGRPNAME3 },
    ];

    let parent = null;
    for (let i = 0; i < levels.length; i++) {
      const lvl = levels[i];
      if (!lvl.code) break; // stop at the first missing level

      await conn.execute(
        `INSERT INTO customer_groups (level, code, parent_code, name)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE parent_code = VALUES(parent_code), name = VALUES(name)`,
        [i + 1, String(lvl.code).trim(), parent, lvl.name ? String(lvl.name).trim() : null]
      );
      upserted++;
      parent = String(lvl.code).trim();
    }
  }

  console.log(`✓ Upserted ${upserted} customer_groups rows (across all levels)`);

  // ── also regenerate custgroup.json for backward compatibility ──
  // (getCustomerGroupPairsFromFile reads this for sync scope)
  const pairs = new Map();
  for (const row of rows) {
    const c1 = row.CUSTGRPCODE1;
    const n1 = row.CUSTGRPNAME1;
    const c2 = row.CUSTGRPCODE2;
    const n2 = row.CUSTGRPNAME2;
    if (c1 && c2) {
      pairs.set(`${c1}|${c2}`, {
        custgrpcode1: String(c1).trim(),
        custgrpname1: n1 ? String(n1).trim() : '',
        custgrpcode2: String(c2).trim(),
        custgrpname2: n2 ? String(n2).trim() : '',
      });
    }
  }
  const custgroupJson = { custGrpList: [...pairs.values()] };
  fs.writeFileSync('custgroup.json', JSON.stringify(custgroupJson, null, 4) + '\n');
  console.log(`✓ Regenerated custgroup.json with ${pairs.size} unique (grp1, grp2) pairs`);

  await conn.end();
  console.log('\n✓ Migration complete!');
}

main().catch((e) => console.error('DB Error:', e.message));
