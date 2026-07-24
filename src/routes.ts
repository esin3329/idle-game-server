import { Hono } from 'hono';
import type { CreatePlayerRequest, ClaimResponse, UpgradeResponse, BattleResponse } from './types.js';
import { createPlayer, getPlayer, getAllPlayers, updatePlayer } from './store.js';

const routes = new Hono();

// 플레이어 생성
routes.post('/api/players', async (c) => {
  const body = await c.req.json<CreatePlayerRequest>();

  if (!body.nickname || typeof body.nickname !== 'string' || body.nickname.trim().length === 0) {
    return c.json({ error: '닉네임은 필수입니다.' }, 400);
  }

  const nickname = body.nickname.trim();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const player = createPlayer({
    id,
    nickname,
    electricity: 0,
    electricityPerSecond: 1,
    lastClaimedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(player, 201);
});

// 플레이어 단일 조회
routes.get('/api/players/:id', (c) => {
  const id = c.req.param('id');
  const player = getPlayer(id);

  if (!player) {
    return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);
  }

  return c.json(player);
});

// 플레이어 목록 조회
routes.get('/api/players', (c) => {
  const players = getAllPlayers();
  return c.json(players);
});

// 전기 생산 수집 (claim)
routes.post('/api/players/:id/claim', (c) => {
  const id = c.req.param('id');
  const player = getPlayer(id);

  if (!player) {
    return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);
  }

  const now = Date.now();
  const lastClaimed = new Date(player.lastClaimedAt).getTime();
  const maxIdleSeconds = 8 * 60 * 60; // 최대 8시간
  const rawSeconds = Math.floor((now - lastClaimed) / 1000);
  const elapsedSeconds = Math.min(rawSeconds, maxIdleSeconds);

  if (elapsedSeconds <= 0) {
    return c.json({
      player,
      claimed: 0,
      elapsedSeconds: 0,
      maxCapped: false,
    } as ClaimResponse);
  }

  const produced = elapsedSeconds * player.electricityPerSecond;
  const nowISO = new Date(now).toISOString();

  const updated = updatePlayer(id, {
    electricity: player.electricity + produced,
    lastClaimedAt: nowISO,
  });

  if (!updated) {
    return c.json({ error: '업데이트에 실패했습니다.' }, 500);
  }

  return c.json({
    player: updated,
    claimed: produced,
    elapsedSeconds,
    maxCapped: rawSeconds > maxIdleSeconds,
  } as ClaimResponse);
});

// 업그레이드 비용 조회
routes.get('/api/players/:id/upgrade', (c) => {
  const id = c.req.param('id');
  const player = getPlayer(id);

  if (!player) {
    return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);
  }

  const cost = player.electricityPerSecond * 50;

  return c.json({
    currentElectricityPerSecond: player.electricityPerSecond,
    nextElectricityPerSecond: player.electricityPerSecond + 1,
    cost,
    canAfford: player.electricity >= cost,
  });
});

// 업그레이드 구매
routes.post('/api/players/:id/upgrade', (c) => {
  const id = c.req.param('id');
  const player = getPlayer(id);

  if (!player) {
    return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);
  }

  const cost = player.electricityPerSecond * 50;

  if (player.electricity < cost) {
    return c.json({ error: '전기가 부족합니다.', cost, current: player.electricity }, 400);
  }

  const updated = updatePlayer(id, {
    electricity: player.electricity - cost,
    electricityPerSecond: player.electricityPerSecond + 1,
  });

  if (!updated) {
    return c.json({ error: '업데이트에 실패했습니다.' }, 500);
  }

  return c.json({
    player: updated,
    cost,
    newElectricityPerSecond: updated.electricityPerSecond,
  } as UpgradeResponse);
});

// 전기 생산량 조회 (claim 없이 계산만)
routes.get('/api/players/:id/claim', (c) => {
  const id = c.req.param('id');
  const player = getPlayer(id);

  if (!player) {
    return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);
  }

  const now = Date.now();
  const lastClaimed = new Date(player.lastClaimedAt).getTime();
  const maxIdleSeconds = 8 * 60 * 60;
  const rawSeconds = Math.max(0, Math.floor((now - lastClaimed) / 1000));
  const elapsedSeconds = Math.min(rawSeconds, maxIdleSeconds);
  const pending = elapsedSeconds * player.electricityPerSecond;

  return c.json({
    pending,
    elapsedSeconds,
    maxCapped: rawSeconds > maxIdleSeconds,
    electricityPerSecond: player.electricityPerSecond,
  });
});

// 방치 보상 조회
routes.get('/api/players/:id/idle-rewards', (c) => {
  const id = c.req.param('id');
  const player = getPlayer(id);

  if (!player) {
    return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);
  }

  const now = Date.now();
  const lastClaimed = new Date(player.lastClaimedAt).getTime();
  const maxIdleSeconds = 8 * 60 * 60;
  const rawSeconds = Math.max(0, Math.floor((now - lastClaimed) / 1000));
  const elapsedSeconds = Math.min(rawSeconds, maxIdleSeconds);
  const pending = elapsedSeconds * player.electricityPerSecond;

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  return c.json({
    offlineTime: `${hours}h ${minutes}m ${seconds}s`,
    pendingReward: pending,
    electricityPerSecond: player.electricityPerSecond,
    maxCapped: rawSeconds > maxIdleSeconds,
    maxIdleHours: 8,
  });
});

// 전투
routes.post('/api/players/:id/battle', (c) => {
  const id = c.req.param('id');
  const player = getPlayer(id);

  if (!player) {
    return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);
  }

  // 플레이어 전투력 = electricityPerSecond * 10
  const playerPower = player.electricityPerSecond * 10;

  // 적 생성 (플레이어 전투력 기준 ±20% 랜덤)
  const variance = Math.floor(Math.random() * 40 - 20); // -20 ~ +19
  const enemyBasePower = playerPower + Math.floor(playerPower * variance / 100);
  const enemyPower = Math.max(1, enemyBasePower);

  const enemyNames = ['좀비', '슬라임', '고블린', '스켈레톤', '도적', '트롤', '다크메이지', '미믹'];
  const enemyName = enemyNames[Math.floor(Math.random() * enemyNames.length)];

  const won = playerPower >= enemyPower;
  const baseReward = player.electricityPerSecond * 30;
  const reward = won ? Math.floor(baseReward * (0.5 + Math.random())) : 0;

  const updated = updatePlayer(id, {
    electricity: player.electricity + reward,
  });

  if (!updated) {
    return c.json({ error: '업데이트에 실패했습니다.' }, 500);
  }

  return c.json({
    player: updated,
    won,
    reward,
    enemyName,
    enemyPower,
    playerPower,
  } as BattleResponse);
});

// 랭킹
routes.get('/api/rankings', (c) => {
  const players = getAllPlayers();
  const now = Date.now();

  const rankings = players.map((player) => {
    const lastClaimed = new Date(player.lastClaimedAt).getTime();
    const elapsedSeconds = Math.max(0, Math.floor((now - lastClaimed) / 1000));
    const pending = elapsedSeconds * player.electricityPerSecond;
    const totalWealth = player.electricity + pending;

    return {
      id: player.id,
      nickname: player.nickname,
      electricity: player.electricity,
      electricityPerSecond: player.electricityPerSecond,
      totalWealth,
    };
  });

  rankings.sort((a, b) => b.totalWealth - a.totalWealth);

  return c.json(rankings);
});

export default routes;
