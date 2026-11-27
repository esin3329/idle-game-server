/**
 * 저장소 provider — DB_DRIVER 환경변수에 따라 PostgreSQL(Supabase) 또는 JSON 저장소 선택
 *
 * DB_DRIVER=postgres → PostgreSQL
 * DB_DRIVER=json     → JSON 파일 (개발/테스트 전용)
 * 미설정             → 프로덕션 또는 DATABASE_URL 존재 시 PostgreSQL, 그 외 JSON
 */
import type {
  PlayerRepository,
  AuthRepository,
  WalletRepository,
  PartsRepository,
  MechaConfigRepository,
  ResearchRepository,
  CraftingRepository,
  BattleRepository,
  AdminRepository,
} from './repository.js';

function usePostgres(): boolean {
  const driver = process.env.DB_DRIVER;
  if (driver === 'mysql') {
    throw new Error('MySQL driver has been removed. Use DB_DRIVER=postgres or DB_DRIVER=json.');
  }
  if (driver === 'postgres') return true;
  if (driver === 'json') return false;
  if (process.env.NODE_ENV === 'production') return true;
  return Boolean(process.env.DATABASE_URL);
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

let _repo: PlayerRepository | null = null;

export async function getRepo(): Promise<PlayerRepository> {
  if (usePostgres()) {
    const { postgresPlayerRepo } = await import('./db/postgres.repository.js');
    return postgresPlayerRepo;
  }
  _repo ??= await loadJsonRepo();
  return _repo;
}

export function resetRepo(): void {
  _repo = null;
}

// ─── AuthRepository ───────────────────────────────

let _authRepo: AuthRepository | null = null;

export async function getAuthRepo(): Promise<AuthRepository> {
  if (usePostgres()) {
    const { postgresAuthRepo } = await import('./db/postgres-auth.repository.js');
    return postgresAuthRepo;
  }
  if (!_authRepo) {
    const { jsonAuthRepo } = await import('./store-auth.js');
    _authRepo = jsonAuthRepo;
  }
  return _authRepo;
}

export function getAuthRepoMode(): 'json' | 'postgres' {
  return usePostgres() ? 'postgres' : 'json';
}

export function resetAuthRepo(): void {
  _authRepo = null;
}

// ─── WalletRepository ────────────────────────────

let _walletRepo: WalletRepository | null = null;

export async function getWalletRepo(): Promise<WalletRepository> {
  if (usePostgres()) {
    const { postgresWalletRepo } = await import('./db/postgres-wallet.repository.js');
    return postgresWalletRepo;
  }
  if (!_walletRepo) {
    const { jsonWalletRepo } = await import('./store-wallet.js');
    _walletRepo = jsonWalletRepo;
  }
  return _walletRepo;
}

export function getWalletRepoMode(): 'json' | 'postgres' {
  return usePostgres() ? 'postgres' : 'json';
}

export function resetWalletRepo(): void {
  _walletRepo = null;
}

// ─── PartsRepository ────────────────────────────

let _partsRepo: PartsRepository | null = null;

export async function getPartsRepo(): Promise<PartsRepository> {
  if (usePostgres()) {
    const { postgresPartsRepo } = await import('./db/postgres-parts.repository.js');
    return postgresPartsRepo;
  }
  if (!_partsRepo) {
    const { jsonPartsRepo } = await import('./store-parts.js');
    _partsRepo = jsonPartsRepo;
  }
  return _partsRepo;
}

export function resetPartsRepo(): void {
  _partsRepo = null;
}

// ─── MechaConfigRepository ───────────────────────

let _configsRepo: MechaConfigRepository | null = null;

export async function getMechaConfigRepo(): Promise<MechaConfigRepository> {
  if (usePostgres()) {
    const { postgresMechaConfigRepo } = await import('./db/postgres-parts.repository.js');
    return postgresMechaConfigRepo;
  }
  if (!_configsRepo) {
    const { jsonMechaConfigRepo } = await import('./store-parts.js');
    _configsRepo = jsonMechaConfigRepo;
  }
  return _configsRepo;
}

export function resetMechaConfigRepo(): void {
  _configsRepo = null;
}

// ─── ResearchRepository ──────────────────────────

let _researchRepo: ResearchRepository | null = null;

export async function getResearchRepo(): Promise<ResearchRepository> {
  if (usePostgres()) {
    const { postgresResearchRepo } = await import('./db/postgres-research.repository.js');
    return postgresResearchRepo;
  }
  if (!_researchRepo) {
    const { jsonResearchRepo } = await import('./store-research.js');
    _researchRepo = jsonResearchRepo;
  }
  return _researchRepo;
}

export function resetResearchRepo(): void {
  _researchRepo = null;
}

// ─── CraftingRepository ──────────────────────────

let _craftingRepo: CraftingRepository | null = null;

export async function getCraftingRepo(): Promise<CraftingRepository> {
  if (usePostgres()) {
    const { postgresCraftingRepo } = await import('./db/postgres-crafting.repository.js');
    return postgresCraftingRepo;
  }
  if (!_craftingRepo) {
    const { jsonCraftingRepo } = await import('./store-crafting.js');
    _craftingRepo = jsonCraftingRepo;
  }
  return _craftingRepo;
}

export function resetCraftingRepo(): void {
  _craftingRepo = null;
}

// ─── BattleRepository ───────────────────────────

let _battleRepo: BattleRepository | null = null;

export async function getBattleRepo(): Promise<BattleRepository> {
  if (usePostgres()) {
    const { postgresBattleRepo } = await import('./db/postgres-battle.repository.js');
    return postgresBattleRepo;
  }
  if (!_battleRepo) {
    const { jsonBattleRepo } = await import('./store-battle.js');
    _battleRepo = jsonBattleRepo;
  }
  return _battleRepo;
}

export function resetBattleRepo(): void {
  _battleRepo = null;
}

// ─── AdminRepository ────────────────────────────

let _adminRepo: AdminRepository | null = null;

export async function getAdminRepo(): Promise<AdminRepository> {
  if (usePostgres()) {
    const { postgresAdminRepo } = await import('./db/postgres-admin.repository.js');
    return postgresAdminRepo;
  }
  if (!_adminRepo) {
    const { jsonAdminRepo } = await import('./store-admin.js');
    _adminRepo = jsonAdminRepo;
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
  _walletRepo = null;
  _partsRepo = null;
  _configsRepo = null;
  _researchRepo = null;
  _craftingRepo = null;
  _battleRepo = null;
  _adminRepo = null;
}
