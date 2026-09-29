import type { Context, Next } from 'hono';
import { AppError } from './errors.js';

/**
 * In-memory rate limiter (단일 인스턴스용 MVP)
 *
 * 향후 확장: Redis 기반 분산 rate limit
 *   - redis.hincrby(`ratelimit:${key}`, 1)
 *   - redis.expire(key, windowSec)
 *   - TTL 기반 만료로 cleanup interval 불필요
 */

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

/** 테스트 전용: 모든 rate limit 상태 초기화 */
export function clearRateLimits(): void {
  store.clear();
}

// Opportunistic cleanup avoids timers in runtimes such as Cloudflare Workers.
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupAt = 0;
function cleanupExpiredEntries(now: number): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

export function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const id = c.req.param('id');
    const key = `${c.req.path}:${id}`;

    const now = Date.now();
    cleanupExpiredEntries(now);
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
