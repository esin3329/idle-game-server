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

// ─── Research ────────────────────────────────────

export interface ResearchRepository {
  /** 플레이어의 모든 연구 상태 조회 */
  getAll(playerId: string): Promise<PlayerResearch[]>;
  /** 특정 연구 조회 */
  get(playerId: string, code: string): Promise<PlayerResearch | null>;
  /** 연구 레벨업 (1 증가) */
  levelUp(playerId: string, code: string): Promise<PlayerResearch>;
  /** 연구 초기화 (모든 연구 level=0) */
  reset(playerId: string): Promise<void>;
}

import type { PlayerResearch } from './types.js';

// ─── Crafting ────────────────────────────────────

export interface CraftingRepository {
  /** 보유 설계도 목록 */
  getBlueprints(playerId: string): Promise<PlayerBlueprint[]>;
  /** 설계도 보유 여부 */
  hasBlueprint(playerId: string, blueprintCode: string): Promise<boolean>;
  /** 설계도 획득 */
  grantBlueprint(playerId: string, blueprintCode: string): Promise<PlayerBlueprint>;
  /** 제작 대기열 조회 */
  getQueue(playerId: string): Promise<PartCrafting[]>;
  /** 제작 시작 */
  startCraft(playerId: string, blueprintCode: string): Promise<PartCrafting>;
  /** 완료된 제작 확인 (완료 시 파츠 지급) */
  completeCraft(playerId: string, craftId: string): Promise<{ partId: string; partCode: string }>;
  /** 완료 가능한 제작 목록 */
  getCompletable(playerId: string): Promise<PartCrafting[]>;
}

import type { PlayerBlueprint, PartCrafting } from './types.js';

// ─── Battle (전투 세션) ─────────────────────────

export interface BattleRepository {
  getStage(stageId: string): Promise<any>;
  getStages(): Promise<any[]>;
  getStageRewards(stageId: string): Promise<any[]>;
  getMechStats(playerId: string): Promise<any>;
  createMechStats(playerId: string, stats: any): Promise<void>;
  getActiveSanctions(playerId: string): Promise<any[]>;
  getActiveSessions(playerId: string): Promise<any[]>;
  abandonSession(sessionId: string): Promise<void>;
  createSession(session: any): Promise<void>;
  getSession(sessionId: string): Promise<any>;
  updateSession(sessionId: string, data: Record<string, unknown>): Promise<void>;
  saveBattleEvent(event: any): Promise<void>;
  getUpgradeOffers(sessionId: string): Promise<any[]>;
  saveUpgradeOffer(offer: any): Promise<void>;
  createBattleResult(result: any): Promise<void>;
  getBattleResult(sessionId: string): Promise<any>;
  getWalletBalance(playerId: string): Promise<any>;
  updateWalletElectricity(playerId: string, amount: number): Promise<void>;
  updateWalletScrap(playerId: string, amount: number): Promise<void>;
  insertCurrencyLedger(entry: any): Promise<void>;
  getPlayerRecord(playerId: string, stageId: string): Promise<any>;
  upsertPlayerRecord(record: any): Promise<void>;
  getPlayerStageProgress(playerId: string, stageId: string): Promise<any>;
  upsertPlayerStageProgress(progress: any): Promise<void>;
  createSecurityEvent(event: any): Promise<void>;
}

// ─── Admin (운영 API) ────────────────────────────

export interface UserSummary {
  id: string; email: string; nickname: string;
  status: string; role: string; createdAt: string;
}

export interface WalletSummary {
  playerId: string; electricity: number; scrap: number;
  electricityPerSecond: number; lastClaimedAt: string;
}

export interface AdminRepository {
  listUsers(limit: number, offset: number, search?: string, status?: string): Promise<{ users: UserSummary[]; total: number }>;
  getUserDetail(userId: string): Promise<any>;
  getUserWallet(userId: string): Promise<WalletSummary | null>;
  getUserLedger(userId: string, limit?: number): Promise<any[]>;
  getUserBattles(userId: string, limit?: number): Promise<any[]>;
  getUserSanctions(userId: string): Promise<any[]>;
  createSanction(data: any): Promise<any>;
  revokeSanction(sanctionId: string, operatorId: string, reason?: string): Promise<void>;
  createGrant(data: any): Promise<any>;
  listGrants(limit?: number, offset?: number, targetUserId?: string): Promise<any[]>;
  listOperators(): Promise<any[]>;
  createOperator(data: any): Promise<any>;
  changeOperatorRole(operatorId: string, newRole: string): Promise<any>;
  listSecurityEvents(limit?: number, offset?: number, eventType?: string): Promise<any[]>;
  reviewSecurityEvent(eventId: string, operatorId: string, resolution: string, note?: string): Promise<void>;
  listAuditLogs(limit?: number, action?: string): Promise<any[]>;
  suspendUser(userId: string, operatorId: string, reason: string): Promise<void>;
  unsuspendUser(userId: string, operatorId: string, reason: string): Promise<void>;
  checkPermission(roleCode: string, permissionCode: string): Promise<boolean>;
}
