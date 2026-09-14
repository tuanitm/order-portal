import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

let pool: Pool | null = null;

/**
 * Decrypt a Fernet-encrypted value using the project's encryption key.
 * Falls back to the raw value if decryption fails.
 */
function decryptFernetValue(encryptedValue: string): string {
  try {
    const scriptDir = join(process.cwd(), 'scripts');
    const keyPath = join(scriptDir, '.encryption_key');

    // Use Python to decrypt (reusing existing Fernet infrastructure)
    const result = execSync(
      `python -c "import sys; from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${encryptedValue}').decode(), end='')"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return result.trim();
  } catch (error) {
    console.error('Failed to decrypt Fernet value:', error);
    return encryptedValue;
  }
}

/**
 * Load database configuration from config.json and .env
 */
function loadDbConfig(): PoolOptions {
  const configPath = join(process.cwd(), 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const mysqlConfig = config.mysql;

  // Read MySQL password from .env
  let dbPassword = '';
  try {
    const envPath = join(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/MYSQL_DB_PASS=["']?([^"'\r\n]+)["']?/);
    if (match) {
      const rawValue = match[1];
      // Check if encrypted (Fernet tokens start with gAAAAA)
      if (rawValue.startsWith('gAAAAA') || rawValue.startsWith('FERNET:')) {
        const token = rawValue.replace(/^FERNET:/, '');
        dbPassword = decryptFernetValue(token);
      } else {
        dbPassword = rawValue;
      }
    }
  } catch (error) {
    console.error('Failed to read .env for MYSQL_DB_PASS:', error);
  }

  return {
    host: mysqlConfig.dbIp || 'localhost',
    port: mysqlConfig.dbPort || 3306,
    database: mysqlConfig.dbName || 'orderdatasource',
    user: mysqlConfig.dpUser || 'orderdata',
    password: dbPassword,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
  };
}

/**
 * Get or create the MySQL connection pool.
 */
export function getPool(): Pool {
  if (!pool) {
    const config = loadDbConfig();
    pool = mysql.createPool(config);
    console.log(`[DB] MySQL pool created → ${config.host}:${config.port}/${config.database}`);
  }
  return pool;
}

/**
 * Execute a query with parameters.
 */
export async function query<T>(sql: string, params?: unknown[]): Promise<T> {
  const db = getPool();
  const [rows] = await db.execute(sql, params as (string | number | boolean | null | Buffer)[]);
  return rows as T;
}

/**
 * Execute a query and return the first row.
 */
export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T[]>(sql, params);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * Close the database pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DB] MySQL pool closed');
  }
}

export default { getPool, query, queryOne, closePool };
