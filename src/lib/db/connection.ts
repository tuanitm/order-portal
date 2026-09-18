import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { loadConfig, resolveEnvSecret } from '@/lib/config';

let pool: Pool | null = null;

/**
 * Load database configuration from config.json and .env
 */
function loadDbConfig(): PoolOptions {
  const mysqlConfig = loadConfig().mysql;
  const dbPassword = resolveEnvSecret('MYSQL_DB_PASS');

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
