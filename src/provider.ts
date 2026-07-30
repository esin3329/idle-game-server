/**
 * 저장소 provider — DB_DRIVER 환경변수에 따라 JSON 또는 MySQL 선택
 *
 * DB_DRIVER=mysql → MySQL
 * 그 외          → JSON 파일 (기본값)
 */
import type { PlayerRepository, AuthRepository, WalletRepository, PartsRepository, MechaConfigRepository, ResearchRepository, CraftingRepository } from './repository.js';

// ─── PlayerRepository ─────────────────────────────

async function loadJsonRepo(): Promise<PlayerRepository> {
  const { createPlayer, getPlayer, getAllPlayers, updatePlayer, deletePlayer } = await import('./store.js');
  return {
    createPlayer: async (p) => {
      const player = createPlayer(p);
      // wallet_balances도 함께 생성 (adjustBalance 호환)
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
      } catch { /* best effort */ }
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
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
      await Promise.race([getPool().query('SELECT 1'), timeoutPromise]);
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
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MySQL unavailable for wallet repo (${msg}), falling back to JSON store.`);
      _walletRepo = await loadJsonWalletRepo();
      _walletRepoMode = 'json';
    }
  }
  return _walletRepo;
}

/** 현재 Wallet 저장소 모드 반환 */
export function getWalletRepoMode(): 'json' | 'mysql' {
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
    } catch {
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
    } catch {
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
    } catch {
      const { jsonCraftingRepo } = await import('./store-crafting.js');
      _craftingRepo = jsonCraftingRepo;
    }
  }
  return _craftingRepo;
}

export function resetCraftingRepo(): void {
  _craftingRepo = null;
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
}
