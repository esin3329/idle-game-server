import { Hono } from 'hono';
import type { Player } from './types.js';
import { toPublicPlayerDto } from './dto.js';
import { jwtAuth } from './shared/jwt-auth.js';
import { idempotencyGuard } from './shared/idempotency.js';
import type { ClaimResponse, UpgradeResponse } from './dto.js';
import { NotFoundError, InsufficientResourceError, AppError } from './shared/errors.js';
import { validatePlayerId, validateJson, createPlayerSchema } from './shared/validator.js';
import { getRepo, getResearchRepo, getAuthRepo, getWalletRepo } from './provider.js';
import { logger } from './shared/logger.js';
import { rateLimit } from './shared/rate-limit.js';
import { getBalance, adjustBalance, updateEps, updateLastClaimedAt } from './shared/wallet.js';
import { GAME, calculateProduction, calcResearchBonus, DEFAULT_RESEARCH_BONUS } from './shared/game-math.js';
import { requirePlayerOwnership } from './shared/player-identity.js';

const routes = new Hono<{ Variables: { parsedBody: { nickname: string }; player: Player; idempotencyKey: string } }>();

// 공통: 플레이어 조회 (async, provider 경유)
async function requirePlayer(id: string): Promise<Player> {
  const repo = await getRepo();
  const player = await repo.getPlayer(id);
  if (!player) throw new NotFoundError('플레이어');
  const wallet = await getBalance(id);
  if (!wallet) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
  return {
    ...player,
    electricity: wallet.balance,
    electricityPerSecond: wallet.electricityPerSecond,
    lastClaimedAt: wallet.lastClaimedAt,
  };
}

async function playersWithWallet(players: Player[]): Promise<Player[]> {
  const walletRepo = await getWalletRepo();
  const balances = await walletRepo.getBalances(players.map((player) => player.id));
  const balancesByPlayerId = new Map(balances.map((balance) => [balance.playerId, balance]));
  return players.map((player) => {
    const balance = balancesByPlayerId.get(player.id);
    if (!balance) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
    return {
      ...player,
      electricity: balance.balance,
      electricityPerSecond: balance.electricityPerSecond,
      lastClaimedAt: balance.lastClaimedAt,
    };
  });
}

// 공통: 연구 보너스 조회
async function getResearchBonus(playerId: string) {
  try {
    const researchRepo = await getResearchRepo();
    const allResearch = await researchRepo.getAll(playerId);
    const prodPassiveLv = allResearch.find((r) => r.code === 'prod_passive')?.level || 0;
    const prodCapLv = allResearch.find((r) => r.code === 'prod_cap')?.level || 0;
    const idleRewardLv = allResearch.find((r) => r.code === 'util_idle_reward')?.level || 0;
    return calcResearchBonus(prodPassiveLv, prodCapLv, idleRewardLv);
  } catch {
    return DEFAULT_RESEARCH_BONUS;
  }
}

// ─── 플레이어 ──────────────────────────────────────

routes.post('/players', validateJson(createPlayerSchema), async (c) => {
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

routes.get('/players/:id', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  return c.json(toPublicPlayerDto(player));
});

routes.get('/players', async (c) => {
  const repo = await getRepo();
  const players = await playersWithWallet(await repo.getAllPlayers());
  return c.json(players.map(toPublicPlayerDto));
});

// ─── Claim ─────────────────────────────────────────

routes.post('/players/:id/claim', validatePlayerId, jwtAuth, idempotencyGuard, rateLimit(1, 1000), async (c) => {
  const id = await requirePlayerOwnership(c.get('userId'), c.req.param('id')!);
  const player = await requirePlayer(id);

  const refLastClaimed = player.lastClaimedAt;
  const refEps = player.electricityPerSecond;

  const researchBonus = await getResearchBonus(id);

  const { elapsed: elapsedSeconds, produced, maxCapped } = calculateProduction(
    refLastClaimed,
    refEps,
    researchBonus,
  );

  if (elapsedSeconds <= 0) {
    return c.json({ player: toPublicPlayerDto(player), claimed: 0, elapsedSeconds: 0, maxCapped: false } satisfies ClaimResponse);
  }

  const nowISO = new Date().toISOString();
  const idempotencyKey = c.get('idempotencyKey');

  const adjusted = await adjustBalance(id, produced, 'claim', idempotencyKey, 'electricity', '방치 생산 수집', 'player', id);
  if (!adjusted.success) throw new AppError('이미 처리된 청구 요청입니다.', 409, 'DUPLICATE_REQUEST');
  await updateLastClaimedAt(id, new Date(nowISO));

  const updated = {
    ...player,
    electricity: adjusted.balanceAfter,
    lastClaimedAt: nowISO,
  };

  logger.info({ playerId: id, claimed: produced, elapsed: elapsedSeconds, event: 'claim' });

  return c.json({
    player: toPublicPlayerDto(updated),
    claimed: produced,
    elapsedSeconds,
    maxCapped,
  } satisfies ClaimResponse);
});

routes.get('/players/:id/claim', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  const id = c.req.param('id')!;

  const refLastClaimed = player.lastClaimedAt;
  const refEps = player.electricityPerSecond;

  const researchBonus = await getResearchBonus(id);

  const { elapsed, produced: pending, maxCapped } = calculateProduction(
    refLastClaimed,
    refEps,
    researchBonus,
  );
  return c.json({ pending, elapsedSeconds: elapsed, maxCapped, electricityPerSecond: refEps });
});

// ─── 업그레이드 ────────────────────────────────────

routes.get('/players/:id/upgrade', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  const cost = player.electricityPerSecond * GAME.UPGRADE_COST_MULTIPLIER;

  return c.json({
    currentElectricityPerSecond: player.electricityPerSecond,
    nextElectricityPerSecond: player.electricityPerSecond + 1,
    cost,
    canAfford: player.electricity >= cost,
  });
});

routes.post('/players/:id/upgrade', validatePlayerId, jwtAuth, idempotencyGuard, rateLimit(2, 1000), async (c) => {
  const id = await requirePlayerOwnership(c.get('userId'), c.req.param('id')!);
  const player = await requirePlayer(id);
  const cost = player.electricityPerSecond * GAME.UPGRADE_COST_MULTIPLIER;

  if (player.electricity < cost) {
    throw new InsufficientResourceError('전기', cost, player.electricity);
  }

  const idempotencyKey = c.get('idempotencyKey');
  const adjusted = await adjustBalance(id, -cost, 'upgrade', idempotencyKey, 'electricity', 'EPS 업그레이드 비용', 'player', id);
  if (!adjusted.success) throw new AppError('이미 처리된 업그레이드 요청입니다.', 409, 'DUPLICATE_REQUEST');
  const nextEps = player.electricityPerSecond + 1;
  await updateEps(id, nextEps);

  const updated = {
    ...player,
    electricity: adjusted.balanceAfter,
    electricityPerSecond: nextEps,
  };

  logger.info({ playerId: id, cost, newEps: updated.electricityPerSecond, event: 'upgrade' });

  return c.json({ player: toPublicPlayerDto(updated), cost, newElectricityPerSecond: updated.electricityPerSecond } satisfies UpgradeResponse);
});

// ─── 방치 보상 ─────────────────────────────────────

routes.get('/players/:id/idle-rewards', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  const id = c.req.param('id')!;

  const refLastClaimed = player.lastClaimedAt;
  const refEps = player.electricityPerSecond;

  const researchBonus = await getResearchBonus(id);

  const { elapsed: elapsedSeconds, produced: pending, maxCapped } = calculateProduction(
    refLastClaimed,
    refEps,
    researchBonus,
  );

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  return c.json({
    offlineTime: `${hours}h ${minutes}m ${seconds}s`,
    pendingReward: pending,
    electricityPerSecond: refEps,
    maxCapped,
    maxIdleHours: GAME.MAX_IDLE_SECONDS / 3600,
  });
});


// ─── 지갑 ──────────────────────────────────────────

routes.get('/wallet', jwtAuth, async (c) => {
  const userId = c.get('userId')!;
  const walletRepo = await getWalletRepo();

  const authRepo = await getAuthRepo();
  const profile = await authRepo.findProfileByUserId(userId);
  if (!profile) {
    throw new NotFoundError('플레이어');
  }

  const balance = await walletRepo.getBalance(profile.playerId);
  if (!balance) {
    throw new NotFoundError('지갑');
  }

  return c.json({
    playerId: profile.playerId,
    electricity: balance.balance,
    scrap: balance.scrap,
    electricityPerSecond: balance.electricityPerSecond,
  });
});

// ─── 랭킹 ──────────────────────────────────────────

routes.get('/rankings', async (c) => {
  const repo = await getRepo();
  const players = await playersWithWallet(await repo.getAllPlayers());

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
