import type { Context, Next } from 'hono';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError } from './errors.js';
import { withIndependentPostgresConnection } from '../db/postgres-connection.js';

const store = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = 0;
export function clearRateLimits(): void { store.clear(); }

export type RateLimitScope = 'auto' | 'ip' | 'user';

/** Returns a canonical IP string, or undefined if `value` is not a valid IPv4/IPv6 address. */
function normalizeIp(value: string | undefined | null): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
  const ip = mapped ? mapped[1] : candidate;
  const version = isIP(ip);
  return version === 0 ? undefined : version === 6 ? ip.toLowerCase() : ip;
}

type ProxyTrust = 'none' | 'cloudflare' | 'proxy';

function proxyTrust(): ProxyTrust {
  const configured = process.env.TRUST_PROXY;
  if (configured === 'cloudflare') return 'cloudflare';
  if (configured === 'true' || configured === '1') return 'proxy';
  if (typeof (globalThis as Record<string, unknown>).WebSocketPair !== 'undefined') return 'proxy';
  return 'none';
}

/** Client IP. Forwarding headers are only honoured behind a trusted proxy; otherwise the socket peer is used. */
function clientIp(c: Context): string {
  const trust = proxyTrust();
  if (trust === 'none') {
    const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
    return normalizeIp(env?.incoming?.socket?.remoteAddress) ?? 'anonymous';
  }
  const cf = normalizeIp(c.req.header('CF-Connecting-IP'));
  if (cf || trust === 'cloudflare') return cf ?? 'anonymous';
  for (const part of c.req.header('X-Forwarded-For')?.split(',') ?? []) {
    const ip = normalizeIp(part);
    if (ip) return ip;
  }
  return normalizeIp(c.req.header('X-Real-IP')) ?? 'anonymous';
}

export function rateLimit(maxRequests: number, windowMs: number, options?: { scope?: RateLimitScope }) {
  const scope = options?.scope ?? 'auto';
  return async (c: Context, next: Next): Promise<void> => {
    const ip = clientIp(c);
    const subject = scope === 'ip' ? ip : (c.req.param('id') || c.get('userId') || ip);
    const key = `${c.req.path}:${subject}`;
    const now = Date.now();
    if (process.env.DB_DRIVER === 'postgres') {
      const scope = createHash('sha256').update(key).digest('hex');
      const result = await withIndependentPostgresConnection((db) => db.execute<{ count: number }>(sql`
        INSERT INTO game.request_rate_limits(scope_key, count, reset_at)
        VALUES(${scope}, 1, ${new Date(now + windowMs)})
        ON CONFLICT(scope_key) DO UPDATE SET
          count = CASE WHEN request_rate_limits.reset_at <= ${new Date(now)} THEN 1 ELSE request_rate_limits.count + 1 END,
          reset_at = CASE WHEN request_rate_limits.reset_at <= ${new Date(now)} THEN ${new Date(now + windowMs)} ELSE request_rate_limits.reset_at END
        RETURNING count`));
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
