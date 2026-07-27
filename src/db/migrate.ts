/**
 * 마이그레이션 실행 스크립트
 * 사용: npm run db:migrate
 */
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { getPool } from './connection.js';
import { drizzle } from 'drizzle-orm/mysql2';
import { logger } from '../shared/logger.js';

async function run() {
  const db = drizzle(getPool());
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  logger.info('Migrations complete');
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err: (err as Error).message }, 'Migration failed');
  process.exit(1);
});
