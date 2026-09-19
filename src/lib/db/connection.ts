import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { loadConfig, resolveEnvSecret } from '@/lib/config';

let pool: Pool | null = null;

/**
 * The portal runs on Vietnam time (UTC+7). MySQL's own clock is whatever its
 * container/server uses (typically UTC), so pin both sides to +07:00:
 *  - the pool's `timezone` makes DATETIME/TIMESTAMP <-> JS Date conversions use
 *    +07:00 no matter what TZ the Node process has;
 *  - `SET time_zone` on every new connection makes NOW() / CURDATE() /
 *    CURRENT_TIMESTAMP defaults (created_at, last_synced, promotion validity
 *    dates...) evaluate in Vietnam time too.
 */
const DB_TIME_ZONE = '+07:00';

/**
 * Load database configuration from config.json and .env
 */
function loadDbConfig(): PoolOptions {
  const mysqlConfig = loadConfig().mysql;
  const dbPassword = resolveEnvSecret('MYSQL_DB_PASS');

  return {
    // MYSQL_HOST / MYSQL_PORT (set by docker-compose) override config.json:
    // inside the shared Docker network MySQL is reached by container name on
    // its internal port, not the host-published one config.json uses for dev.
    host: process.env.MYSQL_HOST || mysqlConfig.dbIp || 'localhost',
    port: Number(process.env.MYSQL_PORT) || mysqlConfig.dbPort || 3306,
    database: mysqlConfig.dbName || 'orderdatasource',
    user: mysqlConfig.dpUser || 'orderdata',
    password: dbPassword,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
    timezone: DB_TIME_ZONE,
  };
}

/**
 * Get or create the MySQL connection pool.
 */
export function getPool(): Pool {
  if (!pool) {
    const config = loadDbConfig();
    pool = mysql.createPool(config);
    // Runs before the connection is handed to any query, so it is always applied first.
    pool.on('connection', (conn) => {
      conn.query(`SET time_zone = '${DB_TIME_ZONE}'`);
    });
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
