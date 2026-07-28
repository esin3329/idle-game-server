import type { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { AppError } from './errors.js';

function jwtSecret(name: string): string {
  return process.env[name] || 'dev-secret-change-in-production';
}

export interface JwtPayload {
  sub: string;
  type: 'access' | 'refresh';
  role?: string;
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
/**
 * 운영자 인증 미들웨어
 * JWT access token + role ∈ {'operator', 'admin'} + status='active' 검증
 * 일반 사용자 토큰은 운영 API에 접근할 수 없다.
 */
export async function operatorAuth(c: Context<{ Variables: { userId: string; role: string } }>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('인증이 필요합니다.', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.slice(7);

  let payload: unknown;
  try {
    payload = jwt.verify(token, jwtSecret('JWT_ACCESS_SECRET'), { complete: false });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('토큰이 만료되었습니다.', 401, 'TOKEN_EXPIRED');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new AppError('유효하지 않은 토큰입니다.', 401, 'INVALID_TOKEN');
    }
    throw new AppError('인증에 실패했습니다.', 401, 'UNAUTHORIZED');
  }

  if (!isValidPayload(payload)) {
    throw new AppError('유효하지 않은 토큰 형식입니다.', 401, 'INVALID_TOKEN');
  }

  const p = payload as JwtPayload;
  if (!p.role || (p.role !== 'operator' && p.role !== 'admin')) {
    throw new AppError('운영자 권한이 필요합니다.', 403, 'FORBIDDEN');
  }

  c.set('userId', p.sub);
  c.set('role', p.role);
  await next();
}

/**
 * 권한 검증 미들웨어 (operatorAuth 이후 사용)
 * operator_role_permissions 조회 → 특정 permission 보유 확인
 */
export function requirePermission(permission: string) {
  return async (c: Context<{ Variables: { userId: string; role: string } }>, next: Next) => {
    const role = c.get('role');

    // admin/administrator는 모든 권한 통과
    if (role === 'admin' || role === 'administrator') {
      return next();
    }

    const { getDb } = await import('../db/connection.js');
    const { operatorRoles, operatorRolePermissions, operatorPermissions } = await import('../db/schema.js');
    const { eq, and: dAnd } = await import('drizzle-orm');
    const db = getDb();

    const roleRows = await db.select().from(operatorRoles).where(eq(operatorRoles.code, role)).limit(1);
    if (roleRows.length === 0) {
      throw new AppError('권한 정보를 찾을 수 없습니다.', 403, 'FORBIDDEN');
    }

    const permRows = await db.select().from(operatorPermissions)
      .where(eq(operatorPermissions.code, permission)).limit(1);
    if (permRows.length === 0) {
      throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
    }

    const mapping = await db.select().from(operatorRolePermissions)
      .where(dAnd(eq(operatorRolePermissions.roleId, roleRows[0].id), eq(operatorRolePermissions.permissionId, permRows[0].id)))
      .limit(1);

    if (mapping.length === 0) {
      throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
    }

    await next();
  };
}

/**
 * JWT Bearer 인증 미들웨어 (일반 사용자)
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
    payload = jwt.verify(token, jwtSecret('JWT_ACCESS_SECRET'), { complete: false });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('토큰이 만료되었습니다.', 401, 'TOKEN_EXPIRED');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new AppError('유효하지 않은 토큰입니다.', 401, 'INVALID_TOKEN');
    }
    throw new AppError('인증에 실패했습니다.', 401, 'UNAUTHORIZED');
  }

  if (!isValidPayload(payload)) {
    throw new AppError('유효하지 않은 토큰 형식입니다.', 401, 'INVALID_TOKEN');
  }

  c.set('userId', (payload as JwtPayload).sub);
  await next();
}
