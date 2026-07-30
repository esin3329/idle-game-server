process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import partsRoutes from '../parts.routes.js';
import mechaRoutes from '../mecha.routes.js';
import { resetPartsStores } from '../store-parts.js';
import { resetCraftingStores } from '../store-crafting.js';
import { resetResearchStores } from '../store-research.js';
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
  app.route('/', mechaRoutes);
  return app;
}

const TEST_TOKEN = jwt.sign({ sub: 'test-user', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
const auth = () => ({ Authorization: `Bearer ${TEST_TOKEN}` });

beforeEach(() => {
  // JSON 데이터 파일 삭제 (파일이 있으면 로드됨)
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-parts.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-equip.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-configs.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-research.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-item-ledger.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-blueprints.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-crafts.json')); } catch {}
  resetAllRepos();
  resetPartsStores();
  resetCraftingStores();
  resetResearchStores();
  resetItemLedger();
});

describe('파츠 카탈로그', () => {
  it('GET /parts → 16종 파츠 반환', async () => {
    const app = createApp();
    const res = await app.request('/parts');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.frames).toHaveLength(3);
    expect(body.weapons).toHaveLength(6);
    expect(body.cores).toHaveLength(3);
    expect(body.modules).toHaveLength(4);
  });

  it('GET /parts/:code → 단일 파츠 상세', async () => {
    const app = createApp();
    const res = await app.request('/parts/light_frame');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('frame');
    expect(body.code).toBe('light_frame');
  });

  it('GET /parts/:code (없는 코드) → 404', async () => {
    const app = createApp();
    const res = await app.request('/parts/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('파츠 인벤토리', () => {
  it('GET /parts/my → 빈 인벤토리 + null 장착', async () => {
    const app = createApp();
    const res = await app.request('/parts/my', { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inventory).toEqual([]);
    expect(body.equipped).toBeNull();
  });

  it('POST /parts/grant → 파츠 지급', async () => {
    const app = createApp();
    const res = await app.request('/parts/grant', {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'light_frame' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.partCode).toBe('light_frame');
    expect(body.level).toBe(1);
  });

  it('POST /parts/grant (중복) → 409', async () => {
    const app = createApp();
    await app.request('/parts/grant', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'light_frame' }),
    });
    const res = await app.request('/parts/grant', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'light_frame' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST /parts/equip → 장착 후 equipped 반영', async () => {
    const app = createApp();
    await app.request('/parts/grant', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'shotgun' }),
    });
    const res = await app.request('/parts/equip', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'shotgun' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.equipped.weapon).toBe('shotgun');
  });
});

describe('메카 구성', () => {
  it('POST /mecha/configs → 구성 생성', async () => {
    const app = createApp();
    const res = await app.request('/mecha/configs', {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '전투형', frame: 'light_frame', weapon: 'shotgun', core: 'assault_core', module: 'shield_module' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('전투형');
    expect(body.frame).toBe('light_frame');
  });

  it('GET /mecha/configs → 생성한 구성 포함', async () => {
    const app = createApp();
    await app.request('/mecha/configs', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '전투형', frame: 'light_frame', weapon: 'shotgun', core: 'assault_core', module: 'shield_module' }),
    });
    const res = await app.request('/mecha/configs', { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configs).toHaveLength(1);
  });

  it('POST /mecha/configs/:id/activate → 활성화', async () => {
    const app = createApp();
    const create = await app.request('/mecha/configs', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A', frame: 'medium_frame', weapon: 'machine_gun', core: 'defense_core', module: 'power_module' }),
    });
    const { id } = await create.json();
    const res = await app.request(`/mecha/configs/${id}/activate`, {
      method: 'POST', headers: auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(1);
  });
});
