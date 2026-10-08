process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import researchRoutes from '../research.routes.js';
import { resetResearchStores, jsonResearchRepo } from '../store-research.js';
import { resetAllRepos } from '../provider.js';
import jwt from 'jsonwebtoken';
import { resetAuthStores, jsonAuthRepo } from '../store-auth.js';
import { resetWalletStores } from '../store-wallet.js';
import { getBalance, adjustBalance } from '../shared/wallet.js';

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
const auth = () => ({
  Authorization: `Bearer ${TEST_TOKEN}`,
  'Idempotency-Key': crypto.randomUUID(),
});

beforeEach(async () => {
  for (const file of ['data-research.json', 'data-users.json', 'data-sessions.json', 'data-sanctions.json', 'data-profiles.json', 'data-wallets.json', 'data-ledger.json']) {
    try { require('fs').unlinkSync(require('path').join(process.cwd(), file)); } catch {}
  }
  resetAllRepos();
  resetResearchStores();
  resetAuthStores();
  resetWalletStores();
  const now = new Date().toISOString();
  await jsonAuthRepo.createUser({
    id: 'test-user', email: 'test@example.com', nickname: 'Researcher',
    passwordHash: 'unused', status: 'active', role: 'user', createdAt: now, updatedAt: now,
  });
  await jsonAuthRepo.createWallet({
    id: 'wallet-test-user',
    playerId: 'test-user',
    userId: 'test-user',
    currency: 'electricity',
    electricity: 0,
    electricityPerSecond: 1,
    scrap: 0,
    balance: 0,
    lastClaimedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await adjustBalance('test-user', 10_000, 'test', crypto.randomUUID(), 'electricity');
  await adjustBalance('test-user', 10_000, 'test', crypto.randomUUID(), 'scrap');
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

    const res = await app.request('/research/prod_eff_1/levelup', {
      method: 'POST',
      headers: auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.research.level).toBe(1);
    expect(body.nextEffect).toContain('10%');
    expect(body.cost.electricity).toBe(100);
    expect((await getBalance('test-user'))?.balance).toBe(9_900);
  });

  it('연구 비용과 상태는 인증된 사용자의 canonical playerId에 기록된다', async () => {
    const now = new Date().toISOString();
    await jsonAuthRepo.createProfile({
      id: crypto.randomUUID(),
      playerId: 'canonical-player',
      userId: 'test-user',
      nickname: 'Researcher',
      highestStage: 1,
      createdAt: now,
      updatedAt: now,
    });
    await jsonAuthRepo.createWallet({
      id: 'wallet-canonical-player',
      playerId: 'canonical-player',
      userId: 'test-user',
      currency: 'electricity',
      electricity: 0,
      electricityPerSecond: 1,
      scrap: 0,
      balance: 0,
      lastClaimedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await adjustBalance('canonical-player', 1_000, 'test', crypto.randomUUID(), 'electricity');

    const app = createApp();
    const response = await app.request('/research/prod_eff_1/levelup', {
      method: 'POST',
      headers: auth(),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.research.playerId).toBe('canonical-player');
    expect((await getBalance('canonical-player'))?.balance).toBe(900);
    expect((await getBalance('test-user'))?.balance).toBe(10_000);
    expect((await jsonResearchRepo.get('canonical-player', 'prod_eff_1'))?.level).toBe(1);
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

  it('동시 레벨업은 다음 레벨 비용을 각각 차감한다', async () => {
    const app = createApp();
    const request = (key: string) => app.request('/research/prod_eff_1/levelup', {
      method: 'POST',
      headers: { ...auth(), 'Idempotency-Key': key },
    });
    const responses = await Promise.all([request('level-up-one'), request('level-up-two')]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await getBalance('test-user'))?.balance).toBe(9_700);
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
