import { Hono } from 'hono';
import { jwtAuth } from './shared/jwt-auth.js';
import { getPartsRepo } from './provider.js';
import { ALL_PARTS, getFrame, getWeapon, getCore, getModule } from './data/parts.js';
import { NotFoundError, AppError } from './shared/errors.js';

const partsRoutes = new Hono<{ Variables: { userId: string } }>();

// ─── GET /parts — 전체 파츠 카탈로그 ───────────────

partsRoutes.get('/parts', (c) => c.json(ALL_PARTS));

// ─── GET /parts/my — 내 인벤토리 (JWT) ─────────────
// /parts/:code 보다 먼저 등록 (my를 code로 오인 방지)

partsRoutes.get('/parts/my', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const repo = await getPartsRepo();
  const inventory = await repo.getInventory(userId);
  const equipped = await repo.getEquipped(userId);
  return c.json({ inventory, equipped });
});

// ─── GET /parts/:code — 단일 파츠 정보 ─────────────

partsRoutes.get('/parts/:code', (c) => {
  const code = c.req.param('code')!;
  const frame = getFrame(code);
  if (frame) return c.json({ type: 'frame', ...frame });
  const weapon = getWeapon(code);
  if (weapon) return c.json({ type: 'weapon', ...weapon });
  const core = getCore(code);
  if (core) return c.json({ type: 'core', ...core });
  const mod = getModule(code);
  if (mod) return c.json({ type: 'module', ...mod });
  throw new NotFoundError('파츠');
});

// ─── POST /parts/grant (JWT) ────────────────────────

partsRoutes.post('/parts/grant', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const { partCode } = await c.req.json<{ partCode: string }>();

  const frame = getFrame(partCode);
  const weapon = getWeapon(partCode);
  const core = getCore(partCode);
  const mod = getModule(partCode);
  const partType = frame ? 'frame' : weapon ? 'weapon' : core ? 'core' : mod ? 'module' : null;
  if (!partType) throw new AppError('존재하지 않는 파츠입니다.', 404, 'PART_NOT_FOUND');

  const repo = await getPartsRepo();
  const already = await repo.hasPart(userId, partCode);
  if (already) throw new AppError('이미 보유한 파츠입니다.', 409, 'PART_ALREADY_OWNED');

  const part = await repo.grantPart(userId, partCode, partType);
  return c.json(part, 201);
});

// ─── POST /parts/equip (JWT) ────────────────────────

partsRoutes.post('/parts/equip', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const { partCode } = await c.req.json<{ partCode: string }>();

  const frame = getFrame(partCode);
  const weapon = getWeapon(partCode);
  const core = getCore(partCode);
  const mod = getModule(partCode);
  const partType = frame ? 'frame' : weapon ? 'weapon' : core ? 'core' : mod ? 'module' : null;
  if (!partType) throw new AppError('존재하지 않는 파츠입니다.', 404, 'PART_NOT_FOUND');

  const repo = await getPartsRepo();
  const has = await repo.hasPart(userId, partCode);
  if (!has) throw new AppError('보유하지 않은 파츠입니다.', 400, 'PART_NOT_OWNED');

  await repo.equipPart(userId, partCode, partType);
  const equipped = await repo.getEquipped(userId);
  return c.json({ equipped });
});

// ─── POST /parts/upgrade (JWT) ──────────────────────

partsRoutes.post('/parts/upgrade', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const { partCode } = await c.req.json<{ partCode: string }>();

  const repo = await getPartsRepo();
  const has = await repo.hasPart(userId, partCode);
  if (!has) throw new AppError('보유하지 않은 파츠입니다.', 400, 'PART_NOT_OWNED');

  const upgraded = await repo.upgradePart(userId, partCode);
  return c.json(upgraded);
});

export default partsRoutes;
