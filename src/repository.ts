/**
 * 저장소 공통 인터페이스
 *
 * JSON 파일 구현체: store.ts, store-users.ts
 * MySQL 구현체: db/mysql.repository.ts, db/mysql-user.repository.ts
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
  electricity: number;
  electricityPerSecond: number;
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
