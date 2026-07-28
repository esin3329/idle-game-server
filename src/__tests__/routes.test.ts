import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

// ─── 임시 디렉터리 + 주입 ───────────────────────────

const tmpDir = mkdtempSync(join(homedir() || '/tmp', `idle-game-test-routes-`));

import { setDataFilePath } from '../store.js';
import routes from '../routes.js';
import { createPlayer, deletePlayer, getAllPlayers } from '../store.js';
import { clearRateLimits } from '../shared/rate-limit.js';
import { AppError } from '../shared/errors.js';
import type { Player } from '../types.js';

setDataFilePath(join(tmpDir, 'data.json'));

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
beforeEach(() => {
  clearRateLimits();
  const players = getAllPlayers();
  for (const p of players) {
    deletePlayer(p.id);
  }
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
  app.route('/', routes);
  return app;
}

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production';

function authToken(userId = 'test-user-id'): { Authorization: string; 'Idempotency-Key': string } {
  const token = jwt.sign({ sub: userId, type: 'access' }, JWT_SECRET, { expiresIn: 3600 });
  return { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() };
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
    const player = makePlayer({ lastClaimedAt: pastTime });
    createPlayer(player);

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
    const player = makePlayer({ electricity: 0, electricityPerSecond: 1 });
    createPlayer(player);

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
    const player = makePlayer({ electricity: 100, electricityPerSecond: 1 });
    createPlayer(player);

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

describe('POST /api/players/:id/battle', () => {
  it('인증 없이 요청하면 401을 반환해야 한다', async () => {
    const app = createApp();
    const player = makePlayer();
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/battle`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(res.status).toBe(401);
  });

  it('승리 시 전기가 증가하고 보상을 받아야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 100, electricityPerSecond: 10 });
    createPlayer(player);

    // Math.random 시퀀스: [적 변동 최소(0), 적 이름(0), 보상 비율 최소(0)]
    // → enemyVariance = 0.8 (가장 약함), rewardRatio = 0.5 (최소)
    const rand = vi.spyOn(Math, 'random');
    rand.mockReturnValueOnce(0)  // enemy variance → 0.8
          .mockReturnValueOnce(0)  // enemy name index → '좀비'
          .mockReturnValueOnce(0); // reward ratio → 0.5

    const res = await app.request(`/api/players/${player.id}/battle`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.won).toBe(true);
    expect(body.playerPower).toBe(100);
    expect(body.enemyPower).toBeLessThanOrEqual(80); // floor(100 * 0.8) = 80
    expect(body.enemyName).toBe('좀비');
    expect(body.reward).toBe(150); // floor(300 * 0.5) = 150
    expect(body.player.electricity).toBe(250); // 100 + 150

    rand.mockRestore();
  });

  it('적 전투력이 높으면 패배하고 보상이 0이어야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 100, electricityPerSecond: 10 });
    createPlayer(player);

    // Math.random 시퀀스: [적 변동 최대(0.999), 적 이름(0.5), 보상 비율(무관)]
    // → enemyVariance ≈ 1.2 (가장 강함), playerPower=100 < enemyPower=120
    const rand = vi.spyOn(Math, 'random');
    rand.mockReturnValueOnce(0.999)  // enemy variance → ~1.1998
          .mockReturnValueOnce(0.5)    // enemy name
          .mockReturnValueOnce(0);     // reward (ignored for loss)

    const res = await app.request(`/api/players/${player.id}/battle`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.won).toBe(false);
    expect(body.playerPower).toBe(100);
    expect(body.enemyPower).toBeGreaterThan(100);
    expect(body.reward).toBe(0);
    expect(body.player.electricity).toBe(100); // unchanged

    rand.mockRestore();
  });

  it('응답에 필수 필드가 모두 포함되어야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 50, electricityPerSecond: 5 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/battle`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('won');
    expect(body).toHaveProperty('reward');
    expect(body).toHaveProperty('enemyName');
    expect(body).toHaveProperty('enemyPower');
    expect(body).toHaveProperty('playerPower');
    expect(body).toHaveProperty('player');
    expect(body.enemyPower).toBeGreaterThanOrEqual(1);
    expect(typeof body.enemyName).toBe('string');
    expect(body.enemyName.length).toBeGreaterThan(0);
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

  it('POST /api/players 생성 시 apiKey를 포함해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '비밀테스트' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('apiKey');
    expect(typeof body.apiKey).toBe('string');
    expect(body.apiKey.length).toBeGreaterThan(0);
  });

  it('GET /api/players/:id 응답에 비밀값이 없어야 한다', async () => {
    const app = createApp();
    const player = makePlayer();
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}`, { method: 'GET' });
    expect(res.status).toBe(200);
    expectNoSecrets(await res.json());
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
    const player = makePlayer({ lastClaimedAt: pastTime });
    createPlayer(player);

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
    const player = makePlayer({ electricity: 100, electricityPerSecond: 1 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/upgrade`, {
      method: 'POST',
      headers: authToken(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoSecrets(body.player);
  });

  it('POST .../battle 응답의 player에 비밀값이 없어야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 100, electricityPerSecond: 5 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/battle`, {
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
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});
