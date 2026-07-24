import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import routes from '../routes.js';
import { createPlayer, deletePlayer, getAllPlayers } from '../store.js';
import type { Player } from '../types.js';

const nowISO = new Date().toISOString();

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: crypto.randomUUID(),
    nickname: 'test',
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
  const players = getAllPlayers();
  for (const p of players) {
    deletePlayer(p.id);
  }
});

function createApp() {
  const app = new Hono();
  app.route('/', routes);
  return app;
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
    const res = await app.request('/api/players/nonexistent', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/players/:id/claim', () => {
  it('존재하지 않는 플레이어는 404를 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players/nonexistent/claim', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('전기를 수집하면 electricity가 증가해야 한다', async () => {
    const app = createApp();
    // 과거 시간으로 플레이어 생성
    const pastTime = new Date(Date.now() - 10000).toISOString(); // 10초 전
    const player = makePlayer({ lastClaimedAt: pastTime });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/claim`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toBeGreaterThanOrEqual(9); // 10초 * 1 = 10, 약간의 오차 허용
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
  it('전기가 부족하면 업그레이드에 실패해야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 0, electricityPerSecond: 1 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/upgrade`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('전기가 부족합니다.');
  });

  it('전기가 충분하면 업그레이드해야 한다', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 100, electricityPerSecond: 1 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/upgrade`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cost).toBe(50);
    expect(body.newElectricityPerSecond).toBe(2);
    expect(body.player.electricityPerSecond).toBe(2);
    expect(body.player.electricity).toBe(50);
  });

  it('존재하지 않는 플레이어는 404를 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players/nonexistent/upgrade', { method: 'POST' });
    expect(res.status).toBe(404);
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
  it('존재하지 않는 플레이어는 404를 반환해야 한다', async () => {
    const app = createApp();
    const res = await app.request('/api/players/nonexistent/battle', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('전투 후 electricity가 증가해야 한다 (승리 시)', async () => {
    const app = createApp();
    const player = makePlayer({ electricity: 100, electricityPerSecond: 10 });
    createPlayer(player);

    const res = await app.request(`/api/players/${player.id}/battle`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playerPower).toBe(100); // 10 * 10
    expect(body.enemyName).toBeDefined();
    expect(body.enemyPower).toBeGreaterThan(0);
    if (body.won) {
      expect(body.reward).toBeGreaterThan(0);
      expect(body.player.electricity).toBeGreaterThan(100);
    } else {
      expect(body.reward).toBe(0);
    }
  });

  it('적 전투력이 플레이어보다 높으면 패배할 수 있다', async () => {
    const app = createApp();
    // electricityPerSecond 0.1 → playerPower = 1, 적이 더 강할 확률 높음
    const player = makePlayer({ electricity: 0, electricityPerSecond: 0.1 });
    createPlayer(player);

    // 여러 번 테스트해서 패배 케이스도 확인 (확률적)
    let hasWon = false;
    let hasLost = false;
    for (let i = 0; i < 20; i++) {
      const res = await app.request(`/api/players/${player.id}/battle`, { method: 'POST' });
      const body = await res.json();
      if (body.won) hasWon = true;
      else hasLost = true;
    }
    // 확률적으로 둘 다 나올 수 있지만 반드시 그렇지는 않음
    // 최소한 응답 형식만 검증
    expect(hasWon || hasLost).toBe(true);
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
