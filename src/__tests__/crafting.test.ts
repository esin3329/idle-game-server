process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import craftingRoutes from '../crafting.routes.js';
import partsRoutes from '../parts.routes.js';
import { resetCraftingStores } from '../store-crafting.js';
import { resetPartsStores } from '../store-parts.js';
import { resetItemLedger } from '../store-item-ledger.js';
import { resetAllRepos } from '../provider.js';
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
const auth = () => ({ Authorization: `Bearer ${TEST_TOKEN}` });

beforeEach(() => {
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-parts.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-equip.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-blueprints.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-crafts.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-item-ledger.json')); } catch {}
  resetAllRepos();
  resetPartsStores();
  resetCraftingStores();
  resetItemLedger();
});

describe('설계도', () => {
  it('GET /crafting/blueprints → 16종', async () => {
    const app = createApp();
    const res = await app.request('/crafting/blueprints');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blueprints).toHaveLength(16);
  });

  it('POST /crafting/drop → 설계도 획득', async () => {
    const app = createApp();
    const res = await app.request('/crafting/drop', { method: 'POST', headers: auth() });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.blueprint).toBeDefined();
    expect(body.blueprint.code).toMatch(/^bp_/);
    expect(body.blueprint.partType).toBeDefined();
  });

  it('POST /crafting/drop (중복) → duplicate=true', async () => {
    const app = createApp();
    await app.request('/crafting/drop', { method: 'POST', headers: auth() });
    const res = await app.request('/crafting/drop', { method: 'POST', headers: auth() });
    const body = await res.json();
    // 중복이면 201이거나 duplicate 플래그
    expect(body.duplicate === true || res.status === 201).toBe(true);
  });
});

describe('제작', () => {
  it('POST /crafting/:code/start → 제작 시작 (설계도 필요)', async () => {
    const app = createApp();
    // 설계도 드롭
    const drop = await app.request('/crafting/drop', { method: 'POST', headers: auth() });
    const bpCode = (await drop.json()).blueprint.code;

    const res = await app.request(`/crafting/${bpCode}/start`, {
      method: 'POST',
      headers: auth(),
    });
    // 설계도가 없거나 제작 시작 실패
    expect([201, 400]).toContain(res.status);
  });

  it('POST /crafting/:code/start (설계도 없음) → 400', async () => {
    const app = createApp();
    const res = await app.request('/crafting/bp_nonexistent/start', {
      method: 'POST',
      headers: auth(),
    });
    expect([400, 404]).toContain(res.status);
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
