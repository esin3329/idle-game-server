/**
 * 전투 세션 권위 모델 (MVP) — provider 기반
 *
 * 서버가 전투 세션을 생성·관리하며, 클라이언트가 보고하는
 * 이벤트(kill, core_energy, boss defeat)를 통계적 상한선으로 검증한다.
 */
import { getBattleRepo } from '../provider.js';
import { BATTLE_POLICY } from './battle-policy.js';
import { AppError } from './errors.js';
import { logger, auditLog } from './logger.js';

const P = BATTLE_POLICY;

// ═══════════════════════════════════════════════════════
// 타입 정의
// ═══════════════════════════════════════════════════════

export interface BattleSessionState {
  id: string; playerId: string; userId: string; stageId: string;
  status: string; coreEnergy: number; battleLevel: number;
  killsReported: number; scrapAccumulated: number;
  upgradesApplied: string[]; offeredChoices: UpgradeChoice[];
  bossDefeated: string[]; highestBossSequence: number;
  statSnapshot: MechaStatSnapshot;
  sessionSeed: string; contentVersion: string;
  startTime: string; endTime?: string; expiresAt: string;
  reward?: BattleReward;
}

export interface MechaStatSnapshot {
  attackPower: number; attackSpeed: number; moveSpeed: number;
  dashCooldown: number; ultimatePower: number; ultimateCooldown: number;
  maxHp: number;
}

export interface UpgradeChoice {
  level: number; options: { slot: number; upgradeId: string }[];
}

export interface BattleEventReport {
  killsDelta: number; coreEnergyDelta: number; bossId?: string;
  elapsedSeconds: number;
}

export interface BattleEndReport {
  totalKills: number; totalCoreEnergy: number;
  bossDefeated: string[]; elapsedSeconds: number;
}

export interface BattleReward {
  scrap: number; blueprint?: string; part?: string;
}

// ═══════════════════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════════════════

function logRejection(sessionId: string, playerId: string, code: string, detail: Record<string, unknown>) {
  auditLog.warn({ sessionId, playerId, code, ...detail, event: 'battle_rejected' }, `Battle rejected: ${code}`);
  getBattleRepo().then((r) => r.createSecurityEvent({
    id: crypto.randomUUID(), eventType: 'battle_rejected', userId: playerId, playerId,
    sessionId, code, severity: 'warn', source: 'battle',
    detail: JSON.stringify(detail), occurredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }).catch(() => {}));
}

function mulberry32(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function seededWeightedChoice(seed: number, items: { weight: number }[]): number {
  const rng = mulberry32(seed);
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  let roll = rng() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    roll -= items[i].weight;
    if (roll <= 0) return i;
  }
  return items.length - 1;
}

// ═══════════════════════════════════════════════════════
// startBattleSession
// ═══════════════════════════════════════════════════════

export async function startBattleSession(playerIdOrUserId: string, stageCode: string, _userId?: string): Promise<BattleSessionState> {
  const playerId = playerIdOrUserId;
  const userId = _userId || playerIdOrUserId;
  const repo = await getBattleRepo();

  // 스테이지 조회
  const stages = await repo.getStages();
  const stageDef = stages.find((s: any) => s.id === stageCode || s.name === stageCode);
  if (!stageDef) throw new AppError('존재하지 않는 스테이지입니다.', 404, 'STAGE_NOT_FOUND');
  if (!stageDef.enabled) throw new AppError('비활성화된 스테이지입니다.', 400, 'STAGE_DISABLED');

  // 해금 확인
  const progress = await repo.getPlayerStageProgress(playerId, stageDef.id);
  if (!progress && stageDef.sequence > 1) {
    throw new AppError('스테이지가 해금되지 않았습니다.', 400, 'STAGE_LOCKED');
  }

  // 메카 스탯 조회 (없으면 기본 생성)
  let mechStats = await repo.getMechStats(playerId);
  if (!mechStats) {
    mechStats = { attackPower: 10, attackSpeed: 100, moveSpeed: 100, dashCooldown: 5000, ultimatePower: 30, ultimateCooldown: 30000, maxHp: 100 };
    await repo.createMechStats(playerId, mechStats);
  }

  // 제재 확인
  const sanctions = await repo.getActiveSanctions(playerId);
  if (sanctions.length > 0) throw new AppError('제재된 계정입니다.', 403, 'ACCOUNT_SUSPENDED');

  // 기존 활성 세션 정리
  const activeSessions = await repo.getActiveSessions(playerId);
  for (const s of activeSessions) {
    await repo.abandonSession(s.id);
  }

  // 세션 생성
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + stageDef.durationSeconds * 1000 + P.SESSION_EXPIRY_GRACE_SECONDS * 1000);
  const sessionSeed = Math.floor(Math.random() * 2147483647);

  const statSnapshot: MechaStatSnapshot = {
    attackPower: mechStats.attackPower || 10,
    attackSpeed: mechStats.attackSpeed || 100,
    moveSpeed: mechStats.moveSpeed || 100,
    dashCooldown: mechStats.dashCooldown || 5000,
    ultimatePower: mechStats.ultimatePower || 30,
    ultimateCooldown: mechStats.ultimateCooldown || 30000,
    maxHp: mechStats.maxHp || 100,
  };

  await repo.createSession({
    id: sessionId, playerId, userId, stageId: stageDef.id,
    status: 'active', coreEnergy: 0, currentCoreEnergy: 0,
    battleLevel: 1, currentLevel: 1, killsReported: 0, totalKills: 0,
    scrapAccumulated: 0, scrapEarnedInSession: 0,
    upgradesApplied: '[]', offeredChoices: '[]',
    bossDefeated: '[]', highestBossSequence: 0,
    statSnapshot: JSON.stringify(statSnapshot),
    loadoutSnapshot: '{}', researchSnapshot: '{}', baseStatsSnapshot: '{}',
    sessionSeed: String(sessionSeed), randomSeed: String(sessionSeed),
    contentVersion: stageDef.contentVersion || '1.0.0',
    startTime: now, startedAt: now, lastEventAt: now,
    expiresAt, currentElapsedMs: 0,
    resultCode: null, rewardScrap: 0,
    createdAt: now, updatedAt: now,
  });

  logger.info({ sessionId, playerId, stageId: stageDef.id, event: 'battle_start' }, 'Battle started');

  return {
    id: sessionId, playerId, userId, stageId: stageDef.id,
    status: 'active', coreEnergy: 0, battleLevel: 1,
    killsReported: 0, scrapAccumulated: 0,
    upgradesApplied: [], offeredChoices: [],
    bossDefeated: [], highestBossSequence: 0,
    statSnapshot, sessionSeed: String(sessionSeed),
    contentVersion: stageDef.contentVersion || '1.0.0',
    startTime: now.toISOString(), expiresAt: expiresAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════
// reportBattleEvent
// ═══════════════════════════════════════════════════════

export async function reportBattleEvent(sessionId: string, userId: string, event: BattleEventReport & { sequence?: number }): Promise<{ accepted: boolean; battleLevel: number; upgradesAvailable: boolean }> {
  // sequence가 없으면 자동 증가 (하위 호환)
  if (!event.sequence) {
    const repo = await getBattleRepo();
    const existing = await repo.getSession(sessionId);
    event.sequence = (existing?.killsReported || 0) + 1;
  }
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session) throw new AppError('전투 세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  if (session.userId !== userId) throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
  if (session.status !== 'active') throw new AppError('세션이 활성 상태가 아닙니다.', 400, 'SESSION_NOT_ACTIVE');
  if (new Date(session.expiresAt) < new Date()) throw new AppError('세션이 만료되었습니다.', 400, 'SESSION_EXPIRED');

  const stageDef = await repo.getStage(session.stageId);
  if (!stageDef) throw new AppError('스테이지를 찾을 수 없습니다.', 404, 'STAGE_NOT_FOUND');

  // 검증
  const elapsedMs = event.elapsedSeconds * 1000;
  const maxKills = Math.floor(elapsedMs / statSnapshotTo(stageDef, session).attackSpeed * 2) + 50;
  if (event.killsDelta < 0 || event.killsDelta > maxKills) {
    logRejection(sessionId, session.playerId, 'KILLS_OUT_OF_RANGE', { reported: event.killsDelta, max: maxKills });
    throw new AppError('처치 수가 허용 범위를 벗어났습니다.', 400, 'KILLS_OUT_OF_RANGE');
  }

  const maxCoreEnergy = event.killsDelta * (stageDef.corePerKill || 5);
  if (event.coreEnergyDelta < 0 || event.coreEnergyDelta > maxCoreEnergy) {
    logRejection(sessionId, session.playerId, 'CORE_ENERGY_OUT_OF_RANGE', { reported: event.coreEnergyDelta, max: maxCoreEnergy });
    throw new AppError('Core Energy가 허용 범위를 벗어났습니다.', 400, 'CORE_ENERGY_OUT_OF_RANGE');
  }

  // 보스 타이밍 검증
  if (event.bossId) {
    const timings: number[] = JSON.parse(stageDef.bossTimings || '[180,360]');
    const tolerance = 15;
    const matched = timings.some((t) => Math.abs(event.elapsedSeconds - t) <= tolerance);
    if (!matched) {
      logRejection(sessionId, session.playerId, 'BOSS_TIMING_MISMATCH', { elapsed: event.elapsedSeconds, timings });
      throw new AppError('보스 처치 타이밍이 일치하지 않습니다.', 400, 'BOSS_TIMING_MISMATCH');
    }
  }

  // 상태 업데이트
  const newKills = (session.killsReported || 0) + event.killsDelta;
  const newCore = (session.coreEnergy || 0) + event.coreEnergyDelta;
  const newScrap = (session.scrapAccumulated || 0) + event.killsDelta * (stageDef.scrapPerKill || 1);
  const newBosses = event.bossId
    ? JSON.stringify([...new Set([...(JSON.parse(session.bossDefeated || '[]')), event.bossId])])
    : session.bossDefeated;

  // 레벨업 확인
  let newLevel = session.battleLevel || 1;
  const corePerLevel = stageDef.corePerLevel || 50;
  const nextLevelCore = newLevel * corePerLevel;
  const upgradesAvailable = newCore >= nextLevelCore && newLevel < (stageDef.maxCoreEnergy || 300) / corePerLevel;

  await repo.updateSession(sessionId, {
    killsReported: newKills, totalKills: newKills,
    coreEnergy: newCore, currentCoreEnergy: newCore,
    scrapAccumulated: newScrap, scrapEarnedInSession: newScrap,
    bossDefeated: newBosses, lastEventAt: new Date(),
    currentElapsedMs: elapsedMs,
  });

  await repo.saveBattleEvent({
    id: crypto.randomUUID(), battleSessionId: sessionId,
    sequence: event.sequence, eventType: event.bossId ? 'boss_kill' : 'progress',
    elapsedMs, payload: JSON.stringify(event),
    createdAt: new Date().toISOString(),
  });

  return { accepted: true, battleLevel: newLevel, upgradesAvailable };
}

// ═══════════════════════════════════════════════════════
// selectUpgrade
// ═══════════════════════════════════════════════════════

const UPGRADE_DEFS = [
  { id: 'machine_gun_1', weight: 10, tier: 1 }, { id: 'machine_gun_2', weight: 6, tier: 2 }, { id: 'machine_gun_3', weight: 3, tier: 3 },
  { id: 'shotgun_1', weight: 8, tier: 1 }, { id: 'shotgun_2', weight: 5, tier: 2 },
  { id: 'sniper_1', weight: 6, tier: 1 }, { id: 'sniper_2', weight: 3, tier: 2 },
  { id: 'laser_1', weight: 8, tier: 1 }, { id: 'laser_2', weight: 5, tier: 2 },
  { id: 'missile_1', weight: 5, tier: 1 },
  { id: 'plasma_1', weight: 6, tier: 1 },
  { id: 'armor_1', weight: 10, tier: 1 }, { id: 'armor_2', weight: 6, tier: 2 }, { id: 'armor_3', weight: 3, tier: 3 },
  { id: 'drone_1', weight: 8, tier: 1 }, { id: 'drone_2', weight: 5, tier: 2 },
  { id: 'speed_1', weight: 8, tier: 1 }, { id: 'speed_2', weight: 5, tier: 2 },
  { id: 'reload_1', weight: 8, tier: 1 }, { id: 'reload_2', weight: 5, tier: 2 },
  { id: 'shield_1', weight: 8, tier: 1 }, { id: 'shield_2', weight: 5, tier: 2 },
  { id: 'regen_1', weight: 6, tier: 1 },
  { id: 'crit_1', weight: 8, tier: 1 }, { id: 'crit_2', weight: 5, tier: 2 },
  { id: 'ulti_1', weight: 7, tier: 1 }, { id: 'ulti_2', weight: 4, tier: 2 },
  { id: 'dash_1', weight: 8, tier: 1 },
  { id: 'bomb_1', weight: 5, tier: 1 },
  { id: 'chain_1', weight: 6, tier: 1 },
  { id: 'heal_1', weight: 7, tier: 1 },
];

export async function selectUpgrade(sessionId: string, userId: string, selectedUpgradeCode: string): Promise<{ applied: string[]; offeredChoices: UpgradeChoice[] }> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session) throw new AppError('세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  if (session.userId !== userId) throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
  if (session.status !== 'active') throw new AppError('세션이 활성 상태가 아닙니다.', 400, 'SESSION_NOT_ACTIVE');

  const applied: string[] = JSON.parse(session.upgradesApplied || '[]');
  const offers: UpgradeChoice[] = JSON.parse(session.offeredChoices || '[]');
  const pendingOffer = offers.find((o) => o.options.some((opt) => !applied.includes(opt.upgradeId)));

  if (!pendingOffer) {
    // 새 선택지 생성
    const newLevel = (session.battleLevel || 1) + 1;
    const seed = parseInt(session.sessionSeed || '0') + newLevel * 1000 + session.killsReported;
    const available = UPGRADE_DEFS.filter((u) => {
      if (applied.includes(u.id)) return false;
      const parentTier = u.tier > 1 ? UPGRADE_DEFS.find((x) => x.id.startsWith(u.id.slice(0, -2)) && x.tier === u.tier - 1) : null;
      if (parentTier && !applied.includes(parentTier.id)) return false;
      return true;
    });
    const chosen: { slot: number; upgradeId: string }[] = [];
    for (let slot = 0; slot < 3; slot++) {
      if (available.length === 0) break;
      const idx = seededWeightedChoice(seed + slot, available);
      chosen.push({ slot, upgradeId: available[idx].id });
      available.splice(idx, 1);
    }
    const offer: UpgradeChoice = { level: newLevel, options: chosen };
    offers.push(offer);
    await repo.updateSession(sessionId, {
      battleLevel: newLevel, currentLevel: newLevel,
      offeredChoices: JSON.stringify(offers),
    });
    for (const opt of chosen) {
      await repo.saveUpgradeOffer({
        id: crypto.randomUUID(), battleSessionId: sessionId,
        level: newLevel, sequence: newLevel, optionSlot: opt.slot,
        upgradeId: opt.upgradeId, selected: 0, createdAt: new Date().toISOString(),
      });
    }
    throw new AppError('선택지가 생성되었습니다. 다시 요청해주세요.', 400, 'CHOICES_GENERATED');
  }

  // 선택 검증
  const validOption = pendingOffer.options.find((o) => o.upgradeId === selectedUpgradeCode);
  if (!validOption) throw new AppError('유효하지 않은 선택입니다.', 400, 'INVALID_CHOICE');

  applied.push(selectedUpgradeCode);
  await repo.updateSession(sessionId, {
    upgradesApplied: JSON.stringify(applied),
  });
  await repo.updateSession(sessionId, {
    upgradesApplied: JSON.stringify(applied),
    currentCoreEnergy: (session.currentCoreEnergy || 0) - (pendingOffer.level * 50),
  });

  return { applied, offeredChoices: offers };
}

// ═══════════════════════════════════════════════════════
// endBattleSession
// ═══════════════════════════════════════════════════════

export async function endBattleSession(sessionId: string, userId: string, report: BattleEndReport): Promise<BattleReward & { reward: BattleReward }> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session) throw new AppError('세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  if (session.userId !== userId) throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');

  // CAS: active → completing
  if (session.status !== 'active') throw new AppError('세션이 활성 상태가 아닙니다.', 409, 'SESSION_NOT_ACTIVE');
  await repo.updateSession(sessionId, { status: 'completing' });

  try {
    const stageDef = await repo.getStage(session.stageId);
    if (!stageDef) throw new AppError('스테이지 정보를 찾을 수 없습니다.', 404, 'STAGE_NOT_FOUND');

    // 검증
    if (report.totalKills > (session.killsReported || 0) + 50) {
      logRejection(sessionId, session.playerId, 'FINAL_KILLS_MISMATCH', { reported: report.totalKills, expected: session.killsReported });
      throw new AppError('최종 처치 수가 일치하지 않습니다.', 400, 'FINAL_KILLS_MISMATCH');
    }

    // 보상 계산
    const scrapPerKill = stageDef.scrapPerKill || 1;
    const scrapReward = report.totalKills * scrapPerKill;
    const isFirstClear = false; // TODO: 첫 클리어 확인

    const rewards: BattleReward = { scrap: scrapReward };

    // 보상 지급 (트랜잭션)
    await repo.updateSession(sessionId, {
      status: 'completed', endTime: new Date(),
      completedAt: new Date(), resultCode: 'clear',
      rewardScrap: scrapReward,
    });

    await repo.createBattleResult({
      id: crypto.randomUUID(), battleSessionId: sessionId,
      userId, result: 'clear', isFirstClear: isFirstClear ? 1 : 0,
      verifiedElapsedMs: report.elapsedSeconds * 1000,
      verifiedKills: report.totalKills,
      verifiedBossSequence: JSON.parse(session.bossDefeated || '[]').length,
      scrapReward, rewardSummary: JSON.stringify(rewards),
      finalizedAt: new Date(), createdAt: new Date(),
    });

    // 지갑 + 원장
    if (scrapReward > 0) {
      const wallet = await repo.getWalletBalance(session.playerId);
      if (wallet) {
        await repo.updateWalletScrap(session.playerId, (wallet.scrap || 0) + scrapReward);
        await repo.insertCurrencyLedger({
          id: crypto.randomUUID(), playerId: session.playerId, userId,
          currency: 'scrap', amount: scrapReward,
          balanceAfter: (wallet.scrap || 0) + scrapReward,
          source: 'battle', reason: '전투 보상',
          referenceType: 'battle_session', referenceId: sessionId,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 기록 갱신
    await repo.upsertPlayerRecord({
      id: crypto.randomUUID(), playerId: session.playerId,
      stageId: stageDef.id, bestClearTimeSec: report.elapsedSeconds,
      bestKillCount: report.totalKills, totalClears: 1,
      lastClearedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });

    logger.info({ sessionId, playerId: session.playerId, scrapReward, event: 'battle_end' }, 'Battle ended');
    return { ...rewards, reward: rewards };
  } catch (err) {
    // 실패 시 롤백
    await repo.updateSession(sessionId, { status: 'active', endTime: null, completedAt: null });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// abandonBattleSession
// ═══════════════════════════════════════════════════════

export async function abandonBattleSession(sessionId: string, playerId: string): Promise<void> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session || session.playerId !== playerId) throw new AppError('세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  await repo.updateSession(sessionId, { status: 'abandoned', endTime: new Date(), completedAt: new Date(), resultCode: 'abandon' });
  logger.info({ sessionId, playerId, event: 'battle_abandon' }, 'Battle abandoned');
}

// ═══════════════════════════════════════════════════════
// getBattleSession
// ═══════════════════════════════════════════════════════

export async function getBattleSession(sessionId: string, playerId: string): Promise<BattleSessionState> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session || session.playerId !== playerId) throw new AppError('세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');

  const applied: string[] = JSON.parse(session.upgradesApplied || '[]');
  const offers: UpgradeChoice[] = JSON.parse(session.offeredChoices || '[]');
  const bosses: string[] = JSON.parse(session.bossDefeated || '[]');
  const statSnap: MechaStatSnapshot = JSON.parse(session.statSnapshot || '{}');

  return {
    id: session.id, playerId: session.playerId, userId: session.userId,
    stageId: session.stageId, status: session.status,
    coreEnergy: session.coreEnergy || 0, battleLevel: session.battleLevel || 1,
    killsReported: session.killsReported || 0, scrapAccumulated: session.scrapAccumulated || 0,
    upgradesApplied: applied, offeredChoices: offers,
    bossDefeated: bosses, highestBossSequence: session.highestBossSequence || 0,
    statSnapshot: statSnap, sessionSeed: session.sessionSeed || '',
    contentVersion: session.contentVersion || '1.0.0',
    startTime: session.startTime?.toISOString?.() || session.startTime,
    expiresAt: session.expiresAt?.toISOString?.() || session.expiresAt,
  };
}

// ═══════════════════════════════════════════════════════
// 헬퍼
// ═══════════════════════════════════════════════════════

function statSnapshotTo(stageDef: any, session: any): MechaStatSnapshot {
  const snap = JSON.parse(session.statSnapshot || '{}');
  return {
    attackPower: stageDef.recommendedPower || snap.attackPower || 10,
    attackSpeed: snap.attackSpeed || 100,
    moveSpeed: snap.moveSpeed || 100,
    dashCooldown: snap.dashCooldown || 5000,
    ultimatePower: snap.ultimatePower || 30,
    ultimateCooldown: snap.ultimateCooldown || 30000,
    maxHp: snap.maxHp || 100,
  };
}
