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

/**
 * Canonical form of a valid IP, or undefined for anything else.
 * IPv4-mapped IPv6 becomes dotted IPv4; other IPv6 becomes lowercase, zero-padded 8 hextets; a valid zone id is dropped.
 */
function normalizeIp(value: string | undefined | null): string | undefined {
  let candidate = value?.trim();
  if (!candidate) return undefined;
  const zoneAt = candidate.indexOf('%');
  if (zoneAt >= 0) {
    if (!/^[0-9A-Za-z._~-]+$/.test(candidate.slice(zoneAt + 1))) return undefined;
    candidate = candidate.slice(0, zoneAt);
    if (isIP(candidate) !== 6) return undefined;
  }
  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return undefined;

  let text = candidate.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const groups = rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  const words = groups.map((group) => Number.parseInt(group, 16));
  if (words.length !== 8 || words.some((word) => Number.isNaN(word))) return undefined;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
  }
  return words.map((word) => word.toString(16).padStart(4, '0')).join(':');
}

type ProxyMode = 'none' | 'cloudflare' | 'generic';

/**
 * TRUST_PROXY: 'false'/'0' disable (always wins), 'cloudflare', 'true'/'1' generic reverse proxy.
 * Unset: Cloudflare Workers runtime => 'cloudflare', anything else => 'none'.
 */
function proxyMode(): ProxyMode {
  const configured = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (configured === 'false' || configured === '0') return 'none';
  if (configured === 'cloudflare') return 'cloudflare';
  if (configured === 'true' || configured === '1') return 'generic';
  return typeof (globalThis as Record<string, unknown>).WebSocketPair !== 'undefined' ? 'cloudflare' : 'none';
}

function trustedProxyIps(): Set<string> {
  const ips = new Set<string>();
  for (const entry of process.env.TRUSTED_PROXY_IPS?.split(',') ?? []) {
    const ip = normalizeIp(entry);
    if (ip) ips.add(ip);
  }
  return ips;
}

function trustedHops(): number {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10);
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

/**
 * Client IP. Forwarding headers are only honoured when configured (see proxyMode) and, if TRUSTED_PROXY_IPS is set,
 * only when the socket peer is one of those proxies. Otherwise the canonical socket peer is used, or 'anonymous'.
 */
function clientIp(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  const peer = normalizeIp(env?.incoming?.socket?.remoteAddress);
  const mode = proxyMode();
  if (mode === 'none') return peer ?? 'anonymous';

  const allowed = trustedProxyIps();
  if (allowed.size > 0) {
    // Workers expose no socket peer (Cloudflare itself is the proxy); a generic proxy must always be verifiable.
    const verified = peer ? allowed.has(peer) : mode === 'cloudflare';
    if (!verified) return peer ?? 'anonymous';
  }

  if (mode === 'cloudflare') return normalizeIp(c.req.header('CF-Connecting-IP')) ?? peer ?? 'anonymous';

  const hops = c.req.header('X-Forwarded-For')?.split(',') ?? [];
  const fromHops = hops.length > 0 ? normalizeIp(hops[Math.max(0, hops.length - trustedHops())]) : undefined;
  return fromHops ?? normalizeIp(c.req.header('X-Real-IP')) ?? peer ?? 'anonymous';
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
