/**
 * Redis 클라이언트 (선택적)
 *
 * Redis 사용 가능 시 랭킹 캐시 등에 활용.
 * Redis 장애 시 모든 메서드가 MySQL/JSON 기반 방식으로 자동 fallback.
 * 재연결: 주기적(60초)으로 Redis 재연결 시도, 복구 시 자동 활성화.
 */
import { logger } from './logger.js';

let client: any = null;
let _available = false;
let _reconnectTimer: ReturnType<typeof setInterval> | null = null;

const RECONNECT_INTERVAL = parseInt(process.env.REDIS_RECONNECT_INTERVAL || '60000', 10);

async function tryConnect(): Promise<boolean> {
  try {
    const { createClient } = await import('redis');
    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    if (client) {
      try { await client.quit(); } catch {}
      client = null;
    }

    client = createClient({ url, socket: { reconnectStrategy: false } });
    client.on('error', (err: Error) => {
      if (_available) {
        logger.warn({ err: err.message, event: 'redis_error' }, 'Redis connection lost, falling back to MySQL');
      }
      _available = false;
    });

    await client.connect();
    _available = true;
    logger.info({ url: url.replace(/\/\/.*@/, '//***@') }, 'Redis connected');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (_available) {
      logger.warn({ err: msg, event: 'redis_lost' }, 'Redis connection lost, falling back to MySQL');
    }
    _available = false;
    return false;
  }
}

async function getClient(): Promise<any> {
  if (client && _available) return client;

  // 첫 연결 또는 재연결 시도
  if (!_reconnectTimer && RECONNECT_INTERVAL > 0) {
    // 주기적 재연결 타이머 (unref로 프로세스 종료 방해 없음)
    _reconnectTimer = setInterval(async () => {
      if (!_available) {
        const ok = await tryConnect();
        if (ok && _reconnectTimer) {
          // 복구 성공 시 타이머 중단 (다음 장애 시 재시작)
          clearInterval(_reconnectTimer);
          _reconnectTimer = null;
        }
      }
    }, RECONNECT_INTERVAL);
    if (_reconnectTimer && typeof _reconnectTimer === 'object' && 'unref' in _reconnectTimer) {
      _reconnectTimer.unref();
    }
  }

  await tryConnect();
  return client;
}

export function isRedisAvailable(): boolean {
  return _available;
}

// ─── 랭킹 (Sorted Set) ──────────────────────────────

const RANKING_KEY = 'ranking:totalWealth';

/** 랭킹 점수 업데이트 (claim/upgrade/battle 시 호출) */
export async function updateRanking(playerId: string, totalWealth: number): Promise<void> {
  if (!_available) return;
  try {
    const c = await getClient();
    if (c) await c.zAdd(RANKING_KEY, { score: totalWealth, value: playerId });
  } catch {
    _available = false;
    logger.warn({ event: 'redis_write_failed' }, 'Redis write failed, fallback to MySQL');
  }
}

/** 랭킹 TOP N 조회 */
export async function getTopRankings(n: number = 100): Promise<{ playerId: string; score: number }[]> {
  if (!_available) return [];
  try {
    const c = await getClient();
    if (!c) return [];
    const results: { value: string; score: number }[] = await c.zRangeWithScores(RANKING_KEY, 0, n - 1, { REV: true });
    return results.map((r) => ({ playerId: r.value, score: r.score }));
  } catch {
    _available = false;
    return [];
  }
}

/** 특정 플레이어 랭킹 조회 */
export async function getPlayerRanking(playerId: string): Promise<{ rank: number; score: number } | null> {
  if (!_available) return null;
  try {
    const c = await getClient();
    if (!c) return null;
    const rank = await c.zRevRank(RANKING_KEY, playerId);
    if (rank === null) return null;
    const score = await c.zScore(RANKING_KEY, playerId);
    return { rank: rank + 1, score: score || 0 };
  } catch {
    _available = false;
    return null;
  }
}

/** Redis 연결 종료 */
export async function closeRedis(): Promise<void> {
  if (_reconnectTimer) {
    clearInterval(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (client) {
    try { await client.quit(); } catch {}
    client = null;
    _available = false;
  }
}

/** Redis 상태 강제 리셋 (테스트/운영 복구용) */
export function resetRedisState(): void {
  _available = false;
  client = null;
}
