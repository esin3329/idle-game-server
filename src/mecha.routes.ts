import { Hono } from 'hono';
import { z } from 'zod';
import { jwtAuth } from './shared/jwt-auth.js';
import { validateJson } from './shared/validator.js';
import { getMechaConfigRepo, getPartsRepo } from './provider.js';
import { getFrame, getWeapon, getCore, getModule } from './data/parts.js';
import { NotFoundError, AppError } from './shared/errors.js';

const mechaRoutes = new Hono<{ Variables: { userId: string; parsedBody: Record<string, unknown> } }>();

const createSchema = z.object({
  name: z.string().min(1).max(20),
  frame: z.string().min(1),
  weapon: z.string().min(1),
  core: z.string().min(1),
  module: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  frame: z.string().min(1).optional(),
  weapon: z.string().min(1).optional(),
  core: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
});

// ─── GET /mecha/configs ─────────────────────────────

mechaRoutes.get('/mecha/configs', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const repo = await getMechaConfigRepo();
  const configs = await repo.getConfigs(userId);
  const active = await repo.getActiveConfig(userId);
  return c.json({ configs, active });
});

// ─── POST /mecha/configs ────────────────────────────

mechaRoutes.post('/mecha/configs', jwtAuth, validateJson(createSchema), async (c) => {
  const userId = c.get('userId');
  const { name, frame, weapon, core, module } = c.get('parsedBody') as z.infer<typeof createSchema>;

  // 존재하는 파츠인지 검증
  if (!getFrame(frame) && !getWeapon(frame) && !getCore(frame) && !getModule(frame)) {
    throw new AppError(`존재하지 않는 파츠: ${frame}`, 400, 'PART_NOT_FOUND');
  }
  if (!getWeapon(weapon)) throw new AppError(`존재하지 않는 무기: ${weapon}`, 400, 'PART_NOT_FOUND');
  if (!getCore(core)) throw new AppError(`존재하지 않는 코어: ${core}`, 400, 'PART_NOT_FOUND');
  if (!getModule(module)) throw new AppError(`존재하지 않는 모듈: ${module}`, 400, 'PART_NOT_FOUND');

  const repo = await getMechaConfigRepo();
  const config = await repo.createConfig(userId, name, frame, weapon, core, module);
  return c.json(config, 201);
});

// ─── PUT /mecha/configs/:id ─────────────────────────

mechaRoutes.put('/mecha/configs/:id', jwtAuth, validateJson(updateSchema), async (c) => {
  const id = c.req.param('id')!;
  const updates = c.get('parsedBody') as z.infer<typeof updateSchema>;

  const repo = await getMechaConfigRepo();
  const config = await repo.updateConfig(id, updates);
  if (!config) throw new NotFoundError('구성');
  return c.json(config);
});

// ─── POST /mecha/configs/:id/activate ───────────────

mechaRoutes.post('/mecha/configs/:id/activate', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id')!;

  const repo = await getMechaConfigRepo();
  const config = await repo.activateConfig(id, userId);
  if (!config) throw new NotFoundError('구성');
  return c.json(config);
});

// ─── DELETE /mecha/configs/:id ──────────────────────

mechaRoutes.delete('/mecha/configs/:id', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id')!;

  const repo = await getMechaConfigRepo();
  const deleted = await repo.deleteConfig(id, userId);
  if (!deleted) throw new NotFoundError('구성');
  return c.json({ status: 'ok' });
});

// ─── GET /mecha/parts — 보유 파츠 상세 조회 ─────

mechaRoutes.get('/mecha/parts', jwtAuth, async (c) => {
  const userId = c.get('userId');
  const typeFilter = c.req.query('type'); // frame | weapon | core | module

  const repo = await getPartsRepo();
  let inventory = await repo.getInventory(userId);

  if (typeFilter) {
    inventory = inventory.filter((p) => p.partType === typeFilter);
  }

  // 파츠 코드 → 실제 데이터 조회
  const details = inventory.map((p) => {
    const data = getFrame(p.partCode) || getWeapon(p.partCode) || getCore(p.partCode) || getModule(p.partCode);
    return { ...p, stats: data?.stats || null };
  });

  return c.json(details);
});

export default mechaRoutes;
