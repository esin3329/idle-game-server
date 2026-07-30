import { hashPassword, comparePassword, isWorkerEnabled } from '../worker.js';
import { compare, hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { getAuthRepo, getAuthRepoMode } from '../provider.js';
import { AppError } from './errors.js';
import { logger, auditLog } from './logger.js';

const SALT_ROUNDS = 10;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function jwtSecret(name: string): string {
  return process.env[name] || 'dev-secret-change-in-production';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
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

const M = { s: 1, m: 60, h: 3600, d: 86400 } as const;

function parseExpiresSeconds(expiresIn: string): number {
  const m = expiresIn.match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 86400;
  return parseInt(m[1], 10) * (M[m[2] as keyof typeof M] || 86400);
}

function issueTokens(userId: string, role: string = 'user'): TokenPair {
  const accessSec = parseExpiresSeconds(ACCESS_EXPIRES);
  const refreshSec = parseExpiresSeconds(REFRESH_EXPIRES);
  return {
    accessToken: jwt.sign(
      { sub: userId, type: 'access', role },
      jwtSecret('JWT_ACCESS_SECRET'),
      { expiresIn: accessSec },
    ),
    refreshToken: jwt.sign(
      { sub: userId, type: 'refresh', role, jti: crypto.randomUUID() },
      jwtSecret('JWT_REFRESH_SECRET'),
      { expiresIn: refreshSec },
    ),
  };
}

// ─── 회원가입 ──────────────────────────────────────

export async function registerUser(email: string, password: string, nickname: string): Promise<AuthResult> {
  const mode = getAuthRepoMode();

  let userId: string;
  let playerId: string;

  if (mode === 'mysql') {
    // MySQL: 트랜잭션 최적화
    const { registerUserTransaction } = await import('../db/mysql-auth.repository.js');
    const passwordHash = isWorkerEnabled() ? await hashPassword(password, SALT_ROUNDS) : await hash(password, SALT_ROUNDS);
    const result = await registerUserTransaction(email, nickname, passwordHash);
    userId = result.userId;
    playerId = result.playerId;
  } else {
    // JSON: 순차 저장 (중복 검사 포함)
    const repo = await getAuthRepo();

    const existingEmail = await repo.findUserByEmail(email);
    if (existingEmail) {
      throw new AppError('이미 사용 중인 이메일입니다.', 409, 'DUPLICATE_ACCOUNT');
    }

    // TODO: 닉네임 중복 검사 — store-auth에 findUserByNickname 추가 필요

    userId = crypto.randomUUID();
    playerId = crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordHash = isWorkerEnabled() ? await hashPassword(password, SALT_ROUNDS) : await hash(password, SALT_ROUNDS);

    await repo.createUser({
      id: userId, email, nickname, passwordHash,
      status: 'active', role: 'user',
      createdAt: now, updatedAt: now,
    });

    await repo.createProfile({
      id: crypto.randomUUID(), playerId, userId, nickname,
      highestStage: 1, createdAt: now, updatedAt: now,
    });

    await repo.createWallet({
      id: crypto.randomUUID(), playerId, userId,
      electricity: 0, electricityPerSecond: 1, balance: 0,
      lastClaimedAt: now, createdAt: now, updatedAt: now,
    });

    logger.info({ userId, playerId, email, event: 'register' }, 'User registered');
  }

  const tokens = issueTokens(userId, 'user');
  await storeRefreshSession(userId, tokens.refreshToken);
  return { userId, playerId, tokens };
}

// ─── 로그인 ─────────────────────────────────────────

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  const repo = await getAuthRepo();

  const user = await repo.findUserByEmail(email);
  if (!user) {
    auditLog.warn({ email, event: 'login_failed', reason: 'unknown_email' }, `Login failed: ${email}`);
    throw new AppError('이메일 또는 비밀번호가 일치하지 않습니다.', 401, 'INVALID_CREDENTIALS');
  }

  const passwordMatch = isWorkerEnabled() ? await comparePassword(password, user.passwordHash) : await compare(password, user.passwordHash);
  if (!passwordMatch) {
    auditLog.warn({ userId: user.id, email, event: 'login_failed', reason: 'wrong_password' }, `Login failed (password): ${email}`);
    throw new AppError('이메일 또는 비밀번호가 일치하지 않습니다.', 401, 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    throw new AppError('비활성화된 계정입니다.', 403, 'ACCOUNT_DISABLED');
  }

  // 제재 확인
  const activeSanctions = await repo.findActiveSanctions(user.id);
  if (activeSanctions.length > 0) {
    throw new AppError('제재된 계정입니다.', 403, 'ACCOUNT_SUSPENDED');
  }

  // 플레이어 ID 조회
  const profile = await repo.findProfileByUserId(user.id);
  const playerId = profile?.playerId || '';

  const tokens = issueTokens(user.id, user.role || 'user');
  await storeRefreshSession(user.id, tokens.refreshToken);

  if (user.role === 'operator' || user.role === 'admin') {
    auditLog.warn({ operatorId: user.id, email, event: 'operator_login' }, `Operator login: ${email}`);
  }

  logger.info({ userId: user.id, email, event: 'login' }, 'User logged in');
  return { userId: user.id, playerId, tokens };
}

// ─── 토큰 갱신 (rotation) ───────────────────────────

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const repo = await getAuthRepo();
  const now = new Date();
  const tokenHash = sha256(refreshToken);

  // 1. JWT 서명 검증
  let payload: { sub: string; jti: string; role?: string };
  try {
    payload = jwt.verify(refreshToken, jwtSecret('JWT_REFRESH_SECRET')) as { sub: string; jti: string; role?: string };
  } catch {
    throw new AppError('유효하지 않은 토큰입니다.', 401, 'INVALID_TOKEN');
  }

  // 2. DB에서 해시 조회 → 존재 + 만료 안 됨 + 취소 안 됨
  const session = await repo.findSessionByTokenHash(tokenHash);
  if (!session || session.revokedAt !== undefined || new Date(session.expiresAt) < now) {
    throw new AppError('만료되었거나 취소된 토큰입니다.', 401, 'TOKEN_EXPIRED');
  }

  // 3. 기존 토큰 폐기
  await repo.revokeSession(tokenHash);

  // 4. 새 토큰 발급 + 저장
  const tokens = issueTokens(payload.sub, payload.role || 'user');
  await storeRefreshSession(payload.sub, tokens.refreshToken);

  return tokens;
}

// ─── 세션 저장 / 로그아웃 ───────────────────────────

/** 로그아웃: Refresh Token 폐기 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const repo = await getAuthRepo();
  const tokenHash = sha256(refreshToken);
  await repo.revokeSession(tokenHash);
  logger.info('Refresh token revoked');
}

async function storeRefreshSession(userId: string, refreshToken: string): Promise<void> {
  const repo = await getAuthRepo();
  const tokenHash = sha256(refreshToken);
  const expiresMs = parseExpiresSeconds(REFRESH_EXPIRES) * 1000;
  const expiresAt = new Date(Date.now() + expiresMs);

  await repo.createSession({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  });
}
