/**
 * Run schema.sql against the MySQL database.
 * Usage: node scripts/run-schema.mjs
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

async function main() {
  // Load config
  const config = JSON.parse(readFileSync(join(rootDir, 'config.json'), 'utf-8'));
  const mysqlCfg = config.mysql;

  // Decrypt password
  const { execSync } = await import('child_process');
  const envContent = readFileSync(join(rootDir, '.env'), 'utf-8');
  const match = envContent.match(/MYSQL_DB_PASS=["']?([^"'\r\n]+)["']?/);
  const rawPass = match ? match[1] : '';

  let password = rawPass;
  if (rawPass.startsWith('gAAAAA')) {
    const keyPath = join(rootDir, 'scripts', '.encryption_key');
    password = execSync(
      `python -c "from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${rawPass}').decode(), end='')"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
  }

  const connOpts = {
    host: mysqlCfg.dbIp,
    port: mysqlCfg.dbPort,
    user: mysqlCfg.dpUser,
    password: password,
    multipleStatements: true,
  };

  console.log(`Connecting to MySQL at ${connOpts.host}:${connOpts.port}...`);

  let connection;
  try {
    connection = await mysql.createConnection(connOpts);
    console.log('✓ Connected to MySQL');

    // Ensure database exists
    const dbName = mysqlCfg.dbName;
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✓ Database "${dbName}" ensured`);

    // Switch to database
    await connection.query(`USE \`${dbName}\``);
    console.log(`✓ Using database "${dbName}"`);

    // Read and execute schema
    const schema = readFileSync(join(rootDir, 'schema.sql'), 'utf-8');
    await connection.query(schema);
    console.log('✓ Schema executed successfully');

    // Verify tables
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`\n✓ Tables created (${tables.length}):`);
    for (const row of tables) {
      const tableName = Object.values(row)[0];
      const [countResult] = await connection.query(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
      console.log(`  - ${tableName} (${countResult[0].cnt} rows)`);
    }

  } catch (error) {
    console.error('✗ Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\nCould not connect. Possible fixes:');
      console.error('  1. Is MySQL running? Check: docker ps | grep mysql');
      console.error(`  2. Is host "${connOpts.host}" resolvable? Try "localhost" or "127.0.0.1"`);
      console.error(`  3. Is port ${connOpts.port} correct?`);
    }
    if (error.code === 'ENOTFOUND') {
      console.error(`\nHost "${connOpts.host}" not found. If MySQL runs on Docker, try "localhost" or "127.0.0.1" instead.`);
    }
    process.exit(1);
  } finally {
    if (connection) await connection.end();
    console.log('\nDone.');
  }
}

main();
