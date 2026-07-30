/**
 * MySQL 기반 Auth 저장소
 *
 * DB_DRIVER=mysql 또는 MySQL 연결 가능 시 provider.ts에서 로드됨.
 * users + playerProfiles + walletBalances 생성을 트랜잭션으로 처리.
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from './connection.js';
import { users, playerProfiles, walletBalances, refreshSessions, accountSanctions } from './schema.js';
import type { User, RefreshSession, Sanction, PlayerProfile } from '../types.js';
import type { AuthRepository, PlayerProfile as ProfileType, WalletBalance as WalletType } from '../repository.js';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

// ─── row → type 변환 헬퍼 ──────────────────────────

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id, email: row.email, nickname: row.nickname,
    passwordHash: row.passwordHash, status: row.status, role: row.role,
    suspendedAt: row.suspendedAt?.toISOString(), suspendedReason: row.suspendedReason ?? undefined,
    refreshToken: row.refreshToken ?? undefined,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── AuthRepository 구현 ────────────────────────────

export const mysqlAuthRepo: AuthRepository = {
  async createUser(user: User): Promise<User> {
    const db = getDb();
    await db.insert(users).values({
      id: user.id, email: user.email, nickname: user.nickname,
      passwordHash: user.passwordHash, status: user.status, role: user.role,
      createdAt: new Date(user.createdAt), updatedAt: new Date(user.updatedAt),
    });
    return user;
  },

  async createProfile(profile: ProfileType): Promise<ProfileType> {
    const db = getDb();
    await db.insert(playerProfiles).values({
      id: profile.id, playerId: profile.playerId, userId: profile.userId,
      nickname: profile.nickname, highestStage: profile.highestStage,
      createdAt: new Date(profile.createdAt), updatedAt: new Date(profile.updatedAt),
    });
    return profile;
  },

  async createWallet(wallet: WalletType): Promise<WalletType> {
    const db = getDb();
    await db.insert(walletBalances).values({
      id: wallet.id, playerId: wallet.playerId, userId: wallet.userId,
      electricity: wallet.electricity, electricityPerSecond: wallet.electricityPerSecond,
      balance: wallet.balance, lastClaimedAt: new Date(wallet.lastClaimedAt),
      createdAt: new Date(wallet.createdAt), updatedAt: new Date(wallet.updatedAt),
    });
    return wallet;
  },

  async findUserByEmail(email: string): Promise<User | undefined> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows.length > 0 ? toUser(rows[0]) : undefined;
  },

  async findUserByNickname(nickname: string): Promise<User | undefined> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.nickname, nickname)).limit(1);
    return rows.length > 0 ? toUser(rows[0]) : undefined;
  },

  async findUserById(id: string): Promise<User | undefined> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows.length > 0 ? toUser(rows[0]) : undefined;
  },

  async findProfileByUserId(userId: string): Promise<PlayerProfile | undefined> {
    const db = getDb();
    const rows = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      id: r.id, playerId: r.playerId, userId: r.userId,
      nickname: r.nickname, highestStage: r.highestStage,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    };
  },

  async findActiveSanctions(userId: string): Promise<Sanction[]> {
    const db = getDb();
    const rows = await db.select().from(accountSanctions)
      .where(and(
        eq(accountSanctions.userId, userId),
        eq(accountSanctions.type, 'suspension'),
        eq(accountSanctions.status, 'active'),
      ))
      .limit(1);
    return rows.map((r) => ({
      id: r.id, userId: r.userId, type: r.type, status: r.status,
      reasonText: r.reasonText,
      startsAt: r.startsAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  },

  async createSession(session: RefreshSession): Promise<RefreshSession> {
    const db = getDb();
    await db.insert(refreshSessions).values({
      id: session.id, userId: session.userId,
      tokenHash: session.tokenHash,
      expiresAt: new Date(session.expiresAt),
      createdAt: new Date(session.createdAt),
    });
    return session;
  },

  async findSessionByTokenHash(tokenHash: string): Promise<RefreshSession | undefined> {
    const db = getDb();
    const rows = await db.select().from(refreshSessions).where(eq(refreshSessions.tokenHash, tokenHash)).limit(1);
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      id: r.id, userId: r.userId, tokenHash: r.tokenHash,
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  },

  async revokeSession(tokenHash: string): Promise<void> {
    const db = getDb();
    await db.update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.tokenHash, tokenHash));
  },
};

/**
 * 회원가입: users + playerProfiles + walletBalances 를 트랜잭션으로 생성
 * MySQL 전용 최적화. JSON 모드는 store-auth.ts에서 순차 저장.
 */
export async function registerUserTransaction(
  email: string,
  nickname: string,
  passwordHash: string,
): Promise<{ userId: string; playerId: string }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const userId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const now = new Date();

    await tx.insert(users).values({
      id: userId, email, nickname, passwordHash,
      status: 'active', role: 'user',
      createdAt: now, updatedAt: now,
    });
    await tx.insert(playerProfiles).values({
      id: crypto.randomUUID(), playerId, userId, nickname,
      highestStage: 1, createdAt: now, updatedAt: now,
    });
    await tx.insert(walletBalances).values({
      id: crypto.randomUUID(), playerId, userId,
      electricity: 0, electricityPerSecond: 1, balance: 0,
      lastClaimedAt: now, createdAt: now, updatedAt: now,
    });

    logger.info({ userId, playerId, email, event: 'register' }, 'User registered');
    return { userId, playerId };
  }).catch((err) => {
    if ((err as { errno?: number }).errno === 1062) {
      throw new AppError('이미 사용 중인 이메일 또는 닉네임입니다.', 409, 'DUPLICATE_ACCOUNT');
    }
    throw err;
  });
}
