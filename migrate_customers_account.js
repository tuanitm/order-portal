/**
 * migrate_customers_account.js
 * Adds the `account` column to the existing `customers` table.
 * Run once: node migrate_customers_account.js
 */
const mysql = require("mysql2/promise");
const config = require("./config.json");

async function main() {
  const db = config.database || config.db;
  const pool = mysql.createPool({
    host: db.host,
    port: db.port || 3306,
    user: db.user,
    password: db.password,
    database: db.name || db.database,
  });

  console.log("Adding 'account' column to customers table...");

  try {
    await pool.execute(
      `ALTER TABLE customers ADD COLUMN account VARCHAR(255) NULL AFTER address`
    );
    console.log("✓ Column 'account' added successfully.");
  } catch (err) {
    if (err.code === "ER_DUP_FIELDNAME") {
      console.log("✓ Column 'account' already exists — skipping.");
    } else {
      throw err;
    }
  }

  await pool.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
