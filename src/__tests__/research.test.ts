process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import researchRoutes from '../research.routes.js';
import { resetResearchStores } from '../store-research.js';
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
  app.route('/', researchRoutes);
  return app;
}

const TEST_TOKEN = jwt.sign({ sub: 'test-user', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
const auth = () => ({ Authorization: `Bearer ${TEST_TOKEN}` });

beforeEach(() => {
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-research.json')); } catch {}
  resetAllRepos();
  resetResearchStores();
});

describe('연구 트리', () => {
  it('GET /research → 21개 노드', async () => {
    const app = createApp();
    const res = await app.request('/research');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(21);
  });

  it('GET /research/my → 연구 현황 (초기: 모두 level=0)', async () => {
    const app = createApp();
    const res = await app.request('/research/my', { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tree).toHaveLength(21);
    // 선행 조건 없는 노드는 canResearch=true
    const researchable = body.tree.filter((n: any) => n.canResearch);
    expect(researchable.length).toBeGreaterThan(0);
  });

  it('POST /research/:code/levelup → 레벨업 성공', async () => {
    const app = createApp();
    // 연구 비용을 충당할 electricity 충전
    const { adjustBalance } = await import('../shared/wallet.js');
    await adjustBalance('test-user', 1000, 'test', 'test-charge', 'electricity');

    const res = await app.request('/research/prod_eff_1/levelup', {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.research.level).toBe(1);
    expect(body.nextEffect).toContain('10%');
  });

  it('POST /research/:code/levelup (선행 조건 미충족) → 400', async () => {
    const app = createApp();
    const res = await app.request('/research/prod_eff_2/levelup', {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('PREREQUISITE_NOT_MET');
  });

  it('POST /research/reset → 초기화', async () => {
    const app = createApp();
    await app.request('/research/prod_eff_1/levelup', { method: 'POST', headers: auth() });
    const reset = await app.request('/research/reset', { method: 'POST', headers: auth() });
    expect(reset.status).toBe(200);
    const my = await app.request('/research/my', { headers: auth() });
    const body = await my.json();
    const prod1 = body.tree.find((n: any) => n.code === 'prod_eff_1');
    expect(prod1.currentLevel).toBe(0);
  });
});
