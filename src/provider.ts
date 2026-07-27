/**
 * 저장소 provider — DB_DRIVER 환경변수에 따라 JSON 또는 MySQL 선택
 *
 * DB_DRIVER=mysql → MySQL
 * 그 외          → JSON 파일 (기본값)
 */
import type { PlayerRepository } from './repository.js';

async function loadJsonRepo(): Promise<PlayerRepository> {
  const { createPlayer, getPlayer, getAllPlayers, updatePlayer, deletePlayer } = await import('./store.js');
  return {
    createPlayer: (p) => Promise.resolve(createPlayer(p)),
    getPlayer: (id) => Promise.resolve(getPlayer(id)),
    getAllPlayers: () => Promise.resolve(getAllPlayers()),
    updatePlayer: (id, u) => Promise.resolve(updatePlayer(id, u)),
    deletePlayer: (id) => Promise.resolve(deletePlayer(id)),
  };
}

async function loadMysqlRepo(): Promise<PlayerRepository> {
  const { mysqlPlayerRepo } = await import('./db/mysql.repository.js');
  return mysqlPlayerRepo;
}

let _repo: PlayerRepository | null = null;

export async function getRepo(): Promise<PlayerRepository> {
  if (!_repo) {
    if (process.env.DB_DRIVER === 'json') {
      _repo = await loadJsonRepo();
      return _repo;
    }

    // 기본: MySQL. 연결 실패 시 JSON 폴백 (개발 편의)
    try {
      _repo = await loadMysqlRepo();
      const { getPool } = await import('./db/connection.js');
      await getPool().query('SELECT 1');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MySQL unavailable (${msg}), falling back to JSON store. Set DB_DRIVER=json to suppress this warning.`);
      _repo = await loadJsonRepo();
    }
  }
  return _repo;
}

/** 테스트 전용: 저장소 재설정 */
export function resetRepo(): void {
  _repo = null;
}
