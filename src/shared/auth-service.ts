import { compare, hash } from 'bcryptjs';
import { sign, verify } from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { users, playerProfiles, walletBalances, refreshSessions } from '../db/schema.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

const SALT_ROUNDS = 10;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function jwtSecret(name: string): string {
  return process.env[name] || 'dev-secret-change-in-production';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function parseExpires(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // 기본 7일
  const n = parseInt(match[1], 10);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return n * (unit || 86400000);
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  userId: string;
  playerId: string;
  tokens: TokenPair;
}

// ─── 토큰 발급 ──────────────────────────────────────

const M = {
  s: 1, m: 60, h: 3600, d: 86400,
} as const;

function parseExpiresSeconds(expiresIn: string): number {
  const m = expiresIn.match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 86400;
  return parseInt(m[1], 10) * (M[m[2] as keyof typeof M] || 86400);
}

function issueTokens(userId: string): TokenPair {
  const accessSec = parseExpiresSeconds(ACCESS_EXPIRES);
  const refreshSec = parseExpiresSeconds(REFRESH_EXPIRES);
  return {
    accessToken: sign({ sub: userId, type: 'access' }, jwtSecret('JWT_ACCESS_SECRET'), { expiresIn: accessSec }),
    refreshToken: sign({ sub: userId, type: 'refresh', jti: crypto.randomUUID() }, jwtSecret('JWT_REFRESH_SECRET'), { expiresIn: refreshSec }),
  };
}

// ─── 회원가입 (user + profile + wallet + session 트랜잭션) ──

export async function registerUser(email: string, password: string, nickname: string): Promise<AuthResult> {
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const userId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const passwordHash = await hash(password, SALT_ROUNDS);
    const now = new Date();

    await tx.insert(users).values({ id: userId, email, nickname, passwordHash, status: 'active', createdAt: now, updatedAt: now });
    await tx.insert(playerProfiles).values({ id: crypto.randomUUID(), playerId, userId, nickname, createdAt: now, updatedAt: now });
    await tx.insert(walletBalances).values({ id: crypto.randomUUID(), playerId, userId, electricity: 0, electricityPerSecond: 1, balance: 0, lastClaimedAt: now, createdAt: now, updatedAt: now });

    logger.info({ userId, playerId, email, event: 'register' }, 'User registered');
    return { userId, playerId };
  }).catch((err) => {
    if ((err as { errno?: number }).errno === 1062) { // ER_DUP_ENTRY
      throw new AppError('이미 사용 중인 이메일 또는 닉네임입니다.', 409, 'DUPLICATE_ACCOUNT');
    }
    throw err;
  });

  const tokens = issueTokens(result.userId);
  await storeRefreshSession(result.userId, tokens.refreshToken);
  return { userId: result.userId, playerId: result.playerId, tokens };
}

// ─── 로그인 ─────────────────────────────────────────

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  const db = getDb();

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (rows.length === 0) {
    throw new AppError('이메일 또는 비밀번호가 일치하지 않습니다.', 401, 'INVALID_CREDENTIALS');
  }

  const user = rows[0];

  if (!(await compare(password, user.passwordHash))) {
    throw new AppError('이메일 또는 비밀번호가 일치하지 않습니다.', 401, 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    throw new AppError('비활성화된 계정입니다.', 403, 'ACCOUNT_DISABLED');
  }

  const profiles = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, user.id)).limit(1);
  const playerId = profiles.length > 0 ? profiles[0].playerId : '';

  const tokens = issueTokens(user.id);
  await storeRefreshSession(user.id, tokens.refreshToken);

  logger.info({ userId: user.id, email, event: 'login' }, 'User logged in');
  return { userId: user.id, playerId, tokens };
}

// ─── 토큰 갱신 (rotation) ───────────────────────────

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const db = getDb();
  const now = new Date();
  const tokenHash = sha256(refreshToken);

  // 1. JWT 서명 검증
  let payload: { sub: string; jti: string };
  try {
    payload = verify(refreshToken, jwtSecret('JWT_REFRESH_SECRET')) as { sub: string; jti: string };
  } catch {
    throw new AppError('유효하지 않은 토큰입니다.', 401, 'INVALID_TOKEN');
  }

  // 2. DB에서 해시 조회 → 존재 + 만료 안 됨 + 취소 안 됨
  const sessions = await db.select().from(refreshSessions)
    .where(eq(refreshSessions.tokenHash, tokenHash))
    .limit(1);

  if (sessions.length === 0 || sessions[0].revokedAt !== null || sessions[0].expiresAt < now) {
    throw new AppError('만료되었거나 취소된 토큰입니다.', 401, 'TOKEN_EXPIRED');
  }

  // 3. 기존 토큰 폐기 (revoke)
  await db.update(refreshSessions).set({ revokedAt: now }).where(eq(refreshSessions.tokenHash, tokenHash));

  // 4. 새 토큰 발급 + 저장
  const tokens = issueTokens(payload.sub);
  await storeRefreshSession(payload.sub, tokens.refreshToken);

  return tokens;
}

// ─── 세션 저장 ──────────────────────────────────────

/** 로그아웃: Refresh Token 폐기 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const db = getDb();
  const tokenHash = sha256(refreshToken);
  await db.update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.tokenHash, tokenHash));
  logger.info('Refresh token revoked');
}

async function storeRefreshSession(userId: string, refreshToken: string): Promise<void> {
  const db = getDb();
  const tokenHash = sha256(refreshToken);
  const expiresMs = parseExpires(REFRESH_EXPIRES);
  const expiresAt = new Date(Date.now() + expiresMs);

  await db.insert(refreshSessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
  });
}
