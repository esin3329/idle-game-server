import type { Context, Next } from 'hono';
import { AppError } from './errors.js';

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

/** 테스트 전용: 모든 rate limit 상태 초기화 */
export function clearRateLimits(): void {
  store.clear();
}

// 60초마다 만료된 엔트리 정리
const CLEANUP_INTERVAL_MS = 60_000;
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Node.js 종료 시 타이머 해제 (테스트 환경에서 hang 방지)
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

export function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const id = c.req.param('id');
    const key = `${c.req.path}:${id}`;

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= maxRequests) {
      throw new AppError('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.', 429, 'RATE_LIMITED');
    }

    entry.count++;
    await next();
  };
}
