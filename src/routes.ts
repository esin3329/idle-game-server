import { Hono } from 'hono';
import type { ClaimResponse, UpgradeResponse, BattleResponse } from './types.js';
import { NotFoundError, InsufficientResourceError, InternalError } from './shared/errors.js';
import { validatePlayerId, validateJson, createPlayerSchema } from './shared/validator.js';
import { authMiddleware } from './shared/auth.js';
import { createPlayer, getPlayer, getAllPlayers, updatePlayer } from './store.js';
import type { z } from 'zod';

const routes = new Hono();

// 공통: 플레이어 조회
function requirePlayer(id: string) {
  const player = getPlayer(id);
  if (!player) throw new NotFoundError('플레이어');
  return player;
}

// ─── 플레이어 ──────────────────────────────────────

routes.post('/api/players', validateJson(createPlayerSchema), (c) => {
  const { nickname } = c.get('parsedBody') as z.infer<typeof createPlayerSchema>;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const player = createPlayer({
    id,
    nickname,
    apiKey,
    electricity: 0,
    electricityPerSecond: 1,
    lastClaimedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(player, 201);
});

routes.get('/api/players/:id', validatePlayerId, (c) => {
  return c.json(requirePlayer(c.req.param('id')));
});

routes.get('/api/players', (c) => {
  return c.json(getAllPlayers());
});

// ─── Claim ─────────────────────────────────────────

routes.post('/api/players/:id/claim', validatePlayerId, authMiddleware, (c) => {
  const id = c.req.param('id');
  const player = requirePlayer(id);

  const now = Date.now();
  const lastClaimed = new Date(player.lastClaimedAt).getTime();
  const maxIdleSeconds = 8 * 60 * 60;
  const rawSeconds = Math.floor((now - lastClaimed) / 1000);
  const elapsedSeconds = Math.min(rawSeconds, maxIdleSeconds);

  if (elapsedSeconds <= 0) {
    return c.json({ player, claimed: 0, elapsedSeconds: 0, maxCapped: false } as ClaimResponse);
  }

  const produced = elapsedSeconds * player.electricityPerSecond;
  const nowISO = new Date(now).toISOString();

  const updated = updatePlayer(id, {
    electricity: player.electricity + produced,
    lastClaimedAt: nowISO,
  });

  if (!updated) throw new InternalError();

  return c.json({
    player: updated,
    claimed: produced,
    elapsedSeconds,
    maxCapped: rawSeconds > maxIdleSeconds,
  } as ClaimResponse);
});

routes.get('/api/players/:id/claim', validatePlayerId, (c) => {
  const player = requirePlayer(c.req.param('id'));
  const now = Date.now();
  const lastClaimed = new Date(player.lastClaimedAt).getTime();
  const maxIdleSeconds = 8 * 60 * 60;
  const rawSeconds = Math.max(0, Math.floor((now - lastClaimed) / 1000));
  const elapsedSeconds = Math.min(rawSeconds, maxIdleSeconds);
  const pending = elapsedSeconds * player.electricityPerSecond;

  return c.json({ pending, elapsedSeconds, maxCapped: rawSeconds > maxIdleSeconds, electricityPerSecond: player.electricityPerSecond });
});

// ─── 업그레이드 ────────────────────────────────────

routes.get('/api/players/:id/upgrade', validatePlayerId, (c) => {
  const player = requirePlayer(c.req.param('id'));
  const cost = player.electricityPerSecond * 50;

  return c.json({
    currentElectricityPerSecond: player.electricityPerSecond,
    nextElectricityPerSecond: player.electricityPerSecond + 1,
    cost,
    canAfford: player.electricity >= cost,
  });
});

routes.post('/api/players/:id/upgrade', validatePlayerId, authMiddleware, (c) => {
  const id = c.req.param('id');
  const player = requirePlayer(id);
  const cost = player.electricityPerSecond * 50;

  if (player.electricity < cost) {
    throw new InsufficientResourceError('전기', cost, player.electricity);
  }

  const updated = updatePlayer(id, {
    electricity: player.electricity - cost,
    electricityPerSecond: player.electricityPerSecond + 1,
  });

  if (!updated) throw new InternalError();

  return c.json({ player: updated, cost, newElectricityPerSecond: updated.electricityPerSecond } as UpgradeResponse);
});

// ─── 방치 보상 ─────────────────────────────────────

routes.get('/api/players/:id/idle-rewards', validatePlayerId, (c) => {
  const player = requirePlayer(c.req.param('id'));
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

// ─── 전투 ──────────────────────────────────────────

routes.post('/api/players/:id/battle', validatePlayerId, authMiddleware, (c) => {
  const id = c.req.param('id');
  const player = requirePlayer(id);
  const playerPower = player.electricityPerSecond * 10;

  const variance = Math.floor(Math.random() * 40 - 20);
  const enemyBasePower = playerPower + Math.floor(playerPower * variance / 100);
  const enemyPower = Math.max(1, enemyBasePower);

  const enemyNames = ['좀비', '슬라임', '고블린', '스켈레톤', '도적', '트롤', '다크메이지', '미믹'];
  const enemyName = enemyNames[Math.floor(Math.random() * enemyNames.length)];

  const won = playerPower >= enemyPower;
  const baseReward = player.electricityPerSecond * 30;
  const reward = won ? Math.floor(baseReward * (0.5 + Math.random())) : 0;

  const updated = updatePlayer(id, { electricity: player.electricity + reward });
  if (!updated) throw new InternalError();

  return c.json({ player: updated, won, reward, enemyName, enemyPower, playerPower } as BattleResponse);
});

// ─── 랭킹 ──────────────────────────────────────────

routes.get('/api/rankings', (c) => {
  const players = getAllPlayers();
  const now = Date.now();

  const rankings = players
    .map((player) => {
      const lastClaimed = new Date(player.lastClaimedAt).getTime();
      const elapsedSeconds = Math.max(0, Math.floor((now - lastClaimed) / 1000));
      const pending = elapsedSeconds * player.electricityPerSecond;
      return {
        id: player.id,
        nickname: player.nickname,
        electricity: player.electricity,
        electricityPerSecond: player.electricityPerSecond,
        totalWealth: player.electricity + pending,
      };
    })
    .sort((a, b) => b.totalWealth - a.totalWealth);

  return c.json(rankings);
});

export default routes;
