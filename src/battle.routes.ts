import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { jwtAuth } from './shared/jwt-auth.js';
import { idempotencyGuard } from './shared/idempotency.js';
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

const battleRoutes = new Hono<{ Variables: { userId: string; idempotencyKey: string } }>();

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

    const body = await c.req.json<BattleEventReport>();

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


export default battleRoutes;
