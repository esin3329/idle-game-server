import type { Context, Next } from 'hono';
import { AppError } from './errors.js';

// ─── 멱등성 응답 캐시 ───────────────────────────────

interface CacheEntry {
  requestHash: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

interface InFlightEntry {
  requestHash: string;
  done: Promise<void>;
  release: () => void;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlightEntry>();

/** 캐시 TTL: 24시간 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 캐시 정리 간격: 1시간 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// 주기적 만료 항목 정리
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of cache) {
        if (entry.expiresAt < now) cache.delete(key);
      }
      if (cache.size === 0 && cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    }, CLEANUP_INTERVAL_MS);
    // cleanupTimer가 프로세스 종료를 막지 않도록
    if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
      cleanupTimer.unref();
    }
  }
}

/**
 * 멱등성 키 미들웨어
 *
 * 키를 인증 주체, 메서드, 경로에 scope하고 본문 해시를 확인한다.
 * 동시 재시도는 직렬화하고 성공 응답만 프로세스 메모리에 캐시한다.
 */
export async function idempotencyGuard(c: Context<{ Variables: { idempotencyKey: string } }>, next: Next) {
  const key = c.req.header('Idempotency-Key');

  if (!key || key.length < 1) {
    throw new AppError('Idempotency-Key 헤더가 필요합니다.', 400, 'MISSING_IDEMPOTENCY_KEY');
  }
  if (key.length > 64) {
    throw new AppError('Idempotency-Key가 너무 깁니다 (최대 64자).', 400, 'IDEMPOTENCY_KEY_TOO_LONG');
  }

  if (process.env.DB_DRIVER === 'postgres') {
    const { postgresIdempotency } = await import('./postgres-idempotency.js');
    return postgresIdempotency(c, next, key);
  }

  const body = await c.req.raw.clone().text();
  const requestHash = await sha256(body);
  const principal = 'userId' in c.var && typeof c.var.userId === 'string'
    ? c.var.userId : c.req.header('CF-Connecting-IP') ?? 'anonymous';
  const url = new URL(c.req.url);
  const scopedKey = await sha256(JSON.stringify([principal, c.req.method, url.pathname + url.search, key]));

  while (true) {
    const current = inFlight.get(scopedKey);
    if (!current) break;
    if (current.requestHash !== requestHash) {
      throw new AppError('동일한 키가 다른 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
    }
    await current.done;
  }

  let release!: () => void;
  const entry: InFlightEntry = {
    requestHash,
    done: new Promise<void>((resolve) => { release = resolve; }),
    release: () => release(),
  };
  inFlight.set(scopedKey, entry);
  try {
    const cached = cache.get(scopedKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.requestHash !== requestHash) {
        throw new AppError('동일한 키가 다른 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
      }
      return c.json(cached.body, cached.status as Parameters<typeof c.json>[1]);
    }
    if (cached) cache.delete(scopedKey);

    c.set('idempotencyKey', scopedKey);
    await next();

    const status = c.res.status;
    if (status >= 200 && status < 300) {
      try {
        const body = await c.res.clone().json();
        cache.set(scopedKey, { requestHash, status, body, expiresAt: Date.now() + CACHE_TTL_MS });
        ensureCleanup();
      } catch {
        // JSON이 아닌 응답은 프로세스 캐시에 저장하지 않는다.
      }
    }
  } finally {
    if (inFlight.get(scopedKey) === entry) inFlight.delete(scopedKey);
    entry.release();
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 테스트 전용: 캐시 초기화 */
export function clearIdempotencyCache(): void {
  cache.clear();
}

/** 캐시 크기 반환 (디버깅용) */
export function idempotencyCacheSize(): number {
  return cache.size;
}

