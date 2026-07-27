import { createPool } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema.js';
import { logger } from '../shared/logger.js';

let pool: Pool | null = null;

/** MySQL 연결 풀 (lazy init) */
export function getPool(): Pool {
  if (!pool) {
    const host = process.env.DB_HOST || 'mysql';
    const port = parseInt(process.env.DB_PORT || '3306', 10);
    const user = process.env.DB_USER || 'gameuser';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_NAME || 'idle_game';

    pool = createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit: 10 });
    logger.info({ host, port, database }, 'MySQL connection pool created');
  }
  return pool;
}

/** Drizzle ORM 인스턴스 */
export function getDb() {
  return drizzle(getPool(), { schema, mode: 'default' });
}

/** Graceful shutdown: 연결 풀 종료 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('MySQL connection pool closed');
  }
}
