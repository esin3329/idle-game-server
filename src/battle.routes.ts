import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { jwtAuth } from './shared/jwt-auth.js';
import { idempotencyGuard } from './shared/idempotency.js';
import { validatePlayerId } from './shared/validator.js';
import { rateLimit } from './shared/rate-limit.js';
import {
  startBattleSession,
  reportBattleEvent,
  selectUpgrade,
  endBattleSession,
  getBattleSession,
  abandonBattleSession,
} from './shared/battle-session.js';
import type { BattleEventReport, BattleEndReport } from './shared/battle-session.js';
import { logger } from './shared/logger.js';
import { getDb } from './db/connection.js';
import { stages, playerStageProgress, playerRecords } from './db/schema.js';
import { asc, eq } from 'drizzle-orm';

const battleRoutes = new Hono<{ Variables: { userId: string; idempotencyKey: string } }>();

// ─── GET /stages ─────────────────────────────────────
// 스테이지 목록 조회 (간소 경로)

battleRoutes.get('/stages', async (c) => {
  const db = getDb();
  const rows = await db.select().from(stages).orderBy(asc(stages.sequence));

  // JWT 있을 경우 플레이어별 해금 상태 조회
  let progressMap: Map<string, { unlocked: boolean; firstCleared: boolean; bestKill: number; bestTimeMs: number | null; clearCount: number }> = new Map();
  try {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const jwt = await import('jsonwebtoken');
      const token = authHeader.slice(7);
      const payload = jwt.default.verify(token, process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production') as { sub: string };
      const userId = payload.sub;

      const progress = await db.select().from(playerStageProgress)
        .where(eq(playerStageProgress.userId, userId));
      const records = await db.select().from(playerRecords)
        .where(eq(playerRecords.playerId, userId));

      for (const p of progress) {
        progressMap.set(p.stageId, {
          unlocked: true,
          firstCleared: p.firstClearedAt !== null,
          bestKill: 0,
          bestTimeMs: p.bestClearTimeMs || null,
          clearCount: p.clearCount,
        });
      }
      for (const r of records) {
        const existing = progressMap.get(r.stageId);
        progressMap.set(r.stageId, {
          unlocked: existing?.unlocked ?? true,
          firstCleared: r.firstClearedAt !== null,
          bestKill: r.bestKillCount,
          bestTimeMs: (r.bestClearTimeSec || 0) * 1000,
          clearCount: r.totalClears,
        });
      }
    }
  } catch { /* 인증 없으면 기본값만 */ }

  return c.json(rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    sequence: s.sequence,
    durationSeconds: s.durationSeconds,
    entryRequirement: s.entryRequirement,
    recommendedPower: s.recommendedPower,
    enemySet: JSON.parse(s.enemySet),
    bossTimings: JSON.parse(s.bossTimings),
    maxKills: s.maxKills,
    maxCoreEnergy: s.maxCoreEnergy,
    scrapPerKill: s.scrapPerKill,
    unlocked: s.unlocked === 1,
    enabled: s.enabled === 1,
    unlockedForPlayer: progressMap.has(s.id) || s.entryRequirement === 'none',
    firstCleared: progressMap.get(s.id)?.firstCleared ?? false,
    bestKillCount: progressMap.get(s.id)?.bestKill ?? 0,
    bestClearTimeMs: progressMap.get(s.id)?.bestTimeMs ?? null,
    clearCount: progressMap.get(s.id)?.clearCount ?? 0,
    canEnter: (s.unlocked === 1 && s.enabled === 1) && (s.entryRequirement === 'none' || progressMap.has(s.id)),
  })));
});

// ─── GET /api/stages ─────────────────────────────────
// (하위 호환)

battleRoutes.get('/api/stages', async (c) => {
  const db = getDb();
  const rows = await db.select().from(stages).orderBy(asc(stages.sequence));
  return c.json(rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    sequence: s.sequence,
    durationSeconds: s.durationSeconds,
    entryRequirement: s.entryRequirement,
    recommendedPower: s.recommendedPower,
    enemySet: JSON.parse(s.enemySet),
    bossTimings: JSON.parse(s.bossTimings),
    maxKills: s.maxKills,
    maxCoreEnergy: s.maxCoreEnergy,
    scrapPerKill: s.scrapPerKill,
    unlocked: s.unlocked === 1,
    enabled: s.enabled === 1,
  })));
});

// ─── POST /battles/start ──────────────────────────────
// 전투 세션 생성. JWT로 userId 추출, body로 stageId 전달.

battleRoutes.post(
  '/battles/start',
  jwtAuth,
  idempotencyGuard,
  async (c) => {
    const userId = c.get('userId');
    const { stageCode } = await c.req.json<{ stageCode: string }>();

    if (!stageCode) {
      return c.json({ error: 'stageCode가 필요합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const session = await startBattleSession(userId, stageCode);
    return c.json(session, 201);
  },
);

// ─── POST /api/players/:id/battle/start ───────────────
// (하위 호환)

battleRoutes.post(
  '/api/players/:id/battle/start',
  validatePlayerId,
  jwtAuth,
  idempotencyGuard,
  async (c) => {
    const playerId = c.req.param('id')!;
    const { stageId } = await c.req.json<{ stageId: string }>();
    if (!stageId) {
      return c.json({ error: 'stageId가 필요합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const session = await startBattleSession(playerId, stageId);

    return c.json(session, 201);
  },
);

// ─── GET /battles/:sessionId ──────────────────────────
// 전투 세션 상태 조회

battleRoutes.get(
  '/battles/:sessionId',
  jwtAuth,
  async (c) => {
    const sessionId = c.req.param('sessionId')!;
    const userId = c.get('userId');

    const state = await getBattleSession(sessionId, userId);
    return c.json(state);
  },
);

// ─── GET /api/players/:id/battle/state ─────────────────
// (하위 호환)

battleRoutes.get(
  '/api/players/:id/battle/state',
  validatePlayerId,
  jwtAuth,
  async (c) => {
    const playerId = c.req.param('id')!;
    const { sessionId } = c.req.query();
    if (!sessionId) {
      return c.json({ error: 'sessionId 쿼리 파라미터가 필요합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const state = await getBattleSession(sessionId, playerId);
    return c.json(state);
  },
);

// ─── POST /battles/:sessionId/progress ────────────────
// 순서가 있는 전투 진행 이벤트 제출 (처치, core_energy, 보스)

battleRoutes.post(
  '/battles/:sessionId/progress',
  jwtAuth,
  idempotencyGuard,
  rateLimit(5, 1000),
  bodyLimit({ maxSize: 4 * 1024 }),
  async (c) => {
    const sessionId = c.req.param('sessionId')!;
    const userId = c.get('userId');

    const body = await c.req.json<BattleEventReport & { sequence: number }>();

    if (!body.sequence || body.sequence <= 0) {
      return c.json({ error: 'sequence가 필요합니다 (1 이상).', code: 'BAD_REQUEST' }, 400);
    }

    // 정의되지 않은 이벤트 타입 거부
    if (typeof body.killsDelta !== 'number' || typeof body.coreEnergyDelta !== 'number') {
      return c.json({ error: 'killsDelta와 coreEnergyDelta는 숫자여야 합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const result = await reportBattleEvent(sessionId, userId, body);
    return c.json(result);
  },
);

// ─── POST /api/players/:id/battle/event ────────────────
// (하위 호환)

battleRoutes.post(
  '/api/players/:id/battle/event',
  validatePlayerId,
  jwtAuth,
  idempotencyGuard,
  rateLimit(5, 1000),
  async (c) => {
    const playerId = c.req.param('id')!;

    const body = await c.req.json<{ sessionId: string } & BattleEventReport>();
    const { sessionId, ...report } = body;

    if (!sessionId) {
      return c.json({ error: 'sessionId가 필요합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const result = await reportBattleEvent(sessionId, playerId, report);

    return c.json(result);
  },
);

// ─── POST /battles/:sessionId/upgrades/select ──────────
// 서버가 제시한 강화 선택지 중 하나 선택

battleRoutes.post(
  '/battles/:sessionId/upgrades/select',
  jwtAuth,
  idempotencyGuard,
  async (c) => {
    const sessionId = c.req.param('sessionId')!;
    const userId = c.get('userId');
    const { selectedUpgradeCode: selectedId } = await c.req.json<{ selectedUpgradeCode: string }>();

    if (!selectedId) {
      return c.json({ error: 'selectedUpgradeCode가 필요합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const result = await selectUpgrade(sessionId, userId, selectedId);
    return c.json(result);
  },
);

// ─── POST /api/players/:id/battle/upgrade ──────────────
// (하위 호환)

battleRoutes.post(
  '/api/players/:id/battle/upgrade',
  validatePlayerId,
  jwtAuth,
  idempotencyGuard,
  async (c) => {
    const playerId = c.req.param('id')!;

    const { sessionId, selectedId } = await c.req.json<{ sessionId: string; selectedId: string }>();

    if (!sessionId || !selectedId) {
      return c.json({ error: 'sessionId와 selectedId가 필요합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const result = await selectUpgrade(sessionId, playerId, selectedId);

    return c.json(result);
  },
);

// ─── POST /battles/:sessionId/abandon ──────────────────
// active 세션 포기. 영구 보상 없이 종료.

battleRoutes.post(
  '/battles/:sessionId/abandon',
  jwtAuth,
  idempotencyGuard,
  async (c) => {
    const sessionId = c.req.param('sessionId')!;
    const userId = c.get('userId');

    await abandonBattleSession(sessionId, userId);
    return c.json({ status: 'abandoned' });
  },
);

// ─── POST /battles/:sessionId/finish ──────────────────
// 전투 종료. 결과 유형과 검증 가능한 최종 수치만 제출.

battleRoutes.post(
  '/battles/:sessionId/finish',
  jwtAuth,
  idempotencyGuard,
  rateLimit(1, 5000),
  async (c) => {
    const sessionId = c.req.param('sessionId')!;
    const userId = c.get('userId');
    const report = await c.req.json<BattleEndReport>();

    const result = await endBattleSession(sessionId, userId, report);

    logger.info({ userId, sessionId, reward: result.reward, event: 'battle_complete' }, 'Battle finished');
    return c.json(result);
  },
);

// ─── POST /api/players/:id/battle/end ──────────────────
// (하위 호환)

battleRoutes.post(
  '/api/players/:id/battle/end',
  validatePlayerId,
  jwtAuth,
  idempotencyGuard,
  rateLimit(1, 5000),
  async (c) => {
    const playerId = c.req.param('id')!;

    const body = await c.req.json<{ sessionId: string } & BattleEndReport>();
    const { sessionId, ...report } = body;

    if (!sessionId) {
      return c.json({ error: 'sessionId가 필요합니다.', code: 'BAD_REQUEST' }, 400);
    }

    const result = await endBattleSession(sessionId, playerId, report);

    logger.info({ playerId, sessionId, reward: result.reward, event: 'battle_complete' }, 'Battle complete');

    return c.json(result);
  },
);

export default battleRoutes;
