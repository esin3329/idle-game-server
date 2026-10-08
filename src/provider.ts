/**
 * 저장소 provider — DB_DRIVER 환경변수에 따라 저장소를 선택
 *
 * DB_DRIVER=postgres → PostgreSQL
 * DB_DRIVER=mysql    → MySQL (연결 실패 시 종료)
 * DB_DRIVER=json     → JSON 파일 (개발/테스트 전용)
 * 미설정             → 개발 환경에서만 MySQL 연결 실패 시 JSON으로 전환
 */
import type { PlayerRepository, AuthRepository, WalletRepository, PartsRepository, MechaConfigRepository, ResearchRepository, CraftingRepository, BattleRepository, AdminRepository } from './repository.js';

function allowDevelopmentJsonFallback(): boolean {
  return process.env.DB_DRIVER === undefined && process.env.NODE_ENV !== 'production';
}

// ─── PlayerRepository ─────────────────────────────

async function loadJsonRepo(): Promise<PlayerRepository> {
  const { createPlayer, getPlayer, getAllPlayers, updatePlayer, deletePlayer } = await import('./store.js');
  return {
    createPlayer: async (p) => {
      const player = createPlayer(p);
      try {
        const { jsonAuthRepo } = await import('./store-auth.js');
        await jsonAuthRepo.createWallet({
          id: crypto.randomUUID(),
          playerId: p.id,
          userId: p.id,
          electricity: p.electricity,
          electricityPerSecond: p.electricityPerSecond,
          balance: p.electricity,
          lastClaimedAt: p.lastClaimedAt,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        });
      } catch (err) {
        deletePlayer(p.id);
        throw err;
      }
      return player;
    },
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
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresPlayerRepo } = await import('./db/postgres.repository.js');
    return postgresPlayerRepo;
  }
  if (!_repo) {
    if (process.env.DB_DRIVER === 'json') {
      _repo = await loadJsonRepo();
      return _repo;
    }

    try {
      _repo = await loadMysqlRepo();
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
    } catch (err) {
      _repo = null;
      if (!allowDevelopmentJsonFallback()) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MySQL unavailable (${msg}), falling back to JSON store in development.`);
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
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresAuthRepo } = await import('./db/postgres-auth.repository.js');
    return postgresAuthRepo;
  }
  if (!_authRepo) {
    if (process.env.DB_DRIVER === 'json') {
      _authRepo = await loadJsonAuthRepo();
      _authRepoMode = 'json';
      return _authRepo;
    }

    try {
      _authRepo = await loadMysqlAuthRepo();
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
      _authRepoMode = 'mysql';
    } catch (err) {
      _authRepo = null;
      _authRepoMode = null;
      if (!allowDevelopmentJsonFallback()) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MySQL unavailable for auth repo (${msg}), falling back to JSON store in development.`);
      _authRepo = await loadJsonAuthRepo();
      _authRepoMode = 'json';
    }
  }
  return _authRepo;
}

/** 현재 Auth 저장소 모드 반환 ('json' | 'mysql') */
export function getAuthRepoMode(): 'json' | 'mysql' | 'postgres' {
  if (process.env.DB_DRIVER === 'postgres') return 'postgres';
  return _authRepoMode || 'json';
}

/** 테스트 전용: Auth 저장소 재설정 */
export function resetAuthRepo(): void {
  _authRepo = null;
  _authRepoMode = null;
}

// ─── WalletRepository ────────────────────────────

async function loadJsonWalletRepo(): Promise<WalletRepository> {
  const { jsonWalletRepo } = await import('./store-wallet.js');
  return jsonWalletRepo;
}

async function loadMysqlWalletRepo(): Promise<WalletRepository> {
  const { mysqlWalletRepo } = await import('./db/mysql-wallet.repository.js');
  return mysqlWalletRepo;
}

let _walletRepo: WalletRepository | null = null;
let _walletRepoMode: 'json' | 'mysql' | null = null;

export async function getWalletRepo(): Promise<WalletRepository> {
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresWalletRepo } = await import('./db/postgres-wallet.repository.js');
    return postgresWalletRepo;
  }
  if (!_walletRepo) {
    if (process.env.DB_DRIVER === 'json') {
      _walletRepo = await loadJsonWalletRepo();
      _walletRepoMode = 'json';
      return _walletRepo;
    }

    try {
      _walletRepo = await loadMysqlWalletRepo();
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
      _walletRepoMode = 'mysql';
    } catch (err) {
      _walletRepo = null;
      _walletRepoMode = null;
      if (!allowDevelopmentJsonFallback()) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MySQL unavailable for wallet repo (${msg}), falling back to JSON store in development.`);
      _walletRepo = await loadJsonWalletRepo();
      _walletRepoMode = 'json';
    }
  }
  return _walletRepo;
}

/** 현재 Wallet 저장소 모드 반환 */
export function getWalletRepoMode(): 'json' | 'mysql' | 'postgres' {
  if (process.env.DB_DRIVER === 'postgres') return 'postgres';
  return _walletRepoMode || 'json';
}

/** 테스트 전용: Wallet 저장소 재설정 */
export function resetWalletRepo(): void {
  _walletRepo = null;
  _walletRepoMode = null;
}

// ─── PartsRepository ────────────────────────────

async function loadJsonPartsRepo(): Promise<PartsRepository> {
  const { jsonPartsRepo } = await import('./store-parts.js');
  return jsonPartsRepo;
}

async function loadMysqlPartsRepo(): Promise<PartsRepository> {
  const { mysqlPartsRepo } = await import('./db/mysql-parts.repository.js');
  return mysqlPartsRepo;
}

let _partsRepo: PartsRepository | null = null;

export async function getPartsRepo(): Promise<PartsRepository> {
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresPartsRepo } = await import('./db/postgres-parts.repository.js');
    return postgresPartsRepo;
  }
  if (!_partsRepo) {
    if (process.env.DB_DRIVER === 'json') {
      _partsRepo = await loadJsonPartsRepo();
      return _partsRepo;
    }
    try {
      _partsRepo = await loadMysqlPartsRepo();
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
    } catch (err) {
      _partsRepo = null;
      if (!allowDevelopmentJsonFallback()) throw err;
      _partsRepo = await loadJsonPartsRepo();
    }
  }
  return _partsRepo;
}

export function resetPartsRepo(): void {
  _partsRepo = null;
}

// ─── MechaConfigRepository (Parts와 동일 연결 공유) ─

let _configsRepo: MechaConfigRepository | null = null;

export async function getMechaConfigRepo(): Promise<MechaConfigRepository> {
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresMechaConfigRepo } = await import('./db/postgres-parts.repository.js');
    return postgresMechaConfigRepo;
  }
  if (!_configsRepo) {
    if (process.env.DB_DRIVER === 'json') {
      const { jsonMechaConfigRepo } = await import('./store-parts.js');
      _configsRepo = jsonMechaConfigRepo;
      return _configsRepo;
    }
    try {
      const { mysqlMechaConfigRepo } = await import('./db/mysql-parts.repository.js');
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
      _configsRepo = mysqlMechaConfigRepo;
    } catch (err) {
      if (!allowDevelopmentJsonFallback()) throw err;
      const { jsonMechaConfigRepo } = await import('./store-parts.js');
      _configsRepo = jsonMechaConfigRepo;
    }
  }
  return _configsRepo;
}

export function resetMechaConfigRepo(): void {
  _configsRepo = null;
}

// ─── ResearchRepository ──────────────────────────

let _researchRepo: ResearchRepository | null = null;

export async function getResearchRepo(): Promise<ResearchRepository> {
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresResearchRepo } = await import('./db/postgres-research.repository.js');
    return postgresResearchRepo;
  }
  if (!_researchRepo) {
    if (process.env.DB_DRIVER === 'json') {
      const { jsonResearchRepo } = await import('./store-research.js');
      _researchRepo = jsonResearchRepo;
      return _researchRepo;
    }
    try {
      const { mysqlResearchRepo } = await import('./db/mysql-research.repository.js');
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
      _researchRepo = mysqlResearchRepo;
    } catch (err) {
      if (!allowDevelopmentJsonFallback()) throw err;
      const { jsonResearchRepo } = await import('./store-research.js');
      _researchRepo = jsonResearchRepo;
    }
  }
  return _researchRepo;
}

export function resetResearchRepo(): void {
  _researchRepo = null;
}

// ─── CraftingRepository ──────────────────────────

let _craftingRepo: CraftingRepository | null = null;

export async function getCraftingRepo(): Promise<CraftingRepository> {
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresCraftingRepo } = await import('./db/postgres-crafting.repository.js');
    return postgresCraftingRepo;
  }
  if (!_craftingRepo) {
    if (process.env.DB_DRIVER === 'json') {
      const { jsonCraftingRepo } = await import('./store-crafting.js');
      _craftingRepo = jsonCraftingRepo;
      return _craftingRepo;
    }
    try {
      const { mysqlCraftingRepo } = await import('./db/mysql-crafting.repository.js');
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
      _craftingRepo = mysqlCraftingRepo;
    } catch (err) {
      if (!allowDevelopmentJsonFallback()) throw err;
      const { jsonCraftingRepo } = await import('./store-crafting.js');
      _craftingRepo = jsonCraftingRepo;
    }
  }
  return _craftingRepo;
}

export function resetCraftingRepo(): void {
  _craftingRepo = null;
}

// ─── BattleRepository ───────────────────────────

let _battleRepo: BattleRepository | null = null;

export async function getBattleRepo(): Promise<BattleRepository> {
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresBattleRepo } = await import('./db/postgres-battle.repository.js');
    return postgresBattleRepo;
  }
  if (!_battleRepo) {
    if (process.env.DB_DRIVER === 'json') {
      const { jsonBattleRepo } = await import('./store-battle.js');
      _battleRepo = jsonBattleRepo;
      return _battleRepo;
    }
    try {
      const { mysqlBattleRepo } = await import('./db/mysql-battle.repository.js');
      const { getPool } = await import('./db/connection.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
      _battleRepo = mysqlBattleRepo;
    } catch (err) {
      if (!allowDevelopmentJsonFallback()) throw err;
      const { jsonBattleRepo } = await import('./store-battle.js');
      _battleRepo = jsonBattleRepo;
    }
  }
  return _battleRepo;
}

export function resetBattleRepo(): void {
  _battleRepo = null;
}

// ─── AdminRepository ────────────────────────────

let _adminRepo: AdminRepository | null = null;

export async function getAdminRepo(): Promise<AdminRepository> {
  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresAdminRepo } = await import('./db/postgres-admin.repository.js');
    return postgresAdminRepo;
  }
  if (!_adminRepo) {
    if (process.env.DB_DRIVER === 'json') {
      const { jsonAdminRepo } = await import('./store-admin.js');
      _adminRepo = jsonAdminRepo;
      return _adminRepo;
    }
    try {
      const { mysqlAdminRepo } = await import('./db/mysql-admin.repository.js');
      const { getPool } = await import('./db/connection.js');
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeout]);
      _adminRepo = mysqlAdminRepo;
    } catch (err) {
      if (!allowDevelopmentJsonFallback()) throw err;
      const { jsonAdminRepo } = await import('./store-admin.js');
      _adminRepo = jsonAdminRepo;
    }
  }
  return _adminRepo;
}

export function resetAdminRepo(): void {
  _adminRepo = null;
}

/** 모든 저장소 일괄 리셋 (테스트 전용) */
export function resetAllRepos(): void {
  _repo = null;
  _authRepo = null;
  _authRepoMode = null;
  _walletRepo = null;
  _walletRepoMode = null;
  _partsRepo = null;
  _configsRepo = null;
  _researchRepo = null;
  _craftingRepo = null;
  _battleRepo = null;
  _adminRepo = null;
}
