/**
 * Redis 클라이언트 (선택적)
 *
 * Redis 사용 가능 시 랭킹 캐시 등에 활용.
 * 연결 실패 시 모든 메서드가 silently 실패 (기존 방식 fallback).
 */
import { logger } from './logger.js';

let client: any = null;
let _available = false;

async function getClient(): Promise<any> {
  if (client) return client;
  try {
    const { createClient } = await import('redis');
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    client = createClient({ url });
    client.on('error', (err: Error) => {
      logger.warn({ err: err.message, event: 'redis_error' }, 'Redis connection error');
      _available = false;
    });
    await client.connect();
    _available = true;
    logger.info({ url: url.replace(/\/\/.*@/, '//***@') }, 'Redis connected');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, event: 'redis_unavailable' }, 'Redis unavailable, using fallback');
    _available = false;
  }
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
    await c.zAdd(RANKING_KEY, { score: totalWealth, value: playerId });
  } catch { /* silently fail */ }
}

/** 랭킹 TOP N 조회 */
export async function getTopRankings(n: number = 100): Promise<{ playerId: string; score: number }[]> {
  if (!_available) return [];
  try {
    const c = await getClient();
    const results: { value: string; score: number }[] = await c.zRangeWithScores(RANKING_KEY, 0, n - 1, { REV: true });
    return results.map((r) => ({ playerId: r.value, score: r.score }));
  } catch { return []; }
}

/** 특정 플레이어 랭킹 조회 */
export async function getPlayerRanking(playerId: string): Promise<{ rank: number; score: number } | null> {
  if (!_available) return null;
  try {
    const c = await getClient();
    const rank = await c.zRevRank(RANKING_KEY, playerId);
    if (rank === null) return null;
    const score = await c.zScore(RANKING_KEY, playerId);
    return { rank: rank + 1, score: score || 0 };
  } catch { return null; }
}

/** Redis 연결 종료 */
export async function closeRedis(): Promise<void> {
  if (client) {
    try { await client.quit(); } catch {}
    client = null;
    _available = false;
  }
}
