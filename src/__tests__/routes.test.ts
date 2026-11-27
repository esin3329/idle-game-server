import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

// ─── 임시 디렉터리 + 주입 ───────────────────────────

const tmpDir = mkdtempSync(join(homedir() || '/tmp', `idle-game-test-routes-`));

import { setDataFilePath } from '../store.js';
import routes from '../routes.js';
import { createPlayer, updatePlayer } from '../store.js';
import { clearRateLimits } from '../shared/rate-limit.js';
import { AppError } from '../shared/errors.js';
import type { Player } from '../types.js';
import { resetAllRepos } from '../provider.js';
import { calcResearchBonus, calcUpgradeCost, DEFAULT_RESEARCH_BONUS } from '../shared/game-math.js';

setDataFilePath(join(tmpDir, 'data.json'));
const STORE_FILE_ENV = [
  'DATA_FILE_USERS',
  'DATA_FILE_SESSIONS',
  'DATA_FILE_SANCTIONS',
  'DATA_FILE_PROFILES',
  'DATA_FILE_WALLETS',
  'DATA_FILE_LEDGER',
] as const;
const originalStoreFileEnv = new Map(STORE_FILE_ENV.map((name) => [name, process.env[name]]));
for (const name of STORE_FILE_ENV) {
  process.env[name] = join(tmpDir, `${name.toLowerCase()}.json`);
}
const { jsonAuthRepo, resetAuthStores } = await import('../store-auth.js');
const { resetWalletStores } = await import('../store-wallet.js');
// 위 env 설정 이후에 로드해야 저장소 파일 경로가 반영되므로 동적 import
const { jsonResearchRepo } = await import('../store-research.js');

const nowISO = new Date().toISOString();
const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: crypto.randomUUID(),
    nickname: 'test',
    apiKey: crypto.randomUUID(),
    electricity: 0,
    electricityPerSecond: 1,
    lastClaimedAt: nowISO,
    createdAt: nowISO,
    updatedAt: nowISO,
    ...overrides,
  };
}

// store 초기화
beforeEach(async () => {
  clearRateLimits();
  resetAllRepos();
  resetAuthStores();
  resetWalletStores();
  for (const name of STORE_FILE_ENV) {
    const file = process.env[name];
    if (file) {
      try { unlinkSync(file); } catch {}
    }
  }
  const isolatedDataFile = join(tmpDir, `data-${crypto.randomUUID()}.json`);
  writeFileSync(isolatedDataFile, '[]', 'utf-8');
  setDataFilePath(isolatedDataFile);

  const now = new Date().toISOString();
  await jsonAuthRepo.createUser({
    id: 'test-user-id',
    email: 'test-user@example.test',
    nickname: 'test-user',
    passwordHash: '',
    status: 'active',
    role: 'user',
    createdAt: now,
    updatedAt: now,
  });
});

function createApp() {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400 | 401 | 403 | 404 | 500);
    }
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      return c.json({ error: '잘못된 JSON 형식입니다.', code: 'INVALID_JSON' }, 400);
    }
    return c.json({ error: err.message, code: 'INTERNAL_ERROR' }, 500);
  });

  app.notFound((c) => c.json({ error: 'Not found', code: 'ROUTE_NOT_FOUND' }, 404));
  app.route('/api', routes);
  return app;
}

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production';

function authToken(userId = 'test-user-id'): { Authorization: string; 'Idempotency-Key': string } {
  const token = jwt.sign({ sub: userId, type: 'access' }, JWT_SECRET, { expiresIn: 3600 });
  return { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() };
}

async function createOwnedPlayer(overrides: Partial<Player> = {}): Promise<Player> {
  const player = makePlayer(overrides);
  createPlayer(player);
  const now = new Date().toISOString();
  await jsonAuthRepo.createProfile({
    id: `profile-${player.id}`,
    playerId: player.id,
    userId: 'test-user-id',
    nickname: player.nickname,
    highestStage: 1,
    createdAt: now,
    updatedAt: now,
  });
  await jsonAuthRepo.createWallet({
    id: `wallet-${player.id}`,
    playerId: player.id,
    userId: 'test-user-id',
    currency: 'electricity',
    electricity: player.electricity,
    electricityPerSecond: player.electricityPerSecond,
    scrap: 0,
    balance: player.electricity,
    lastClaimedAt: player.lastClaimedAt,
    createdAt: now,
    updatedAt: now,
  });
  return player;
}

describe('POST /api/players', () => {
  it('유효한 닉네임으로 플레이어를 생성해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '플레이어1' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.nickname).toBe('플레이어1');
    expect(body.electricity).toBe(0);
    expect(body.electricityPerSecond).toBe(1);
    expect(body.id).toBeDefined();
  });

  it('빈 닉네임은 400 에러를 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('닉네임이 없으면 400 에러를 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/players', () => {
  it('빈 배열을 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('limit/offset 쿼리로 페이지네이션할 수 있어야 한다', async () => {
    const app = createApp();
    createPlayer(makePlayer({ nickname: '첫번째' }));
    createPlayer(makePlayer({ nickname: '두번째' }));
    createPlayer(makePlayer({ nickname: '세번째' }));

    const res = await app.request('/api/players?limit=1&offset=1', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].nickname).toBe('두번째');
  });
});

describe('GET /api/players/:id', () => {
  it('존재하지 않는 ID는 404를 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request(`/api/players/${NONEXISTENT_ID}`, { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/players/:id/claim', () => {
  it('인증 없이 요청하면 401을 반환해야 한다', async () => {
    const app = createApp();
    const id = crypto.randomUUID();
    const player = makePlayer({ id });
    createPlayer(player);

    const res = await app.request(`/api/players/${id}/claim`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(res.status).toBe(401);
  });

  it('전기를 수집하면 electricity가 증가해야 한다', async () => {
    const app = createApp();
    const pastTime = new Date(Date.now() - 10000).toISOString();
    const player = await createOwnedPlayer({ lastClaimedAt: pastTime });

    const res = await app.request(`/api/players/${player.id}/claim`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toBeGreaterThanOrEqual(9);
    expect(body.elapsedSeconds).toBeGreaterThanOrEqual(9);
    expect(body.player.electricity).toBeGreaterThanOrEqual(9);
  });
});

describe('GET /api/players/:id/claim', () => {
  it('미수집 전기량을 조회할 수 있어야 한다', async () => {
    const app = createApp();
    const pastTime = new Date(Date.now() - 5000).toISOString(); // 5초 전
    const player = makePlayer({ lastClaimedAt: pastTime, electricityPerSecond: 10 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/claim`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending).toBeGreaterThanOrEqual(49); // 5초 * 10
    expect(body.elapsedSeconds).toBeGreaterThanOrEqual(4);
  });
});

describe('POST /api/players/:id/upgrade', () => {
  it('인증 없이 요청하면 401을 반환해야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 0 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/upgrade`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(res.status).toBe(401);
  });

  it('전기가 부족하면 업그레이드에 실패해야 한다', async () => {
    const app = createApp();
    const player = await createOwnedPlayer({ electricity: 0, electricityPerSecond: 1 });

    const res = await app.request(`/api/players/${player.id}/upgrade`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('전기이(가) 부족합니다.');
  });

  it('전기가 충분하면 업그레이드해야 한다', async () => {
    const app = createApp();
    const player = await createOwnedPlayer({ electricity: 100, electricityPerSecond: 1 });

    const res = await app.request(`/api/players/${player.id}/upgrade`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cost).toBe(50);
    expect(body.newElectricityPerSecond).toBe(2);
    expect(body.player.electricityPerSecond).toBe(2);
    expect(body.player.electricity).toBe(50);
  });
});

describe('GET /api/players/:id/upgrade', () => {
  it('업그레이드 정보를 조회할 수 있어야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 200, electricityPerSecond: 5 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/upgrade`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentElectricityPerSecond).toBe(5);
    expect(body.nextElectricityPerSecond).toBe(6);
    expect(body.cost).toBe(250);
    expect(body.canAfford).toBe(false);
  });
});

function mockResearch(levels: Record<string, number>): void {
  const now = new Date().toISOString();
  vi.spyOn(jsonResearchRepo, 'getAll').mockResolvedValue(Object.entries(levels).map(([code, level]) => ({
    id: code, playerId: 'p', code, level, completed: 0, createdAt: now, updatedAt: now,
  })));
}

describe('업그레이드 비용 연구 할인', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calcResearchBonus는 기존 3인자 호출 결과를 유지한다', () => {
    expect(calcResearchBonus(0, 0, 0)).toEqual(DEFAULT_RESEARCH_BONUS);
    expect(calcResearchBonus(2, 1, 3)).toEqual({
      ...DEFAULT_RESEARCH_BONUS, idleProdMultiplier: 1.4, extraMaxIdleSeconds: 7200, idleRewardMultiplier: 1.45,
    });
  });

  it('생산/수집 연구는 배율에 반영되고 할인은 최소 0.20 배율로 제한된다', () => {
    const bonus = calcResearchBonus(0, 0, 0, 2, 1, 3, 2, 1);
    expect(bonus.idleProdMultiplier).toBeCloseTo(1 + 0.2 + 0.15);
    expect(bonus.claimBonusMultiplier).toBeCloseTo(1.3);
    expect(bonus.upgradeCostMultiplier).toBe(0.82);
    expect(calcResearchBonus(0, 0, 0, 0, 0, 0, 20, 20).upgradeCostMultiplier).toBe(0.2);
    expect(calcUpgradeCost(5, calcResearchBonus(0, 0, 0, 0, 0, 0, 2, 1))).toBe(205);
    expect(calcUpgradeCost(1, calcResearchBonus(0, 0, 0, 0, 0, 0, 20, 20))).toBe(10);
    expect(calcUpgradeCost(0)).toBe(1);
  });

  it('GET/POST /players/:id/upgrade가 같은 할인 비용을 사용한다', async () => {
    mockResearch({ econ_upgrade_discount_1: 2, econ_upgrade_discount_2: 1 });
    const app = createApp();
    const player = await createOwnedPlayer({ electricity: 300, electricityPerSecond: 5 });

    const info = await app.request(`/api/players/${player.id}/upgrade`, { method: 'GET' });
    const infoBody = await info.json();
    expect(infoBody.cost).toBe(205);
    expect(infoBody.canAfford).toBe(true);

    const res = await app.request(`/api/players/${player.id}/upgrade`, { method: 'POST', headers: authToken() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cost).toBe(205);
    expect(body.player.electricity).toBe(95);
    expect(body.newElectricityPerSecond).toBe(6);
  });
});


describe('GET /api/rankings', () => {
  it('플레이어가 없으면 빈 배열을 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/rankings', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('totalWealth 기준으로 내림차순 정렬되어야 한다', async () => {
    const app = createApp();
    const pastTime = new Date(Date.now() - 10000).toISOString();
    const p1 = makePlayer({ id: 'p1', nickname: '부자', electricity: 1000, electricityPerSecond: 10, lastClaimedAt: pastTime });
    const p2 = makePlayer({ id: 'p2', nickname: '거지', electricity: 10, electricityPerSecond: 1, lastClaimedAt: pastTime });
    createPlayer(p1);
    createPlayer(p2);

    const res = await app.request('/api/rankings', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('p1'); // p1이 더 부자
    expect(body[1].id).toBe('p2');
    expect(body[0].totalWealth).toBeGreaterThan(body[1].totalWealth);
  });

  it('limit/offset 쿼리로 랭킹을 페이지네이션할 수 있어야 한다', async () => {
    const app = createApp();
    const pastTime = new Date(Date.now() - 10000).toISOString();
    createPlayer(makePlayer({ id: 'p1', nickname: '부자', electricity: 1000, electricityPerSecond: 10, lastClaimedAt: pastTime }));
    createPlayer(makePlayer({ id: 'p2', nickname: '거지', electricity: 10, electricityPerSecond: 1, lastClaimedAt: pastTime }));

    const res = await app.request('/api/rankings?limit=1&offset=1', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('p2');
  });
});

describe('GET /api/players/:id/idle-rewards', () => {
  it('방치 보상 정보를 조회할 수 있어야 한다', async () => {
    const app = createApp();
    const pastTime = new Date(Date.now() - 5000).toISOString();
    const player = makePlayer({ lastClaimedAt: pastTime, electricityPerSecond: 2 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/idle-rewards`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingReward).toBeGreaterThanOrEqual(8); // ~5초 * 2 = 10
    expect(body.electricityPerSecond).toBe(2);
    expect(body.maxCapped).toBe(false);
    expect(body.maxIdleHours).toBe(8);
    expect(body.offlineTime).toBeDefined();
  });
});

describe('비밀값 노출 방지', () => {
  const SECRET_FIELDS = ['apiKey', 'lastClaimedAt', 'updatedAt'] as const;

  function expectNoSecrets(body: Record<string, unknown>) {
    for (const field of SECRET_FIELDS) {
      expect(body).not.toHaveProperty(field);
    }
  }

  it('POST /api/players 생성 응답에 apiKey가 없어야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '비밀테스트' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty('apiKey');
  });

  it('GET /api/players/:id 응답에 비밀값이 없어야 한다', async () => {
    const app = createApp();
    const player = makePlayer();
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}`, { method: 'GET' });
    expect(res.status).toBe(200);
    expectNoSecrets(await res.json());
  });
  it('플레이어 API는 오래된 Player 잔액 캐시 대신 지갑 잔액을 반환한다', async () => {
    const app = createApp();
    const player = await createOwnedPlayer({ electricity: 10, electricityPerSecond: 2 });
    const { adjustBalance } = await import('../shared/wallet.js');
    await adjustBalance(player.id, 30, 'test', crypto.randomUUID());
    updatePlayer(player.id, { electricity: 999, electricityPerSecond: 99 });

    const response = await app.request(`/api/players/${player.id}`, { method: 'GET' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      electricity: 40,
      electricityPerSecond: 2,
    });
  });

  it('GET /api/players 목록 응답에 비밀값이 없어야 한다', async () => {
    const app = createApp();
    createPlayer(makePlayer());
    createPlayer(makePlayer());

    const res = await app.request('/api/players', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(2);
    for (const p of body) {
      expectNoSecrets(p);
    }
  });

  it('POST .../claim 응답의 player에 비밀값이 없어야 한다', async () => {
    const app = createApp();
    const pastTime = new Date(Date.now() - 10000).toISOString();
    const player = await createOwnedPlayer({ lastClaimedAt: pastTime });

    const res = await app.request(`/api/players/${player.id}/claim`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoSecrets(body.player);
  });

  it('POST .../upgrade 응답의 player에 비밀값이 없어야 한다', async () => {
    const app = createApp();
    const player = await createOwnedPlayer({ electricity: 100, electricityPerSecond: 1 });

    const res = await app.request(`/api/players/${player.id}/upgrade`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoSecrets(body.player);
  });

  it('GET /api/rankings 응답에 apiKey가 없어야 한다', async () => {
    const app = createApp();
    const pastTime = new Date(Date.now() - 10000).toISOString();
    createPlayer(makePlayer({ nickname: '랭커', electricity: 500, lastClaimedAt: pastTime }));
    createPlayer(makePlayer({ nickname: '꼴찌', electricity: 10, lastClaimedAt: pastTime }));

    const res = await app.request('/api/rankings', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(2);
    for (const entry of body) {
      expect(entry).not.toHaveProperty('apiKey');
      expect(entry).not.toHaveProperty('lastClaimedAt');
      expect(entry).not.toHaveProperty('updatedAt');
    }
  });
});

describe('데이터 격리', () => {
  it('임시 디렉터리를 사용해야 한다', () => {
    expect(tmpDir).toContain('idle-game-test-routes');
    expect(existsSync(tmpDir)).toBe(true);
  });

  it('실제 data.json을 생성하거나 수정하지 않아야 한다', async () => {
    const existedBefore = existsSync('data.json');
    const contentBefore = existedBefore ? readFileSync('data.json', 'utf-8') : null;

    const app = createApp();
    const res = await app.request('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '격리테스트' }),
    });
    expect(res.status).toBe(201);

    if (existedBefore) {
      expect(existsSync('data.json')).toBe(true);
      expect(readFileSync('data.json', 'utf-8')).toBe(contentBefore);
    } else {
      expect(existsSync('data.json')).toBe(false);
    }
  });
});

afterAll(() => {
  resetAllRepos();
  resetAuthStores();
  resetWalletStores();
  for (const name of STORE_FILE_ENV) {
    const value = originalStoreFileEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});
