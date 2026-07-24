import { Hono } from 'hono';
import type { ClaimResponse, UpgradeResponse, BattleResponse } from './types.js';
import { NotFoundError, InsufficientResourceError, InternalError, AppError } from './shared/errors.js';
import { validatePlayerId, validateJson, createPlayerSchema } from './shared/validator.js';
import { authMiddleware } from './shared/auth.js';
import { createPlayer, getPlayer, getAllPlayers, updatePlayer } from './store.js';
import { logger } from './shared/logger.js';
import { rateLimit } from './shared/rate-limit.js';
import { GAME, calculateProduction } from './shared/game-math.js';
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

  // 닉네임 중복 체크
  const existing = getAllPlayers().find((p) => p.nickname === nickname);
  if (existing) {
    throw new AppError('이미 사용 중인 닉네임입니다.', 409, 'NICKNAME_CONFLICT');
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const player = createPlayer({
    id,
    nickname,
    apiKey,
    electricity: 0,
    electricityPerSecond: GAME.BASE_ELECTRICITY_PER_SECOND,
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

routes.post('/api/players/:id/claim', validatePlayerId, rateLimit(1, 1000), authMiddleware, (c) => {
  const id = c.req.param('id');
  const player = requirePlayer(id);

  const { elapsed: elapsedSeconds, produced, maxCapped } = calculateProduction(
    player.lastClaimedAt,
    player.electricityPerSecond,
  );

  if (elapsedSeconds <= 0) {
    return c.json({ player, claimed: 0, elapsedSeconds: 0, maxCapped: false } as ClaimResponse);
  }

  const nowISO = new Date().toISOString();

  const updated = updatePlayer(id, {
    electricity: player.electricity + produced,
    lastClaimedAt: nowISO,
  });

  if (!updated) throw new InternalError();

  logger.info({ playerId: id, claimed: produced, elapsed: elapsedSeconds, event: 'claim' });

  return c.json({
    player: updated,
    claimed: produced,
    elapsedSeconds,
    maxCapped,
  } as ClaimResponse);
});

routes.get('/api/players/:id/claim', validatePlayerId, (c) => {
  const player = requirePlayer(c.req.param('id'));
  const { elapsed, produced: pending, maxCapped } = calculateProduction(
    player.lastClaimedAt,
    player.electricityPerSecond,
  );
  return c.json({ pending, elapsedSeconds: elapsed, maxCapped, electricityPerSecond: player.electricityPerSecond });
});

// ─── 업그레이드 ────────────────────────────────────

routes.get('/api/players/:id/upgrade', validatePlayerId, (c) => {
  const player = requirePlayer(c.req.param('id'));
  const cost = player.electricityPerSecond * GAME.UPGRADE_COST_MULTIPLIER;

  return c.json({
    currentElectricityPerSecond: player.electricityPerSecond,
    nextElectricityPerSecond: player.electricityPerSecond + 1,
    cost,
    canAfford: player.electricity >= cost,
  });
});

routes.post('/api/players/:id/upgrade', validatePlayerId, rateLimit(2, 1000), authMiddleware, (c) => {
  const id = c.req.param('id');
  const player = requirePlayer(id);
  const cost = player.electricityPerSecond * GAME.UPGRADE_COST_MULTIPLIER;

  if (player.electricity < cost) {
    throw new InsufficientResourceError('전기', cost, player.electricity);
  }

  const updated = updatePlayer(id, {
    electricity: player.electricity - cost,
    electricityPerSecond: player.electricityPerSecond + 1,
  });

  if (!updated) throw new InternalError();

  logger.info({ playerId: id, cost, newEps: updated.electricityPerSecond, event: 'upgrade' });

  return c.json({ player: updated, cost, newElectricityPerSecond: updated.electricityPerSecond } as UpgradeResponse);
});

// ─── 방치 보상 ─────────────────────────────────────

routes.get('/api/players/:id/idle-rewards', validatePlayerId, (c) => {
  const player = requirePlayer(c.req.param('id'));
  const { elapsed: elapsedSeconds, produced: pending, maxCapped } = calculateProduction(
    player.lastClaimedAt,
    player.electricityPerSecond,
  );

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  return c.json({
    offlineTime: `${hours}h ${minutes}m ${seconds}s`,
    pendingReward: pending,
    electricityPerSecond: player.electricityPerSecond,
    maxCapped,
    maxIdleHours: GAME.MAX_IDLE_SECONDS / 3600,
  });
});

// ─── 전투 ──────────────────────────────────────────

routes.post('/api/players/:id/battle', validatePlayerId, rateLimit(1, 3000), authMiddleware, (c) => {
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

  logger.info({ playerId: id, won, reward, enemy: enemyName, event: 'battle' });

  return c.json({ player: updated, won, reward, enemyName, enemyPower, playerPower } as BattleResponse);
});

// ─── 랭킹 ──────────────────────────────────────────

routes.get('/api/rankings', (c) => {
  const players = getAllPlayers();
  const now = Date.now();

  const rankings = players
    .map((player) => {
      const { produced: pending } = calculateProduction(
        player.lastClaimedAt,
        player.electricityPerSecond,
      );
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
