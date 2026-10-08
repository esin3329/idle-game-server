import { Hono } from 'hono';
import { jwtAuth } from './shared/jwt-auth.js';
import { getResearchRepo } from './provider.js';
import { RESEARCH_TREE, getResearchNode } from './data/research.js';
import { idempotencyGuard } from './shared/idempotency.js';
import { playerIdForUser } from './shared/player-identity.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';

const researchRoutes = new Hono<{ Variables: { userId: string } }>();

// ─── GET /research — 연구 트리 전체 조회 ──────────

researchRoutes.get('/research', (c) => {
  return c.json({ nodes: RESEARCH_TREE });
});

// ─── GET /research/my — 내 연구 현황 (JWT) ────────

researchRoutes.get('/research/my', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const playerId = await playerIdForUser(userId);
  const repo = await getResearchRepo();
  const myResearch = await repo.getAll(playerId);

  // 전체 트리에 내 진행 상태를 매핑
  const tree = RESEARCH_TREE.map((node) => {
    const mine = myResearch.find((r) => r.code === node.code);
    const currentLevel = mine?.level || 0;
    const completed = mine?.completed || 0;

    // 선행 연구 충족 여부
    const prereqs = node.prerequisites.map((p) => {
      const pMine = myResearch.find((r) => r.code === p.code);
      return { code: p.code, requiredLevel: p.level, currentLevel: pMine?.level || 0, met: (pMine?.level || 0) >= p.level };
    });
    const canResearch = prereqs.every((p) => p.met) && currentLevel < node.maxLevel;

    return {
      ...node,
      currentLevel,
      completed,
      prereqs,
      canResearch,
    };
  });

  return c.json({ tree });
});

// ─── POST /research/:code/levelup — 연구 레벨업 ───

researchRoutes.post('/research/:code/levelup', jwtAuth, idempotencyGuard, async (c) => {
  const userId = c.get('userId');
  const playerId = await playerIdForUser(userId);
  const requestKey = c.get('idempotencyKey');
  const code = c.req.param('code')!;

  const node = getResearchNode(code);
  if (!node) throw new AppError('존재하지 않는 연구입니다.', 404, 'RESEARCH_NOT_FOUND');

  const repo = await getResearchRepo();
  const result = await repo.levelUp(playerId, code, requestKey);

  logger.info({ userId, playerId, code, level: result.research.level, cost: result.cost, event: 'research_levelup' }, 'Research level up');

  return c.json({
    research: result.research,
    cost: result.cost,
    nextEffect: node.effectPerLevel(result.research.level),
  });

});

// ─── POST /research/reset — 연구 초기화 (JWT) ────

researchRoutes.post('/research/reset', jwtAuth, idempotencyGuard, async (c) => {
  const playerId = await playerIdForUser(c.get('userId'));
  const repo = await getResearchRepo();
  await repo.reset(playerId);
  return c.json({ status: 'ok' });
});

export default researchRoutes;
