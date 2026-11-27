import { Hono } from 'hono';
import { idempotencyGuard } from './shared/idempotency.js';
import { jwtAuth } from './shared/jwt-auth.js';
import { getCraftingRepo } from './provider.js';
import { BLUEPRINTS, getBlueprint } from './data/crafting.js';
import { AppError } from './shared/errors.js';
import { playerIdForUser } from './shared/player-identity.js';

const craftingRoutes = new Hono<{ Variables: { userId: string; parsedBody: Record<string, unknown> } }>();

// ─── GET /crafting/blueprints — 설계도 카탈로그 ──

craftingRoutes.get('/crafting/blueprints', (c) => {
  return c.json({ blueprints: BLUEPRINTS });
});

// ─── GET /crafting/my-blueprints — 내 설계도 ─────

craftingRoutes.get('/crafting/my-blueprints', jwtAuth, async (c) => {
  const playerId = await playerIdForUser(c.get('userId'));
  const repo = await getCraftingRepo();
  const list = await repo.getBlueprints(playerId);
  const details = list.map((bp) => {
    const data = getBlueprint(bp.blueprintCode);
    return { ...bp, ...data };
  });
  return c.json(details);
});


// ─── GET /crafting/queue — 제작 대기열 ─────────

craftingRoutes.get('/crafting/queue', jwtAuth, async (c) => {
  const playerId = await playerIdForUser(c.get('userId'));
  const repo = await getCraftingRepo();
  const queue = await repo.getQueue(playerId);
  const completable = await repo.getCompletable(playerId);
  return c.json({ queue, completable: completable.length });
});

// ─── POST /crafting/:blueprintCode/start — 제작 시작 ──

craftingRoutes.post('/crafting/:blueprintCode/start', jwtAuth, idempotencyGuard, async (c) => {
  const playerId = await playerIdForUser(c.get('userId'));
  const blueprintCode = c.req.param('blueprintCode')!;

  const bpData = getBlueprint(blueprintCode);
  if (!bpData) throw new AppError('존재하지 않는 설계도입니다.', 404, 'BLUEPRINT_NOT_FOUND');

  const repo = await getCraftingRepo();
  const craft = await repo.startCraft(playerId, blueprintCode, c.get('idempotencyKey'));
  return c.json(craft, 201);
});

// ─── POST /crafting/:craftId/complete — 제작 완료 ──

craftingRoutes.post('/crafting/:craftId/complete', jwtAuth, idempotencyGuard, async (c) => {
  const playerId = await playerIdForUser(c.get('userId'));
  const craftId = c.req.param('craftId')!;

  const repo = await getCraftingRepo();
  const result = await repo.completeCraft(playerId, craftId);

  return c.json({ message: '제작 완료!', partId: result.partId, partCode: result.partCode }, 200);
});

export default craftingRoutes;

