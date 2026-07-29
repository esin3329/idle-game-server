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
