/**
 * 저장소 공통 인터페이스
 *
 * JSON 파일 구현체: store.ts, store-auth.ts, store-wallet.ts
 * MySQL 구현체: db/mysql.repository.ts, db/mysql-auth.repository.ts, db/mysql-wallet.repository.ts
 */
import type { Player, User, RefreshSession, Sanction } from './types.js';

export interface PlayerRepository {
  createPlayer(player: Player): Promise<Player>;
  getPlayer(id: string): Promise<Player | undefined>;
  getAllPlayers(): Promise<Player[]>;
  updatePlayer(id: string, updates: Partial<Player>): Promise<Player | undefined>;
  deletePlayer(id: string): Promise<boolean>;
}

export interface PlayerProfile {
  id: string;
  playerId: string;
  userId: string;
  nickname: string;
  highestStage: number;
  createdAt: string;
  updatedAt: string;
}

export interface WalletBalance {
  id: string;
  playerId: string;
  userId: string;
  currency?: string;
  electricity: number;
  electricityPerSecond: number;
  scrap?: number;
  balance: number;
  lastClaimedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Auth 저장소 — 회원가입·로그인에 필요한 모든 데이터 CRUD
 * MySQL 구현체: 트랜잭션 사용
 * JSON 구현체: 순차 저장
 */
export interface AuthRepository {
  createUser(user: User): Promise<User>;
  createProfile(profile: PlayerProfile): Promise<PlayerProfile>;
  createWallet(wallet: WalletBalance): Promise<WalletBalance>;
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserById(id: string): Promise<User | undefined>;
  findProfileByUserId(userId: string): Promise<PlayerProfile | undefined>;
  findActiveSanctions(userId: string): Promise<Sanction[]>;
  createSession(session: RefreshSession): Promise<RefreshSession>;
  findSessionByTokenHash(tokenHash: string): Promise<RefreshSession | undefined>;
  revokeSession(tokenHash: string): Promise<void>;
}

// ─── 재화(Wallet) ─────────────────────────────────

export interface BalanceResult {
  playerId: string;
  currency: string;
  balance: number;
  electricityPerSecond: number;
  lastClaimedAt: string;
}

export interface LedgerEntry {
  id: string;
  playerId: string;
  currency: string;
  amount: number;
  balanceAfter: number;
  source: string;
  createdAt: string;
}

export interface AdjustBalanceParams {
  playerId: string;
  amount: number;
  source: string;
  idempotencyKey: string;
  currency?: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
}

export interface WalletRepository {
  getBalance(playerId: string): Promise<BalanceResult | null>;
  adjustBalance(params: AdjustBalanceParams): Promise<{ balanceAfter: number; success: boolean }>;
  updateEps(playerId: string, newEps: number): Promise<void>;
  updateLastClaimedAt(playerId: string, claimedAt: string): Promise<void>;
  getLedger(playerId: string, limit?: number): Promise<LedgerEntry[]>;
}

// ─── 파츠(Part) ───────────────────────────────────

export interface PartsRepository {
  /** 플레이어의 파츠 인벤토리 조회 */
  getInventory(playerId: string): Promise<PlayerPart[]>;
  /** 파츠 보유 여부 확인 */
  hasPart(playerId: string, partCode: string): Promise<boolean>;
  /** 새 파츠 지급 */
  grantPart(playerId: string, partCode: string, partType: string): Promise<PlayerPart>;
  /** 파츠 장착/해제 */
  equipPart(playerId: string, partCode: string, partType: string): Promise<void>;
  /** 현재 장착 상태 조회 */
  getEquipped(playerId: string): Promise<EquipSlot | null>;
  /** 파츠 레벨업 */
  upgradePart(playerId: string, partCode: string): Promise<PlayerPart>;
}

import type { PlayerPart, EquipSlot, MechaConfig } from './types.js';

// ─── MechaConfig ────────────────────────────────

export interface MechaConfigRepository {
  getConfigs(playerId: string): Promise<MechaConfig[]>;
  createConfig(playerId: string, name: string, frame: string, weapon: string, core: string, module: string): Promise<MechaConfig>;
  updateConfig(id: string, updates: Partial<Omit<MechaConfig, 'id' | 'playerId' | 'createdAt'>>): Promise<MechaConfig | null>;
  activateConfig(id: string, playerId: string): Promise<MechaConfig | null>;
  deleteConfig(id: string, playerId: string): Promise<boolean>;
  getActiveConfig(playerId: string): Promise<MechaConfig | null>;
}
