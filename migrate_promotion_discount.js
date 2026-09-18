import { getPool } from "./src/lib/db/connection.ts";

async function main() {
  const pool = getPool();

  try {
    console.log("Creating promotion_discount table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promotion_discount (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doc_entry INT NOT NULL,
        promotion_code VARCHAR(50),
        promotion_name VARCHAR(255),
        create_date DATE,
        update_date DATE,
        begin_date DATE,
        end_date DATE,
        bp_grp_code VARCHAR(50),
        bp_grp_name VARCHAR(255),
        bp_code VARCHAR(50),
        bp_name VARCHAR(255),
        selling_grp_code VARCHAR(50),
        selling_grp_name VARCHAR(255),
        selling_item_code VARCHAR(50),
        selling_item_name VARCHAR(255),
        disc_pct DECIMAL(6,2),
        selling_qty DECIMAL(18,2),
        giving_item_code VARCHAR(50),
        giving_item_name VARCHAR(255),
        giving_qty DECIMAL(18,2),
        last_synced TIMESTAMP NULL,
        INDEX idx_bp_code (bp_code),
        INDEX idx_selling_item_code (selling_item_code),
        INDEX idx_active_dates (begin_date, end_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("Created promotion_discount table successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

main();
