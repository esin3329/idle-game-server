process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import craftingRoutes from '../crafting.routes.js';
import partsRoutes from '../parts.routes.js';
import { resetCraftingStores, jsonCraftingRepo } from '../store-crafting.js';
import { resetPartsStores, jsonPartsRepo } from '../store-parts.js';
import { resetItemLedger } from '../store-item-ledger.js';
import { resetAllRepos } from '../provider.js';
import { jsonAuthRepo, resetAuthStores } from '../store-auth.js';
import { getBalance } from '../shared/wallet.js';
import { resetWalletStores } from '../store-wallet.js';
import jwt from 'jsonwebtoken';

function createApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err && typeof err === 'object' && 'status' in err) {
      return c.json({ error: err.message, code: (err as any).code }, (err as any).status);
    }
    return c.json({ error: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found', code: 'ROUTE_NOT_FOUND' }, 404));
  app.route('/', partsRoutes);
  app.route('/', craftingRoutes);
  return app;
}

const TEST_TOKEN = jwt.sign({ sub: 'test-user', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
const auth = () => ({ Authorization: `Bearer ${TEST_TOKEN}`, 'Idempotency-Key': crypto.randomUUID() });

beforeEach(async () => {
  vi.useRealTimers();
  for (const file of ['data-users.json', 'data-sessions.json', 'data-sanctions.json', 'data-profiles.json', 'data-wallets.json', 'data-ledger.json']) {
    try { require('fs').unlinkSync(require('path').join(process.cwd(), file)); } catch {}
  }
  for (const file of ['data-parts.json', 'data-equip.json', 'data-blueprints.json', 'data-crafts.json', 'data-item-ledger.json']) {
    try { require('fs').unlinkSync(require('path').join(process.cwd(), file)); } catch {}
  }
  resetAllRepos();
  resetAuthStores();
  resetWalletStores();
  resetPartsStores();
  resetCraftingStores();
  resetItemLedger();
  const now = new Date().toISOString();
  await jsonAuthRepo.createUser({ id: 'test-user', email: 'test-user@example.test', nickname: 'test-user', passwordHash: '', status: 'active', role: 'user', createdAt: now, updatedAt: now });
  await jsonAuthRepo.createWallet({
    id: 'wallet-test-user', playerId: 'test-user', userId: 'test-user',
    electricity: 0, electricityPerSecond: 1, scrap: 500, balance: 0,
    lastClaimedAt: now, createdAt: now, updatedAt: now,
  });
});

describe('설계도', () => {
  it('GET /crafting/blueprints → 16종', async () => {
    const app = createApp();
    const res = await app.request('/crafting/blueprints');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blueprints).toHaveLength(16);
  });

  it('POST /crafting/drop → 404 ROUTE_NOT_FOUND', async () => {
    const app = createApp();
    const res = await app.request('/crafting/drop', { method: 'POST', headers: auth() });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });
});

describe('제작', () => {
  it('POST /crafting/:code/start rejects a known blueprint not owned by the user', async () => {
    const app = createApp();
    const res = await app.request('/crafting/bp_light_frame/start', {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'BLUEPRINT_NOT_OWNED' });
  });

  it('POST /crafting/:code/start (설계도 없음) → 400', async () => {
    const app = createApp();
    const res = await app.request('/crafting/bp_nonexistent/start', {
      method: 'POST',
      headers: auth(),
    });
    expect([400, 404]).toContain(res.status);
  });

  it('제작 시작은 스크랩을 차감하고 같은 키 재시도는 같은 대기열을 반환한다', async () => {
    const app = createApp();
    await jsonCraftingRepo.grantBlueprint('test-user', 'bp_medium_frame');
    const key = crypto.randomUUID();
    const first = await app.request('/crafting/bp_medium_frame/start', {
      method: 'POST',
      headers: { ...auth(), 'Idempotency-Key': key },
    });
    expect(first.status).toBe(201);
    const craft = await first.json();
    expect((await getBalance('test-user'))?.scrap).toBe(495);

    const retry = await app.request('/crafting/bp_medium_frame/start', {
      method: 'POST',
      headers: { ...auth(), 'Idempotency-Key': key },
    });
    expect(retry.status).toBe(201);
    expect((await retry.json()).id).toBe(craft.id);
    expect((await getBalance('test-user'))?.scrap).toBe(495);
  });

  it('제작 시작은 파츠 재료를 소비한다', async () => {
    const app = createApp();
    await jsonCraftingRepo.grantBlueprint('test-user', 'bp_heavy_frame');
    await jsonPartsRepo.grantPart('test-user', 'light_frame', 'frame');

    const response = await app.request('/crafting/bp_heavy_frame/start', {
      method: 'POST',
      headers: auth(),
    });
    expect(response.status).toBe(201);
    expect(await jsonPartsRepo.hasPart('test-user', 'light_frame')).toBe(false);
    expect((await getBalance('test-user'))?.scrap).toBe(460);
  });

  it('장착 중인 파츠는 재료로 소비되지 않는다', async () => {
    const app = createApp();
    await jsonCraftingRepo.grantBlueprint('test-user', 'bp_heavy_frame');
    await jsonPartsRepo.grantPart('test-user', 'light_frame', 'frame');
    await jsonPartsRepo.equipPart('test-user', 'light_frame', 'frame');

    const response = await app.request('/crafting/bp_heavy_frame/start', {
      method: 'POST',
      headers: auth(),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INSUFFICIENT_MATERIALS' });
    expect(await jsonPartsRepo.hasPart('test-user', 'light_frame')).toBe(true);
    expect((await getBalance('test-user'))?.scrap).toBe(500);
  });

  it('제작 완료와 파츠 지급은 한 번만 반영된다', async () => {
    vi.useFakeTimers();
    const app = createApp();
    await jsonCraftingRepo.grantBlueprint('test-user', 'bp_medium_frame');
    const start = await app.request('/crafting/bp_medium_frame/start', {
      method: 'POST',
      headers: auth(),
    });
    const craft = await start.json();
    vi.advanceTimersByTime(31_000);

    const complete = await app.request(`/crafting/${craft.id}/complete`, {
      method: 'POST',
      headers: auth(),
    });
    expect(complete.status).toBe(200);
    expect(await jsonPartsRepo.hasPart('test-user', 'medium_frame')).toBe(true);

    const retry = await app.request(`/crafting/${craft.id}/complete`, {
      method: 'POST',
      headers: auth(),
    });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ code: 'ALREADY_COMPLETED' });
    expect((await jsonPartsRepo.getInventory('test-user')).filter((part) => part.partCode === 'medium_frame')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('GET /crafting/queue → 제작 대기열', async () => {
    const app = createApp();
    const res = await app.request('/crafting/queue', { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queue).toBeDefined();
    expect(typeof body.completable).toBe('number');
  });
});
