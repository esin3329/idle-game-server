import { Hono } from 'hono';
import type { Player } from './types.js';
import { toPublicPlayerDto } from './dto.js';
import { jwtAuth } from './shared/jwt-auth.js';
import { idempotencyGuard } from './shared/idempotency.js';
import type { ClaimResponse, UpgradeResponse, BattleResponse } from './dto.js';
import { NotFoundError, InsufficientResourceError, InternalError, AppError } from './shared/errors.js';
import { validatePlayerId, validateJson, createPlayerSchema } from './shared/validator.js';
import { getRepo, getResearchRepo } from './provider.js';
import { logger } from './shared/logger.js';
import { rateLimit } from './shared/rate-limit.js';
import { getBalance, adjustBalance, updateEps, updateLastClaimedAt } from './shared/wallet.js';
import { updateRanking, getTopRankings, isRedisAvailable } from './shared/redis.js';
import { GAME, calculateProduction, calcResearchBonus, DEFAULT_RESEARCH_BONUS } from './shared/game-math.js';

const routes = new Hono<{ Variables: { parsedBody: { nickname: string }; player: Player; idempotencyKey: string } }>();

// 공통: 플레이어 조회 (async, provider 경유)
async function requirePlayer(id: string): Promise<Player> {
  const repo = await getRepo();
  const player = await repo.getPlayer(id);
  if (!player) throw new NotFoundError('플레이어');
  return player;
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

  // wallet_balances 기준 lastClaimedAt + eps 사용
  const walletInfo = await getBalance(id);
  const refLastClaimed = walletInfo?.lastClaimedAt || player.lastClaimedAt;
  const refEps = walletInfo?.electricityPerSecond || player.electricityPerSecond;

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

  // wallet_balances + currency_ledger (트랜잭션)
  await adjustBalance(id, produced, 'claim', idempotencyKey, 'electricity', '방치 생산 수집', 'player', id);
  // lastClaimedAt 갱신 (wallet)
  await updateLastClaimedAt(id, new Date(nowISO));

  // players 테이블 동기화
  const repo = await getRepo();
  const updated = await repo.updatePlayer(id, {
    electricity: player.electricity + produced,
    lastClaimedAt: nowISO,
  });

  if (!updated) throw new InternalError();

  logger.info({ playerId: id, claimed: produced, elapsed: elapsedSeconds, event: 'claim' });

  // Redis 랭킹 업데이트
  updateRanking(id, updated.electricity + produced).catch(() => {});

  return c.json({
    player: toPublicPlayerDto(updated),
    claimed: produced,
    elapsedSeconds,
    maxCapped,
  } satisfies ClaimResponse);
});

routes.get('/api/players/:id/claim', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  const id = c.req.param('id')!;

  // wallet_balances 기준
  const walletInfo = await getBalance(id);
  const refLastClaimed = walletInfo?.lastClaimedAt || player.lastClaimedAt;
  const refEps = walletInfo?.electricityPerSecond || player.electricityPerSecond;

  const researchBonus = await getResearchBonus(id);

  const { elapsed, produced: pending, maxCapped } = calculateProduction(
    refLastClaimed,
    refEps,
    researchBonus,
  );
  return c.json({ pending, elapsedSeconds: elapsed, maxCapped, electricityPerSecond: refEps });
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

  const idempotencyKey = c.get('idempotencyKey');

  // wallet_balances 차감 + 원장 기록 (트랜잭션)
  await adjustBalance(id, -cost, 'upgrade', idempotencyKey, 'electricity', 'EPS 업그레이드 비용', 'player', id);
  // wallet_balances EPS 갱신
  await updateEps(id, player.electricityPerSecond + 1);

  const repo = await getRepo();
  const updated = await repo.updatePlayer(id, {
    electricity: player.electricity - cost,
    electricityPerSecond: player.electricityPerSecond + 1,
  });

  if (!updated) throw new InternalError();

  logger.info({ playerId: id, cost, newEps: updated.electricityPerSecond, event: 'upgrade' });

  // Redis 랭킹 업데이트
  updateRanking(id, updated.electricity).catch(() => {});

  return c.json({ player: toPublicPlayerDto(updated), cost, newElectricityPerSecond: updated.electricityPerSecond } satisfies UpgradeResponse);
});

// ─── 방치 보상 ─────────────────────────────────────

routes.get('/api/players/:id/idle-rewards', validatePlayerId, async (c) => {
  const player = await requirePlayer(c.req.param('id')!);
  const id = c.req.param('id')!;

  // wallet_balances 기준
  const walletInfo = await getBalance(id);
  const refLastClaimed = walletInfo?.lastClaimedAt || player.lastClaimedAt;
  const refEps = walletInfo?.electricityPerSecond || player.electricityPerSecond;

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

  const idempotencyKey = c.get('idempotencyKey');

  if (reward > 0) {
    // wallet_balances 증가 + 원장 기록 (트랜잭션)
    await adjustBalance(id, reward, 'battle', idempotencyKey, 'electricity', `전투 승리 (${enemyName})`, 'player', id);
  }

  const repo = await getRepo();
  const updated = await repo.updatePlayer(id, { electricity: player.electricity + reward });
  if (!updated) throw new InternalError();

  logger.info({ playerId: id, won, reward, enemy: enemyName, event: 'battle' });

  // Redis 랭킹 업데이트
  updateRanking(id, updated.electricity).catch(() => {});

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
  // Redis 우선 조회
  if (isRedisAvailable()) {
    const top = await getTopRankings(100);
    if (top.length > 0) {
      const repo = await getRepo();
      const players = await repo.getAllPlayers();
      const playerMap = new Map(players.map((p) => [p.id, p]));
      const rankings = top.map((r) => {
        const p = playerMap.get(r.playerId);
        return {
          id: r.playerId,
          nickname: p?.nickname || 'Unknown',
          electricity: p?.electricity || 0,
          electricityPerSecond: p?.electricityPerSecond || 0,
          totalWealth: r.score,
        };
      });
      return c.json(rankings);
    }
  }

  // Redis 없거나 비어있으면 기존 방식
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
