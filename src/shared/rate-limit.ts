import type { Context, Next } from 'hono';
import { AppError } from './errors.js';

const store = new Map<string, { count: number; resetAt: number }>();

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
