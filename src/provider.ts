/**
 * 저장소 provider — DB_DRIVER 환경변수에 따라 JSON 또는 MySQL 선택
 *
 * DB_DRIVER=mysql → MySQL
 * 그 외          → JSON 파일 (기본값)
 */
import type { PlayerRepository, AuthRepository } from './repository.js';

// ─── PlayerRepository ─────────────────────────────

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

/** 테스트 전용: Player 저장소 재설정 */
export function resetRepo(): void {
  _repo = null;
}

// ─── AuthRepository ───────────────────────────────

async function loadJsonAuthRepo(): Promise<AuthRepository> {
  const { jsonAuthRepo } = await import('./store-auth.js');
  return jsonAuthRepo;
}

async function loadMysqlAuthRepo(): Promise<AuthRepository> {
  const { mysqlAuthRepo } = await import('./db/mysql-auth.repository.js');
  return mysqlAuthRepo;
}

let _authRepo: AuthRepository | null = null;
let _authRepoMode: 'json' | 'mysql' | null = null;

export async function getAuthRepo(): Promise<AuthRepository> {
  if (!_authRepo) {
    if (process.env.DB_DRIVER === 'json') {
      _authRepo = await loadJsonAuthRepo();
      _authRepoMode = 'json';
      return _authRepo;
    }

    try {
      _authRepo = await loadMysqlAuthRepo();
      const { getPool } = await import('./db/connection.js');
      await getPool().query('SELECT 1');
      _authRepoMode = 'mysql';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MySQL unavailable for auth repo (${msg}), falling back to JSON store.`);
      _authRepo = await loadJsonAuthRepo();
      _authRepoMode = 'json';
    }
  }
  return _authRepo;
}

/** 현재 Auth 저장소 모드 반환 ('json' | 'mysql') */
export function getAuthRepoMode(): 'json' | 'mysql' {
  return _authRepoMode || 'json';
}

/** 테스트 전용: Auth 저장소 재설정 */
export function resetAuthRepo(): void {
  _authRepo = null;
  _authRepoMode = null;
}

/** 모든 저장소 일괄 리셋 (테스트 전용) */
export function resetAllRepos(): void {
  _repo = null;
  _authRepo = null;
  _authRepoMode = null;
}
