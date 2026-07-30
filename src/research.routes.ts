import { Hono } from 'hono';
import { jwtAuth } from './shared/jwt-auth.js';
import { getResearchRepo } from './provider.js';
import { RESEARCH_TREE, getResearchNode } from './data/research.js';
import { adjustBalance } from './shared/wallet.js';
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
  const repo = await getResearchRepo();
  const myResearch = await repo.getAll(userId);

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

researchRoutes.post('/research/:code/levelup', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const code = c.req.param('code')!;

  const node = getResearchNode(code);
  if (!node) throw new AppError('존재하지 않는 연구입니다.', 404, 'RESEARCH_NOT_FOUND');

  const repo = await getResearchRepo();

  // 선행 연구 검증
  const myResearch = await repo.getAll(userId);
  for (const prereq of node.prerequisites) {
    const pMine = myResearch.find((r) => r.code === prereq.code);
    if (!pMine || pMine.level < prereq.level) {
      throw new AppError(
        `선행 연구가 필요합니다: ${prereq.code} Lv.${prereq.level}`,
        400,
        'PREREQUISITE_NOT_MET',
      );
    }
  }

  // 현재 레벨 확인
  const current = myResearch.find((r) => r.code === code);
  if (current && current.level >= node.maxLevel) {
    throw new AppError('이미 최대 레벨입니다.', 400, 'MAX_LEVEL');
  }

  // 비용 확인 및 차감 (트랜잭션 + 원장)
  const nextLevel = (current?.level || 0) + 1;
  const cost = node.costPerLevel(nextLevel);
  const idempotencyKey = `research-${userId}-${code}-lvl${nextLevel}`;

  // electricity 비용 차감
  if (cost.electricity && cost.electricity > 0) {
    await adjustBalance(userId, -cost.electricity, 'research', idempotencyKey, 'electricity', `${node.name} Lv.${nextLevel}`, 'research', code);
  }
  // scrap 비용 차감
  if (cost.scrap && cost.scrap > 0) {
    await adjustBalance(userId, -cost.scrap, 'research', idempotencyKey + '-scrap', 'scrap', `${node.name} Lv.${nextLevel}`, 'research', code);
  }

  logger.info({ userId, code, nextLevel, cost, event: 'research_levelup' }, 'Research level up');

  const result = await repo.levelUp(userId, code);

  return c.json({
    research: result,
    cost,
    nextEffect: node.effectPerLevel(result.level),
  });
});

// ─── POST /research/reset — 연구 초기화 (JWT) ────

researchRoutes.post('/research/reset', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const repo = await getResearchRepo();
  await repo.reset(userId);
  return c.json({ status: 'ok' });
});

export default researchRoutes;
