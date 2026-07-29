import { Hono } from 'hono';
import type { Player } from './types.js';
import { toPublicPlayerDto } from './dto.js';
import { jwtAuth } from './shared/jwt-auth.js';
import { idempotencyGuard } from './shared/idempotency.js';
import type { ClaimResponse, UpgradeResponse, BattleResponse } from './dto.js';
import { NotFoundError, InsufficientResourceError, InternalError, AppError } from './shared/errors.js';
import { validatePlayerId, validateJson, createPlayerSchema } from './shared/validator.js';
import { getRepo } from './provider.js';
import { logger } from './shared/logger.js';
import { rateLimit } from './shared/rate-limit.js';
import { GAME, calculateProduction } from './shared/game-math.js';

const routes = new Hono<{ Variables: { parsedBody: { nickname: string }; player: Player } }>();

// 공통: 플레이어 조회 (async, provider 경유)
async function requirePlayer(id: string): Promise<Player> {
  const repo = await getRepo();
  const player = await repo.getPlayer(id);
  if (!player) throw new NotFoundError('플레이어');
  return player;
}

// ─── 플레이어 ──────────────────────────────────────

routes.post('/api/players', validateJson(createPlayerSchema), async (c) => {
  const repo = await getRepo();
  const { nickname } = c.get('parsedBody');

  // 닉네임 중복 체크
  const allPlayers = await repo.getAllPlayers();
  const existing = allPlayers.find((p) => p.nickname === nickname);
  if (existing) {
    throw new AppError('이미 사용 중인 닉네임입니다.', 409, 'NICKNAME_CONFLICT');
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const player = await repo.createPlayer({
    id,
    nickname,
    apiKey,
    electricity: 0,
    electricityPerSecond: GAME.BASE_ELECTRICITY_PER_SECOND,
    lastClaimedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(toPublicPlayerDto(player), 201);
});

routes.get('/api/players/:id', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  return c.json(toPublicPlayerDto(player));
});

routes.get('/api/players', async (c) => {
  const repo = await getRepo();
  const players = (await repo.getAllPlayers()).map(toPublicPlayerDto);
  return c.json(players);
});

// ─── Claim ─────────────────────────────────────────

routes.post('/api/players/:id/claim', validatePlayerId, rateLimit(1, 1000), idempotencyGuard, jwtAuth, async (c) => {
  const id = c.req.param('id')!;
  const player = await requirePlayer(id);

  const { elapsed: elapsedSeconds, produced, maxCapped } = calculateProduction(
    player.lastClaimedAt,
    player.electricityPerSecond,
  );

  if (elapsedSeconds <= 0) {
    return c.json({ player: toPublicPlayerDto(player), claimed: 0, elapsedSeconds: 0, maxCapped: false } satisfies ClaimResponse);
  }

  const nowISO = new Date().toISOString();

  const repo = await getRepo();
  const updated = await repo.updatePlayer(id, {
    electricity: player.electricity + produced,
    lastClaimedAt: nowISO,
  });

  if (!updated) throw new InternalError();

  logger.info({ playerId: id, claimed: produced, elapsed: elapsedSeconds, event: 'claim' });

  return c.json({
    player: toPublicPlayerDto(updated),
    claimed: produced,
    elapsedSeconds,
    maxCapped,
  } satisfies ClaimResponse);
});

routes.get('/api/players/:id/claim', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  const { elapsed, produced: pending, maxCapped } = calculateProduction(
    player.lastClaimedAt,
    player.electricityPerSecond,
  );
  return c.json({ pending, elapsedSeconds: elapsed, maxCapped, electricityPerSecond: player.electricityPerSecond });
});

// ─── 업그레이드 ────────────────────────────────────

routes.get('/api/players/:id/upgrade', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  const cost = player.electricityPerSecond * GAME.UPGRADE_COST_MULTIPLIER;

  return c.json({
    currentElectricityPerSecond: player.electricityPerSecond,
    nextElectricityPerSecond: player.electricityPerSecond + 1,
    cost,
    canAfford: player.electricity >= cost,
  });
});

routes.post('/api/players/:id/upgrade', validatePlayerId, rateLimit(2, 1000), idempotencyGuard, jwtAuth, async (c) => {
  const id = c.req.param('id')!;
  const player = await requirePlayer(id);
  const cost = player.electricityPerSecond * GAME.UPGRADE_COST_MULTIPLIER;

  if (player.electricity < cost) {
    throw new InsufficientResourceError('전기', cost, player.electricity);
  }

  const repo = await getRepo();
  const updated = await repo.updatePlayer(id, {
    electricity: player.electricity - cost,
    electricityPerSecond: player.electricityPerSecond + 1,
  });

  if (!updated) throw new InternalError();

  logger.info({ playerId: id, cost, newEps: updated.electricityPerSecond, event: 'upgrade' });

  return c.json({ player: toPublicPlayerDto(updated), cost, newElectricityPerSecond: updated.electricityPerSecond } satisfies UpgradeResponse);
});

// ─── 방치 보상 ─────────────────────────────────────

routes.get('/api/players/:id/idle-rewards', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
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

routes.post('/api/players/:id/battle', validatePlayerId, rateLimit(1, 3000), idempotencyGuard, jwtAuth, async (c) => {
  const id = c.req.param('id')!;
  const player = await requirePlayer(id);
  const playerPower = player.electricityPerSecond * GAME.COMBAT_POWER_PER_EPS;

  const enemyVariance = 1.0 + (Math.random() * GAME.ENEMY_POWER_VARIANCE * 2 - GAME.ENEMY_POWER_VARIANCE);
  const enemyPower = Math.max(1, Math.floor(playerPower * enemyVariance));

  const enemyNames = ['좀비', '슬라임', '고블린', '스켈레톤', '도적', '트롤', '다크메이지', '미믹'];
  const enemyName = enemyNames[Math.floor(Math.random() * enemyNames.length)];

  const won = playerPower >= enemyPower;
  const baseReward = player.electricityPerSecond * GAME.BATTLE_REWARD_PER_EPS;
  const reward = won
    ? Math.floor(baseReward * (GAME.BATTLE_REWARD_MIN_RATIO + Math.random() * (GAME.BATTLE_REWARD_MAX_RATIO - GAME.BATTLE_REWARD_MIN_RATIO)))
    : 0;

  const repo = await getRepo();
  const updated = await repo.updatePlayer(id, { electricity: player.electricity + reward });
  if (!updated) throw new InternalError();

  logger.info({ playerId: id, won, reward, enemy: enemyName, event: 'battle' });

  return c.json({ player: toPublicPlayerDto(updated), won, reward, enemyName, enemyPower, playerPower } satisfies BattleResponse);
});

// ─── 지갑 ──────────────────────────────────────────

routes.get('/wallet', jwtAuth, async (c) => {
  const repo = await getRepo();
  const all = await repo.getAllPlayers();
  const player = all[0]; // TODO: c.get('userId') 기반 조회로 전환

  if (!player) {
    throw new NotFoundError('플레이어');
  }

  return c.json({
    playerId: player.id,
    electricity: player.electricity,
    electricityPerSecond: player.electricityPerSecond,
  });
});

// ─── 랭킹 ──────────────────────────────────────────

routes.get('/api/rankings', async (c) => {
  const repo = await getRepo();
  const players = await repo.getAllPlayers();

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
