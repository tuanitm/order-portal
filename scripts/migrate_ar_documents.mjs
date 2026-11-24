/**
 * AR Invoice (and later AR Credit Memo) entered on the portal and posted to SAP.
 *
 *   node scripts/migrate_ar_documents.mjs           dry run
 *   node scripts/migrate_ar_documents.mjs --apply   apply (idempotent)
 *
 * Additive only — safe on the DB shared with Order-Portal2 (ADS): three new
 * tables, nothing existing is changed.
 *  - ar_documents: one per portal AR document (header, status, SAP links).
 *  - ar_document_lines: its lines.
 *  - ar_document_events: who did what (created, posted, approved, …).
 *  - ar_documents.source ('portal' / 'sap') + sync_schedule_settings.notif_last_ar_wdd_code:
 *    AR approval requests raised in the SAP client, pulled into the portal.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf-8"));
const COMPANY = config.admin?.entityID;
if (!COMPANY) throw new Error("config.json admin.entityID is missing");

function secret(name) {
  const env = readFileSync(join(root, ".env"), "utf-8");
  const raw = (env.match(new RegExp(`${name}=["']?([^"'\\r\\n]+)["']?`)) || [])[1] || "";
  const token = raw.replace(/^FERNET:/, "");
  if (!token.startsWith("gAAAAA")) return raw;
  const key = join(root, "scripts", ".encryption_key");
  return execSync(`python -c "from cryptography.fernet import Fernet; print(Fernet(open(r'${key}','rb').read()).decrypt(b'${token}').decode(), end='')"`, { encoding: "utf-8" });
}

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST || config.mysql.dbIp, port: Number(process.env.MYSQL_PORT) || config.mysql.dbPort,
  user: config.mysql.dpUser, password: secret("MYSQL_DB_PASS"), database: config.mysql.dbName, charset: "utf8mb4",
});
const q = async (sql, params = []) => (await db.query(sql, params))[0];
const log = (...a) => console.log(APPLY ? "[apply]" : "[plan] ", ...a);
const hasTable = async (t) => (await q("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [t])).length > 0;
const create = async (t, sql) => {
  if (await hasTable(t)) { console.log(`        ${t} exists`); return; }
  log(`CREATE TABLE ${t}`);
  if (APPLY) await q(sql);
};

console.log(`Company ${COMPANY} — ${APPLY ? "APPLYING" : "dry run (add --apply)"}\n`);

await create("ar_documents", `CREATE TABLE ar_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  doc_kind ENUM('invoice','credit_memo') NOT NULL DEFAULT 'invoice',
  doc_number VARCHAR(30) NULL COMMENT 'portal number, e.g. ARI261124001',
  status ENUM('draft','pending_approval','approved','posted','rejected','failed','cancelled') NOT NULL DEFAULT 'draft',
  sap_card_code VARCHAR(50) NOT NULL,
  card_name VARCHAR(200) NULL,
  bill_to_code VARCHAR(100) NULL,
  ship_to_code VARCHAR(100) NULL,
  inv_name VARCHAR(200) NULL,
  inv_tax_no VARCHAR(20) NULL,
  inv_address VARCHAR(200) NULL,
  doc_date DATE NOT NULL,
  due_date DATE NOT NULL,
  tax_date DATE NOT NULL,
  num_at_card VARCHAR(100) NULL,
  comments VARCHAR(254) NULL,
  warehouse_code VARCHAR(20) NULL,
  department_code VARCHAR(20) NULL,
  total_before_vat DECIMAL(19,2) NOT NULL DEFAULT 0,
  vat_sum DECIMAL(19,2) NOT NULL DEFAULT 0,
  doc_total DECIMAL(19,2) NOT NULL DEFAULT 0,
  created_by INT NULL COMMENT 'admin_users.id',
  created_by_label VARCHAR(150) NULL,
  posted_by INT NULL,
  posted_sap_user VARCHAR(50) NULL COMMENT 'SAP user the document was added as',
  posted_at DATETIME NULL,
  wdd_code INT NULL COMMENT 'SAP approval request (OWDD.WddCode)',
  wtm_code INT NULL,
  template_name VARCHAR(100) NULL,
  sap_draft_entry INT NULL,
  sap_doc_entry INT NULL,
  sap_doc_num INT NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ar_doc_number (company_id, doc_number),
  KEY idx_ar_status (company_id, doc_kind, status),
  KEY idx_ar_card (company_id, sap_card_code),
  KEY idx_ar_wdd (company_id, wdd_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

await create("ar_document_lines", `CREATE TABLE ar_document_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  ar_document_id INT NOT NULL,
  line_no INT NOT NULL,
  item_code VARCHAR(50) NOT NULL,
  item_name VARCHAR(200) NULL,
  uom VARCHAR(50) NULL,
  quantity DECIMAL(19,6) NOT NULL,
  unit_price DECIMAL(19,6) NOT NULL,
  discount_pct DECIMAL(9,4) NOT NULL DEFAULT 0,
  vat_group VARCHAR(20) NULL,
  brand_code VARCHAR(20) NULL,
  item_tax_class VARCHAR(100) NULL,
  description VARCHAR(254) NULL COMMENT 'invoice text, SAP U_INVDesc',
  line_total DECIMAL(19,2) NOT NULL DEFAULT 0,
  KEY idx_ar_line_doc (company_id, ar_document_id, line_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

await create("ar_document_events", `CREATE TABLE ar_document_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  ar_document_id INT NOT NULL,
  action VARCHAR(30) NOT NULL COMMENT 'created / updated / posted / sent_for_approval / approved / rejected / failed / deleted',
  admin_user_id INT NULL,
  admin_label VARCHAR(150) NULL,
  sap_user_code VARCHAR(50) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ar_event_doc (company_id, ar_document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

// Rebate (SAP UDO "RBT", @SAL_GE_RBT_H) a CKTM line pays out — posted as INV1.U_RBTRef.
const lineCols = new Set((await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'ar_document_lines'")).map((r) => r.c));
for (const [col, def] of [["rbt_ref", "INT NULL COMMENT 'SAP Rebate DocEntry (U_RBTRef)'"], ["rbt_code", "VARCHAR(30) NULL"], ["rbt_name", "VARCHAR(200) NULL"]]) {
  if (lineCols.has(col)) { console.log(`        ar_document_lines.${col} exists`); continue; }
  log(`ALTER TABLE ar_document_lines ADD ${col}`);
  if (APPLY) await q(`ALTER TABLE ar_document_lines ADD COLUMN ${col} ${def}`);
}

// AR Invoice approval requests raised in the SAP client, pulled into the portal (Settings → "Sync SO AR from").
const colsOf = async (t) => new Set((await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [t])).map((r) => r.c));
if ((await colsOf("ar_documents")).has("source")) console.log("        ar_documents.source exists");
else {
  log("ALTER TABLE ar_documents ADD source");
  if (APPLY) await q("ALTER TABLE ar_documents ADD COLUMN source ENUM('portal','sap') NOT NULL DEFAULT 'portal' COMMENT 'sap = approval request raised in the SAP client' AFTER doc_kind");
}
// Which SAP company DB (HANA schema, e.g. IMV / IMV261104) the SAP links (wdd_code, sap_doc_entry, …) belong to —
// the portal may be pointed at a test DB, and WddCode / DocEntry numbers repeat across DBs.
if ((await colsOf("ar_documents")).has("sap_db")) console.log("        ar_documents.sap_db exists");
else {
  log("ALTER TABLE ar_documents ADD sap_db");
  if (APPLY) await q("ALTER TABLE ar_documents ADD COLUMN sap_db VARCHAR(50) NULL COMMENT 'SAP company DB of wdd_code / sap_doc_entry; NULL = not in SAP yet' AFTER source");
}
// AR Invoice list: Brand (SAP U_ProdBrand, else the lines' brand) and AR. No (SAP U_DocNo, e.g. ARR261104007).
for (const [col, def] of [["brand_code", "VARCHAR(20) NULL COMMENT 'SAP U_ProdBrand / the lines brand'"], ["sap_doc_no", "VARCHAR(50) NULL COMMENT 'SAP U_DocNo (AR. No)'"]]) {
  if ((await colsOf("ar_documents")).has(col)) { console.log(`        ar_documents.${col} exists`); continue; }
  log(`ALTER TABLE ar_documents ADD ${col}`);
  if (APPLY) await q(`ALTER TABLE ar_documents ADD COLUMN ${col} ${def}`);
}
if ((await colsOf("sync_schedule_settings")).has("notif_last_ar_wdd_code")) console.log("        sync_schedule_settings.notif_last_ar_wdd_code exists");
else {
  log("ALTER TABLE sync_schedule_settings ADD notif_last_ar_wdd_code");
  if (APPLY) await q("ALTER TABLE sync_schedule_settings ADD COLUMN notif_last_ar_wdd_code INT NULL COMMENT 'last SAP AR approval request (OWDD 13) notified'");
}
if ((await colsOf("sync_schedule_settings")).has("notif_last_ar_db")) console.log("        sync_schedule_settings.notif_last_ar_db exists");
else {
  log("ALTER TABLE sync_schedule_settings ADD notif_last_ar_db");
  if (APPLY) await q("ALTER TABLE sync_schedule_settings ADD COLUMN notif_last_ar_db VARCHAR(50) NULL COMMENT 'SAP company DB notif_last_ar_wdd_code belongs to'");
}

console.log("\nDone.");
await db.end();
