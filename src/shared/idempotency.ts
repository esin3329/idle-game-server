import type { Context, Next } from 'hono';
import { AppError } from './errors.js';

// ─── 멱등성 응답 캐시 ───────────────────────────────

interface CacheEntry {
  status: number;
  body: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

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
 * 1. Idempotency-Key 헤더 검증 (필수, 1~64자)
 * 2. 캐시 확인 → 있으면 저장된 응답 반환 (DB 재조회 없음)
 * 3. 핸들러 실행 후 2xx 응답을 캐시에 저장
 *
 * 클라이언트는 멱등성이 필요한 POST 요청마다 고유 키를 생성하여 전송.
 * 네트워크 재시도 등으로 같은 요청이 중복 전송되어도 안전.
 */
export async function idempotencyGuard(c: Context<{ Variables: { idempotencyKey: string } }>, next: Next) {
  const key = c.req.header('Idempotency-Key');

  if (!key || key.length < 1) {
    throw new AppError('Idempotency-Key 헤더가 필요합니다.', 400, 'MISSING_IDEMPOTENCY_KEY');
  }

  if (key.length > 64) {
    throw new AppError('Idempotency-Key가 너무 깁니다 (최대 64자).', 400, 'IDEMPOTENCY_KEY_TOO_LONG');
  }

  // ─── 캐시 확인 ──────────────────────────────────
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json(cached.body, cached.status as Parameters<typeof c.json>[1]);
  }
  if (cached) cache.delete(key); // 만료됨

  c.set('idempotencyKey', key);

  await next();

  // ─── 2xx 응답 캐시 저장 ────────────────────────
  const status = c.res.status;
  if (status >= 200 && status < 300) {
    try {
      const cloned = c.res.clone();
      const body = await cloned.json();
      cache.set(key, { status, body, expiresAt: Date.now() + CACHE_TTL_MS });
      ensureCleanup();
    } catch {
      // JSON이 아닌 응답(리다이렉트 등)은 캐시하지 않음
    }
  }
}

/** 테스트 전용: 캐시 초기화 */
export function clearIdempotencyCache(): void {
  cache.clear();
}

/** 캐시 크기 반환 (디버깅용) */
export function idempotencyCacheSize(): number {
  return cache.size;
}
