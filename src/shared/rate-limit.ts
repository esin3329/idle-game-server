import type { Context, Next } from 'hono';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';
import { getDb } from '../db/postgres-connection.js';

const store = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = 0;
export function clearRateLimits(): void { store.clear(); }

export function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next): Promise<void> => {
    const key = `${c.req.path}:${c.req.param('id') || c.get('userId') || ''}`;
    const now = Date.now();
    if (process.env.DB_DRIVER === 'postgres') {
      const scope = createHash('sha256').update(key).digest('hex');
      const result = await getDb().execute<{ count: number }>(sql`
        INSERT INTO game.request_rate_limits(scope_key, count, reset_at)
        VALUES(${scope}, 1, ${new Date(now + windowMs)})
        ON CONFLICT(scope_key) DO UPDATE SET
          count = CASE WHEN request_rate_limits.reset_at <= ${new Date(now)} THEN 1 ELSE request_rate_limits.count + 1 END,
          reset_at = CASE WHEN request_rate_limits.reset_at <= ${new Date(now)} THEN ${new Date(now + windowMs)} ELSE request_rate_limits.reset_at END
        RETURNING count`);
      if ((result.rows[0]?.count || 0) > maxRequests) throw new AppError('너무 많은 요청입니다.', 429, 'RATE_LIMITED');
      await next();
      return;
    }
    if (now - lastCleanup > 60000) {
      for (const [scope, entry] of store) if (entry.resetAt <= now) store.delete(scope);
      lastCleanup = now;
    }
    const entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      if (entry.count >= maxRequests) throw new AppError('너무 많은 요청입니다.', 429, 'RATE_LIMITED');
      entry.count++;
    }
    await next();
  };
}
