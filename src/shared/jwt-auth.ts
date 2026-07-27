import type { Context, Next } from 'hono';
import { verify, TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { AppError } from './errors.js';

function jwtSecret(name: string): string {
  return process.env[name] || 'dev-secret-change-in-production';
}

export interface JwtPayload {
  sub: string;
  type: 'access' | 'refresh';
  jti?: string;
  iat: number;
  exp: number;
}

const REQUIRED_CLAIMS = ['sub', 'type', 'iat', 'exp'] as const;

function isValidPayload(payload: unknown): payload is JwtPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return REQUIRED_CLAIMS.every((c) => c in p)
    && typeof p.sub === 'string'
    && p.type === 'access';
}

/**
 * JWT Bearer 인증 미들웨어
 * Authorization: Bearer <access_token>
 *
 * 검증: 서명, 만료시간, type=access, 필수 claim 존재
 */
export async function jwtAuth(c: Context<{ Variables: { userId: string } }>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('인증이 필요합니다.', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.slice(7);

  let payload: unknown;
  try {
    payload = verify(token, jwtSecret('JWT_ACCESS_SECRET'), { complete: false });
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      throw new AppError('토큰이 만료되었습니다.', 401, 'TOKEN_EXPIRED');
    }
    if (err instanceof JsonWebTokenError) {
      throw new AppError('유효하지 않은 토큰입니다.', 401, 'INVALID_TOKEN');
    }
    throw new AppError('인증에 실패했습니다.', 401, 'UNAUTHORIZED');
  }

  if (!isValidPayload(payload)) {
    throw new AppError('유효하지 않은 토큰 형식입니다.', 401, 'INVALID_TOKEN');
  }

  c.set('userId', payload.sub);
  await next();
}
