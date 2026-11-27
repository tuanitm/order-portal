import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { execSync } from "child_process";
const config = JSON.parse(readFileSync("config.json", "utf-8"));
function secret(name) {
  const env = readFileSync(".env", "utf-8");
  const raw = (env.match(new RegExp(`${name}=["']?([^"'\r\n]+)["']?`)) || [])[1] || "";
  const token = raw.replace(/^FERNET:/, "");
  if (!token.startsWith("gAAAAA")) return raw;
  return execSync(`python -c "from cryptography.fernet import Fernet; print(Fernet(open(r'scripts/.encryption_key','rb').read()).decrypt(b'${token}').decode(), end='')"`, { encoding: "utf-8" });
}
const db = await mysql.createConnection({ host: config.mysql.dbIp, port: config.mysql.dbPort, user: config.mysql.dpUser, password: secret("MYSQL_DB_PASS"), database: config.mysql.dbName });
console.log("db", config.mysql.dbIp, config.mysql.dbName, "SAP", config.sapb1.companyID);
const [d] = await db.query(`SELECT id, doc_number, source, status, approval_mode, sap_card_code, doc_date, wdd_code, template_name, sap_draft_entry, sap_doc_entry, sap_doc_no, posted_sap_user, LEFT(last_error,150) err, updated_at
  FROM ar_documents ORDER BY updated_at DESC LIMIT 8`);
console.table(d);
const [e] = await db.query(`SELECT ar_document_id id, action, admin_label, sap_user_code, LEFT(notes,180) notes, created_at FROM ar_document_events ORDER BY id DESC LIMIT 15`);
console.table(e);
await db.end();
