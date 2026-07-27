import type { Context, Next } from 'hono';
import { AppError } from './errors.js';

/**
 * 멱등성 키 미들웨어
 * 클라이언트가 X-Idempotency-Key 헤더로 전송
 * POST, PUT, PATCH 등 변경 요청에 적용
 */
export async function idempotencyGuard(c: Context, next: Next) {
  const key = c.req.header('Idempotency-Key');

  if (!key || key.length < 1) {
    throw new AppError('Idempotency-Key 헤더가 필요합니다.', 400, 'MISSING_IDEMPOTENCY_KEY');
  }

  if (key.length > 64) {
    throw new AppError('Idempotency-Key가 너무 깁니다 (최대 64자).', 400, 'IDEMPOTENCY_KEY_TOO_LONG');
  }

  c.set('idempotencyKey', key);
  await next();
}
