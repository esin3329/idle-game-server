/**
 * JSON → MySQL 데이터 마이그레이션
 *
 * 사용:
 *   DB_DRIVER=mysql npm run db:import-json
 *
 * data.json 파일의 모든 플레이어를 MySQL로 가져옴.
 * 이미 존재하는 ID는 건너뜀 (중복 INSERT 방지).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mysqlPlayerRepo } from './db/mysql.repository.js';
import type { Player } from './types.js';
import { logger } from './shared/logger.js';

const DATA_FILE = process.env.DATA_FILE || join(process.cwd(), 'data.json');

async function run() {
  if (!existsSync(DATA_FILE)) {
    logger.warn('data.json not found, nothing to import');
    process.exit(0);
  }

  const raw = readFileSync(DATA_FILE, 'utf-8');
  const data: Player[] = JSON.parse(raw);

  logger.info({ count: data.length }, 'Importing players from JSON to MySQL...');

  let imported = 0;
  let skipped = 0;

  for (const player of data) {
    const existing = await mysqlPlayerRepo.getPlayer(player.id);
    if (existing) {
      skipped++;
      continue;
    }
    await mysqlPlayerRepo.createPlayer(player);
    imported++;
  }

  logger.info({ imported, skipped }, 'Import complete');
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err: (err as Error).message }, 'Import failed');
  process.exit(1);
});
