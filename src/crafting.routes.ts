import { Hono } from 'hono';
import { jwtAuth } from './shared/jwt-auth.js';

import { getCraftingRepo, getPartsRepo } from './provider.js';
import { BLUEPRINTS, getBlueprint, randomBlueprintByDropWeight } from './data/crafting.js';
import { AppError } from './shared/errors.js';

const craftingRoutes = new Hono<{ Variables: { userId: string; parsedBody: Record<string, unknown> } }>();

// ─── GET /crafting/blueprints — 설계도 카탈로그 ──

craftingRoutes.get('/crafting/blueprints', (c) => {
  return c.json({ blueprints: BLUEPRINTS });
});

// ─── GET /crafting/my-blueprints — 내 설계도 ─────

craftingRoutes.get('/crafting/my-blueprints', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const repo = await getCraftingRepo();
  const list = await repo.getBlueprints(userId);
  const details = list.map((bp) => {
    const data = getBlueprint(bp.blueprintCode);
    return { ...bp, ...data };
  });
  return c.json(details);
});

// ─── POST /crafting/drop — 랜덤 설계도 드롭 ────

craftingRoutes.post('/crafting/drop', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const bp = randomBlueprintByDropWeight();
  const repo = await getCraftingRepo();

  const already = await repo.hasBlueprint(userId, bp.code);
  if (already) {
    return c.json({ message: '이미 보유한 설계도입니다.', blueprint: bp.code, duplicate: true });
  }

  const acquired = await repo.grantBlueprint(userId, bp.code);
  return c.json({ message: `${bp.name} 획득!`, blueprint: { ...bp, id: acquired.id, acquiredAt: acquired.acquiredAt } }, 201);
});

// ─── GET /crafting/queue — 제작 대기열 ─────────

craftingRoutes.get('/crafting/queue', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const repo = await getCraftingRepo();
  const queue = await repo.getQueue(userId);
  const completable = await repo.getCompletable(userId);
  return c.json({ queue, completable: completable.length });
});

// ─── POST /crafting/:blueprintCode/start — 제작 시작 ──

craftingRoutes.post('/crafting/:blueprintCode/start', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const blueprintCode = c.req.param('blueprintCode')!;

  const bpData = getBlueprint(blueprintCode);
  if (!bpData) throw new AppError('존재하지 않는 설계도입니다.', 404, 'BLUEPRINT_NOT_FOUND');

  const repo = await getCraftingRepo();
  const has = await repo.hasBlueprint(userId, blueprintCode);
  if (!has) throw new AppError('설계도를 보유하지 않았습니다.', 400, 'BLUEPRINT_NOT_OWNED');

  const craft = await repo.startCraft(userId, blueprintCode);
  return c.json(craft, 201);
});

// ─── POST /crafting/:craftId/complete — 제작 완료 ──

craftingRoutes.post('/crafting/:craftId/complete', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const craftId = c.req.param('craftId')!;

  const repo = await getCraftingRepo();
  const result = await repo.completeCraft(userId, craftId);

  // 파츠 지급 (PartsRepository)
  const partsRepo = await getPartsRepo();
  const bpData = BLUEPRINTS.find((b) => b.partCode === result.partCode);
  const partType = bpData?.partType || 'module';
  await partsRepo.grantPart(userId, result.partCode, partType);

  return c.json({ message: '제작 완료!', partId: result.partId, partCode: result.partCode }, 200);
});

export default craftingRoutes;
