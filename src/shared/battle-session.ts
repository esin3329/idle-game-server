/**
 * 전투 세션 권위 모델 (MVP) — provider 기반
 *
 * 서버가 전투 세션을 생성·관리하며, 클라이언트가 보고하는
 * 이벤트(kill, core_energy, boss defeat)를 통계적 상한선으로 검증한다.
 */
import { getBattleRepo, getPartsRepo, getResearchRepo } from '../provider.js';
import { playerIdForUser } from './player-identity.js';
import { BATTLE_POLICY } from './battle-policy.js';
import { ALL_UPGRADES, getUpgrade } from '../data/upgrades.js';
import type { UpgradeStatEffect } from '../data/upgrades.js';
import type { BattleRepository } from '../repository.js';
import type { EquipSlot, PlayerPart, PlayerResearch } from '../types.js';
import { randomBlueprintByDropWeight } from '../data/crafting.js';
import { getNextStageId, getBoss, requiredStageIdFor, parseStageJsonArray } from '../data/stages.js';
import { AppError } from './errors.js';
import {
  computeBattleLoadoutStats, applyBattleUpgrades, enrichUpgradeChoice, calcBattleScrapReward,
  DEFAULT_MECH_STATS,
} from './mecha-stats.js';
import type {
  MechaStatSnapshot, EffectiveBattleStats, EnrichedUpgradeChoice, BattleLoadoutStats,
  LoadoutSnapshot, ResearchSnapshot,
} from './mecha-stats.js';
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
  loadoutSnapshot: LoadoutSnapshot; researchSnapshot: ResearchSnapshot;
  sessionSeed: string; contentVersion: string;
  startTime: string; endTime?: string; expiresAt: string;
  reward?: BattleReward;
}

export interface UpgradeChoice {
  level: number; options: { slot: number; upgradeId: string }[];
}

export interface BattleEventReport {
  sequence: number; killsDelta: number; coreEnergyDelta: number; bossId?: string;
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
    detail: JSON.stringify(detail), occurredAt: new Date(),
    createdAt: new Date(),
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

async function getProgressForUser(repo: { getPlayerStageProgress(playerId: string, stageId: string): Promise<any> }, playerId: string, userId: string, stageId: string) {
  const byPlayer = await repo.getPlayerStageProgress(playerId, stageId);
  if (byPlayer || playerId === userId) return byPlayer;
  return repo.getPlayerStageProgress(userId, stageId);
}

async function getRecordForUser(repo: { getPlayerRecord(playerId: string, stageId: string): Promise<any> }, playerId: string, userId: string, stageId: string) {
  const byPlayer = await repo.getPlayerRecord(playerId, stageId);
  if (byPlayer || playerId === userId) return byPlayer;
  return repo.getPlayerRecord(userId, stageId);
}

// ═══════════════════════════════════════════════════════
// startBattleSession
// ═══════════════════════════════════════════════════════

export async function startBattleSession(userId: string, stageCode: string): Promise<BattleSessionState> {
  const playerId = await playerIdForUser(userId);
  const repo = await getBattleRepo();

  // 스테이지 조회
  const stages = await repo.getStages();
  const stageDef = stages.find((s: any) => s.id === stageCode || s.name === stageCode);
  if (!stageDef) throw new AppError('존재하지 않는 스테이지입니다.', 404, 'STAGE_NOT_FOUND');
  if (stageDef.enabled === false || stageDef.enabled === 0) throw new AppError('비활성화된 스테이지입니다.', 400, 'STAGE_DISABLED');

  // ─── 출격 조건 검증 ───────────────────────────
  // 1. entryRequirement: 이전 스테이지 클리어 또는 해금 기록 확인
  const requiredStageId = requiredStageIdFor(stageDef.entryRequirement);
  if (requiredStageId) {
    const [currentProgress, prevProgress, prevRecord] = await Promise.all([
      getProgressForUser(repo, playerId, userId, stageDef.id),
      getProgressForUser(repo, playerId, userId, requiredStageId),
      getRecordForUser(repo, playerId, userId, requiredStageId),
    ]);
    const isUnlocked = Boolean(currentProgress?.unlockedAt)
      || Boolean(prevProgress?.firstClearedAt)
      || (prevRecord?.totalClears || 0) > 0;
    if (!isUnlocked) {
      throw new AppError(
        `이전 스테이지(${requiredStageId})를 클리어해야 합니다.`,
        400, 'STAGE_LOCKED',
      );
    }
  }

  // 2. 권장 전투력 확인 (옵션)
  if (stageDef.recommendedPower) {
    const mechCheck = await repo.getMechStats(playerId);
    if (mechCheck) {
      const playerPower = (mechCheck.attackPower || 10) * 10;
      if (playerPower < stageDef.recommendedPower * 0.7) {
        // 권장 전투력의 70% 미만이면 경고 (진입은 허용)
        logger.warn({ playerId, stageId: stageDef.id, playerPower, recommended: stageDef.recommendedPower, event: 'battle_low_power' }, 'Player power below 70% of recommended');
      }
    }
  }

  // 메카 스탯 조회 (없으면 기본 생성)
  let mechStats = await repo.getMechStats(playerId);
  if (!mechStats) {
    mechStats = { ...DEFAULT_MECH_STATS };
    await repo.createMechStats(playerId, mechStats);
  }

  // 제재 확인
  const sanctions = await repo.getActiveSanctions(userId);
  if (sanctions.some((sanction: { type: string }) => sanction.type === 'suspension' || sanction.type === 'battle_restriction')) {
    throw new AppError('전투 이용이 제한된 계정입니다.', 403, 'BATTLE_RESTRICTED');
  }

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

  const { statSnapshot, loadoutSnapshot, researchSnapshot, baseStats } = await getPlayerBattleStats(playerId, mechStats);

  await repo.createSession({
    id: sessionId, playerId, userId, stageId: stageDef.id,
    status: 'active', coreEnergy: 0, currentCoreEnergy: 0,
    battleLevel: 1, currentLevel: 1, killsReported: 0, totalKills: 0,
    scrapAccumulated: 0, scrapEarnedInSession: 0,
    upgradesApplied: '[]', offeredChoices: '[]',
    bossDefeated: '[]', highestBossSequence: 0,
    statSnapshot: JSON.stringify(statSnapshot),
    loadoutSnapshot: JSON.stringify(loadoutSnapshot),
    researchSnapshot: JSON.stringify(researchSnapshot),
    baseStatsSnapshot: JSON.stringify(baseStats),
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
    statSnapshot, loadoutSnapshot, researchSnapshot, sessionSeed: String(sessionSeed),
    contentVersion: stageDef.contentVersion || '1.0.0',
    startTime: now.toISOString(), expiresAt: expiresAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════
// reportBattleEvent
// ═══════════════════════════════════════════════════════

export async function reportBattleEvent(sessionId: string, userId: string, event: BattleEventReport): Promise<{ accepted: boolean; battleLevel: number; upgradesAvailable: boolean; pendingOffer: EnrichedUpgradeChoice | null }> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session) throw new AppError('전투 세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  if (session.userId !== userId) throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
  if (session.status !== 'active') throw new AppError('세션이 활성 상태가 아닙니다.', 400, 'SESSION_NOT_ACTIVE');
  if (new Date(session.expiresAt) < new Date()) throw new AppError('세션이 만료되었습니다.', 400, 'SESSION_EXPIRED');

  const stageDef = await repo.getStage(session.stageId);
  if (!stageDef) throw new AppError('스테이지를 찾을 수 없습니다.', 404, 'STAGE_NOT_FOUND');

  const expectedSequence = await repo.getLastBattleEventSequence(sessionId) + 1;
  if (event.sequence !== expectedSequence) {
    throw new AppError('전투 이벤트 순서가 일치하지 않습니다.', 409, 'INVALID_EVENT_SEQUENCE');
  }
  const startedAt = new Date(session.startTime).getTime();
  const serverElapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const elapsedMs = event.elapsedSeconds * 1000;
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
      !Number.isSafeInteger(event.elapsedSeconds) || event.elapsedSeconds < Math.floor((session.currentElapsedMs || 0) / 1000) ||
      event.elapsedSeconds > serverElapsedSeconds + P.SERVER_TIME_SKEW_SECONDS || event.elapsedSeconds > stageDef.durationSeconds + P.SESSION_EXPIRY_GRACE_SECONDS) {
    logRejection(sessionId, session.playerId, 'TIME_OUT_OF_RANGE', { elapsed: event.elapsedSeconds, serverElapsedSeconds });
    throw new AppError('서버가 확인한 경과 시간이 부족합니다.', 400, 'TIME_OUT_OF_RANGE');
  }
  const sanctions = await repo.getActiveSanctions(userId);
  if (sanctions.some((sanction: { type: string }) => sanction.type === 'battle_restriction')) {
    throw new AppError('전투 이용이 제한된 계정입니다.', 403, 'BATTLE_RESTRICTED');
  }

  const newKills = (session.killsReported || 0) + event.killsDelta;
  const sessionApplied: string[] = JSON.parse(session.upgradesApplied || '[]');
  const effectiveAttackSpeed = applyBattleUpgrades(parseStatSnapshot(session), sessionApplied).attackSpeed;
  const maxKills = Math.floor(elapsedMs / effectiveAttackSpeed * 2);
  if (!Number.isSafeInteger(event.killsDelta) || event.killsDelta < 0 || newKills > maxKills || newKills > stageDef.maxKills) {
    logRejection(sessionId, session.playerId, 'KILLS_OUT_OF_RANGE', { reported: event.killsDelta, total: newKills, max: maxKills });
    throw new AppError('처치 수가 허용 범위를 벗어났습니다.', 400, 'KILLS_OUT_OF_RANGE');
  }

  const newCore = (session.coreEnergy || 0) + event.coreEnergyDelta;
  const maxCoreEnergy = event.killsDelta * (stageDef.corePerKill || 5);
  if (!Number.isSafeInteger(event.coreEnergyDelta) || event.coreEnergyDelta < 0 ||
      event.coreEnergyDelta > maxCoreEnergy || newCore > stageDef.maxCoreEnergy) {
    logRejection(sessionId, session.playerId, 'CORE_ENERGY_OUT_OF_RANGE', { reported: event.coreEnergyDelta, max: maxCoreEnergy });
    throw new AppError('Core Energy가 허용 범위를 벗어났습니다.', 400, 'CORE_ENERGY_OUT_OF_RANGE');
  }

  const sessionBosses: string[] = JSON.parse(session.bossDefeated || '[]');
  if (event.bossId !== undefined) {
    const timings = parseStageJsonArray<number>(stageDef.bossTimings);
    const nextTiming = timings[sessionBosses.length];
    if (typeof event.bossId !== 'string' || event.bossId.length < 1 || event.bossId.length > 50 ||
        !getBoss(event.bossId) || sessionBosses.includes(event.bossId) ||
        !nextTiming || Math.abs(event.elapsedSeconds - nextTiming) > P.BOSS_TIMING_TOLERANCE_SECONDS) {
      logRejection(sessionId, session.playerId, 'BOSS_TIMING_MISMATCH', { elapsed: event.elapsedSeconds, expected: nextTiming });
      throw new AppError('보스 처치 순서 또는 시간이 일치하지 않습니다.', 400, 'BOSS_TIMING_MISMATCH');
    }
  }

  const newScrap = (session.scrapAccumulated || 0) + event.killsDelta * (stageDef.scrapPerKill || 1);
  const newBosses = event.bossId ? JSON.stringify([...sessionBosses, event.bossId]) : session.bossDefeated;
  const newLevel = session.battleLevel || 1;
  const pendingOffer = findPendingOffer(JSON.parse(session.offeredChoices || '[]'), sessionApplied);
  const upgradesAvailable = pendingOffer !== undefined || canOfferUpgrade(newCore, newLevel, stageDef);

  await repo.updateSession(sessionId, {
    killsReported: newKills, totalKills: newKills,
    coreEnergy: newCore, currentCoreEnergy: newCore,
    scrapAccumulated: newScrap, scrapEarnedInSession: newScrap,
    bossDefeated: newBosses, highestBossSequence: JSON.parse(newBosses || '[]').length,
    lastEventAt: new Date(), currentElapsedMs: elapsedMs,
  });
  await repo.saveBattleEvent({
    id: crypto.randomUUID(), battleSessionId: sessionId,
    sequence: event.sequence, eventType: event.bossId ? 'boss_kill' : 'progress',
    elapsedMs, payload: JSON.stringify(event), createdAt: new Date(),
  });
  return { accepted: true, battleLevel: newLevel, upgradesAvailable, pendingOffer: pendingOffer ? enrichUpgradeChoice(pendingOffer) : null };
}

// ═══════════════════════════════════════════════════════
// offerBattleUpgrades
// ═══════════════════════════════════════════════════════

export async function offerBattleUpgrades(sessionId: string, userId: string): Promise<{ offer: EnrichedUpgradeChoice; battleLevel: number; applied: string[] }> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session) throw new AppError('전투 세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  if (session.userId !== userId) throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
  if (session.status !== 'active') throw new AppError('세션이 활성 상태가 아닙니다.', 400, 'SESSION_NOT_ACTIVE');
  if (new Date(session.expiresAt) < new Date()) throw new AppError('세션이 만료되었습니다.', 400, 'SESSION_EXPIRED');

  const stageDef = await repo.getStage(session.stageId);
  if (!stageDef) throw new AppError('스테이지를 찾을 수 없습니다.', 404, 'STAGE_NOT_FOUND');

  const applied: string[] = JSON.parse(session.upgradesApplied || '[]');
  const offers: UpgradeChoice[] = JSON.parse(session.offeredChoices || '[]');
  const existing = findPendingOffer(offers, applied);
  if (existing) {
    return { offer: enrichUpgradeChoice(existing), battleLevel: session.battleLevel || 1, applied };
  }

  if (!canOfferUpgrade(session.coreEnergy || 0, session.battleLevel || 1, stageDef)) {
    throw new AppError('강화를 선택할 수 있는 상태가 아닙니다.', 400, 'UPGRADE_NOT_AVAILABLE');
  }

  const { offer } = await createUpgradeOffer(repo, session, applied, offers);
  return { offer: enrichUpgradeChoice(offer), battleLevel: offer.level, applied };
}

// ═══════════════════════════════════════════════════════
// selectUpgrade
// ═══════════════════════════════════════════════════════

export interface SelectedUpgradeInfo {
  id: string; name: string; description: string; category: string; tier: number;
  effects: UpgradeStatEffect;
}

export interface SelectUpgradeResult {
  applied: string[]; offeredChoices: UpgradeChoice[];
  effectiveStats: EffectiveBattleStats; selectedUpgrade: SelectedUpgradeInfo;
}

export async function selectUpgrade(sessionId: string, userId: string, selectedUpgradeCode: string): Promise<SelectUpgradeResult> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session) throw new AppError('세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  if (session.userId !== userId) throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
  if (session.status !== 'active') throw new AppError('세션이 활성 상태가 아닙니다.', 400, 'SESSION_NOT_ACTIVE');

  const applied: string[] = JSON.parse(session.upgradesApplied || '[]');
  const offers: UpgradeChoice[] = JSON.parse(session.offeredChoices || '[]');
  const pendingOffer = findPendingOffer(offers, applied);

  if (!pendingOffer) {
    await createUpgradeOffer(repo, session, applied, offers);
    throw new AppError('선택지가 생성되었습니다. 다시 요청해주세요.', 400, 'CHOICES_GENERATED');
  }

  const upgrade = getUpgrade(selectedUpgradeCode);
  if (!upgrade || !pendingOffer.options.some((option) => option.upgradeId === selectedUpgradeCode)) {
    throw new AppError('유효하지 않은 선택입니다.', 400, 'INVALID_CHOICE');
  }

  const stageDef = await repo.getStage(session.stageId);
  const nextApplied = [...applied, selectedUpgradeCode];
  const selected = await repo.selectUpgradeOffer(sessionId, pendingOffer.level, selectedUpgradeCode, {
    upgradesApplied: JSON.stringify(nextApplied),
    currentCoreEnergy: Math.max(0, (session.currentCoreEnergy || 0) - (stageDef?.corePerLevel || P.DEFAULT_CORE_PER_LEVEL)),
  });
  if (!selected) throw new AppError('이미 처리된 강화 선택입니다.', 409, 'UPGRADE_ALREADY_SELECTED');

  return {
    applied: nextApplied,
    offeredChoices: offers,
    effectiveStats: applyBattleUpgrades(parseStatSnapshot(session), nextApplied, parseJsonObject<LoadoutSnapshot>(session.loadoutSnapshot)),
    selectedUpgrade: {
      id: upgrade.id, name: upgrade.name, description: upgrade.description,
      category: upgrade.category, tier: upgrade.tier, effects: upgrade.effects,
    },
  };
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

    const now = Date.now();
    const serverElapsedSeconds = Math.floor((now - new Date(session.startTime).getTime()) / 1000);
    const sessionElapsedSeconds = Math.floor((session.currentElapsedMs || 0) / 1000);
    if (!Number.isSafeInteger(report.elapsedSeconds) ||
        report.elapsedSeconds < P.MIN_FINISH_DURATION_SECONDS ||
        report.elapsedSeconds < sessionElapsedSeconds ||
        report.elapsedSeconds > serverElapsedSeconds + P.SERVER_TIME_SKEW_SECONDS ||
        report.elapsedSeconds > stageDef.durationSeconds + P.FINISH_TIME_TOLERANCE_SECONDS) {
      logRejection(sessionId, session.playerId, 'TIME_OUT_OF_RANGE', { elapsed: report.elapsedSeconds, serverElapsedSeconds });
      throw new AppError('경과 시간이 허용 범위를 벗어났습니다.', 400, 'TIME_OUT_OF_RANGE');
    }

    if (!Number.isSafeInteger(report.totalKills) || report.totalKills !== (session.killsReported || 0) ||
        report.totalKills > stageDef.maxKills) {
      logRejection(sessionId, session.playerId, 'FINAL_KILLS_MISMATCH', { reported: report.totalKills, expected: session.killsReported });
      throw new AppError('최종 처치 수가 전투 기록과 일치하지 않습니다.', 400, 'FINAL_KILLS_MISMATCH');
    }

    if (!Number.isSafeInteger(report.totalCoreEnergy) || report.totalCoreEnergy !== (session.coreEnergy || 0) ||
        report.totalCoreEnergy > stageDef.maxCoreEnergy) {
      logRejection(sessionId, session.playerId, 'CORE_ENERGY_MISMATCH', { reported: report.totalCoreEnergy, expected: session.coreEnergy });
      throw new AppError('Core Energy가 전투 기록과 일치하지 않습니다.', 400, 'CORE_ENERGY_MISMATCH');
    }

    const sessionBosses: string[] = JSON.parse(session.bossDefeated || '[]');
    const bossTimings = parseStageJsonArray<number>(stageDef.bossTimings);
    const expectedBossCount = bossTimings.length;
    const reportedBosses = report.bossDefeated;
    if (!Array.isArray(reportedBosses) ||
        reportedBosses.length !== sessionBosses.length ||
        reportedBosses.some((bossId, index) => bossId !== sessionBosses[index]) ||
        sessionBosses.length !== expectedBossCount) {
      logRejection(sessionId, session.playerId, 'BOSS_MISMATCH', { reported: reportedBosses, expected: sessionBosses, required: expectedBossCount });
      throw new AppError('보스 처치 순서가 전투 기록과 일치하지 않습니다.', 400, 'BOSS_MISMATCH');
    }

    const sanctions = await repo.getActiveSanctions(userId);
    if (sanctions.some((sanction: { type: string }) => sanction.type === 'reward_restriction')) {
      throw new AppError('계정의 보상 수령이 제한되어 있습니다.', 403, 'REWARD_RESTRICTED');
    }

    const appliedUpgrades: string[] = JSON.parse(session.upgradesApplied || '[]');
    const offers: UpgradeChoice[] = JSON.parse(session.offeredChoices || '[]');
    const hasPending = findPendingOffer(offers, appliedUpgrades) !== undefined;
    if (hasPending) {
      throw new AppError('선택하지 않은 강화가 있습니다.', 400, 'PENDING_UPGRADES');
    }

    const existingResult = await repo.getBattleResult(sessionId);
    if (existingResult) {
      throw new AppError('이미 종료된 전투입니다.', 409, 'ALREADY_FINISHED');
    }


    // ═══════════════════════════════════════════════
    // 보상 계산
    // ═══════════════════════════════════════════════
    const scrapPerKill = stageDef.scrapPerKill || 1;
    const scrapReward = calcBattleScrapReward(report.totalKills, scrapPerKill, parseJsonObject<ResearchSnapshot>(session.researchSnapshot));
    const bossSequence = sessionBosses.length;  // 검증부에서 선언된 sessionBosses 재사용

    // 첫 클리어 확인
    const existingRecord = await repo.getPlayerRecord(session.playerId, stageDef.id);
    const isFirstClear = !existingRecord || (existingRecord.totalClears || 0) === 0;

    // ─── 설계도 보상 (sessionSeed 기반 결정론) ──────────
    const dropSeed = ((parseInt(session.sessionSeed || '0', 10) || 0) ^ 0x9e3779b9) >>> 0;
    const dropRng = mulberry32(dropSeed);
    let blueprintCode: string | undefined;
    if (isFirstClear) {
      // 첫 클리어: 확정 설계도 (stage_04 코어/요새 = 희귀, else 랜덤)
      if (stageDef.id === 'stage_04_core' || stageDef.id === 'stage_04_fortress') {
        blueprintCode = randomBlueprintByDropWeight('rare', dropRng).code;
      } else {
        blueprintCode = randomBlueprintByDropWeight(undefined, dropRng).code;
      }
    } else if (dropRng() < 0.15) {
      // 일반 클리어: 15% 확률로 랜덤 설계도
      blueprintCode = randomBlueprintByDropWeight(undefined, dropRng).code;
    }

    // 설계도 지급
    if (blueprintCode) {
      const { getCraftingRepo } = await import('../provider.js');
      const craftRepo = await getCraftingRepo();
      const already = await craftRepo.hasBlueprint(session.playerId, blueprintCode);
      if (!already) {
        await craftRepo.grantBlueprint(session.playerId, blueprintCode);
        logger.info({ playerId: session.playerId, blueprintCode, sessionId, event: 'battle_blueprint_drop' }, 'Blueprint dropped');
      } else {
        blueprintCode = undefined;
      }
    }

    const rewards: BattleReward = {
      scrap: scrapReward,
      blueprint: blueprintCode,
    };

    // ─── 보상 확정 (completed) ────────────────────
    await repo.updateSession(sessionId, {
      status: 'completed', endTime: new Date(),
      completedAt: new Date(), resultCode: 'clear',
      rewardScrap: scrapReward,
    });

    // 멱등성 키: 전투 세션 ID 기반 (중복 실행 방지)
    const idempotencyKey = `battle-${sessionId}`;

    await repo.createBattleResult({
      id: crypto.randomUUID(), battleSessionId: sessionId,
      userId, result: 'clear', isFirstClear: isFirstClear ? 1 : 0,
      verifiedElapsedMs: report.elapsedSeconds * 1000,
      verifiedKills: report.totalKills,
      verifiedBossSequence: bossSequence,
      scrapReward, rewardSummary: JSON.stringify(rewards),
      finalizedAt: new Date(), createdAt: new Date(),
    });

    // ─── 지갑 + 원장 ──────────────────────────────
    if (scrapReward > 0) {
      const wallet = await repo.getWalletBalance(session.playerId);
      if (!wallet) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
      const balanceAfter = (wallet.scrap || 0) + scrapReward;
      await repo.updateWalletScrap(session.playerId, balanceAfter);
      await repo.insertCurrencyLedger({
        id: crypto.randomUUID(), playerId: session.playerId, userId,
        currency: 'scrap', amount: scrapReward,
        balanceAfter,
        source: 'battle', reason: '전투 보상',
        referenceType: 'battle_session', referenceId: sessionId,
        idempotencyKey: idempotencyKey + '-scrap',
        createdAt: new Date(),
      });
    }

    // ─── 기록 및 스테이지 진행도 갱신 ───────────
    const clearedAt = new Date();
    const recordId = existingRecord?.id || crypto.randomUUID();
    await repo.upsertPlayerRecord({
      id: recordId, playerId: session.playerId,
      stageId: stageDef.id, bestClearTimeSec: report.elapsedSeconds,
      bestKillCount: report.totalKills, totalClears: (existingRecord?.totalClears || 0) + 1,
      firstClearedAt: isFirstClear ? clearedAt : existingRecord?.firstClearedAt,
      lastClearedAt: clearedAt, createdAt: existingRecord?.createdAt || clearedAt, updatedAt: clearedAt,
    });

    const existingProgress = await repo.getPlayerStageProgress(session.playerId, stageDef.id);
    const clearTimeMs = report.elapsedSeconds * 1000;
    const bestClearTimeMs = existingProgress?.bestClearTimeMs != null
      ? Math.min(existingProgress.bestClearTimeMs, clearTimeMs)
      : clearTimeMs;
    await repo.upsertPlayerStageProgress({
      id: existingProgress?.id || crypto.randomUUID(),
      playerId: session.playerId,
      userId,
      stageId: stageDef.id,
      unlockedAt: existingProgress?.unlockedAt || clearedAt,
      firstClearedAt: existingProgress?.firstClearedAt || clearedAt,
      bestClearTimeMs,
      highestBossSequence: Math.max(existingProgress?.highestBossSequence || 0, bossSequence),
      clearCount: (existingProgress?.clearCount || 0) + 1,
      createdAt: existingProgress?.createdAt || clearedAt,
      updatedAt: clearedAt,
    });

    // ─── 다음 스테이지 해금 ─────────────────────
    const allStages = await repo.getStages();
    const nextStageId =
      allStages.find((s: { sequence?: number }) => s.sequence === (stageDef.sequence ?? 0) + 1)?.id
      ?? getNextStageId(stageDef.id);
    if (nextStageId) {
      const nextProgress = await repo.getPlayerStageProgress(session.playerId, nextStageId);
      if (!nextProgress) {
        await repo.upsertPlayerStageProgress({
          id: crypto.randomUUID(),
          playerId: session.playerId,
          userId,
          stageId: nextStageId,
          unlockedAt: clearedAt,
          firstClearedAt: null,
          bestClearTimeMs: null,
          highestBossSequence: 0,
          clearCount: 0,
          createdAt: clearedAt,
          updatedAt: clearedAt,
        });
      }
    }

    logger.info({ sessionId, playerId: session.playerId, scrapReward, blueprintCode, isFirstClear, event: 'battle_end' }, 'Battle ended');
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

export async function abandonBattleSession(sessionId: string, userId: string): Promise<void> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session || session.userId !== userId) throw new AppError('세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
  await repo.updateSession(sessionId, { status: 'abandoned', endTime: new Date(), completedAt: new Date(), resultCode: 'abandon' });
  logger.info({ sessionId, userId, event: 'battle_abandon' }, 'Battle abandoned');
}

// ═══════════════════════════════════════════════════════
// getBattleSession
// ═══════════════════════════════════════════════════════

export async function getBattleSession(sessionId: string, userId: string): Promise<BattleSessionState> {
  const repo = await getBattleRepo();
  const session = await repo.getSession(sessionId);
  if (!session || session.userId !== userId) throw new AppError('세션을 찾을 수 없습니다.', 404, 'SESSION_NOT_FOUND');
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
    statSnapshot: statSnap,
    loadoutSnapshot: parseJsonObject<LoadoutSnapshot>(session.loadoutSnapshot),
    researchSnapshot: parseJsonObject<ResearchSnapshot>(session.researchSnapshot),
    sessionSeed: session.sessionSeed || '',
    contentVersion: session.contentVersion || '1.0.0',
    startTime: session.startTime?.toISOString?.() || session.startTime,
    expiresAt: session.expiresAt?.toISOString?.() || session.expiresAt,
  };
}

// ═══════════════════════════════════════════════════════
// 헬퍼
// ═══════════════════════════════════════════════════════

function parseJsonObject<T extends object>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value || '{}') as T;
  return (value ?? {}) as T;
}

function parseStatSnapshot(session: { statSnapshot?: unknown }): MechaStatSnapshot {
  const snap = parseJsonObject<Partial<MechaStatSnapshot>>(session.statSnapshot);
  return {
    attackPower: snap.attackPower || DEFAULT_MECH_STATS.attackPower,
    attackSpeed: snap.attackSpeed || DEFAULT_MECH_STATS.attackSpeed,
    moveSpeed: snap.moveSpeed || DEFAULT_MECH_STATS.moveSpeed,
    dashCooldown: snap.dashCooldown || DEFAULT_MECH_STATS.dashCooldown,
    ultimatePower: snap.ultimatePower || DEFAULT_MECH_STATS.ultimatePower,
    ultimateCooldown: snap.ultimateCooldown || DEFAULT_MECH_STATS.ultimateCooldown,
    maxHp: snap.maxHp || DEFAULT_MECH_STATS.maxHp,
  };
}

/** 선택하지 않은(적용된 옵션이 없는) 첫 번째 강화 제안 */
function findPendingOffer(offers: UpgradeChoice[], applied: string[]): UpgradeChoice | undefined {
  return offers.find((offer) => !offer.options.some((option) => applied.includes(option.upgradeId)));
}

/** 누적 core energy 가 다음 레벨 문턱을 넘었고 최대 레벨 미만인지 */
function canOfferUpgrade(coreEnergy: number, battleLevel: number, stageDef: { corePerLevel?: number; maxCoreEnergy?: number }): boolean {
  const corePerLevel = stageDef.corePerLevel || P.DEFAULT_CORE_PER_LEVEL;
  return coreEnergy >= battleLevel * corePerLevel
    && battleLevel < (stageDef.maxCoreEnergy || P.DEFAULT_MAX_CORE_ENERGY) / corePerLevel;
}

interface OfferSessionRow {
  id: string; battleLevel?: number; sessionSeed?: string; killsReported?: number;
}

/**
 * 다음 레벨 강화 선택지를 시드 기반으로 생성·저장한다 (select/offer 공용).
 * 동시 요청으로 이미 저장된 경우 저장된 제안을 그대로 돌려준다.
 */
async function createUpgradeOffer(
  repo: BattleRepository,
  session: OfferSessionRow,
  applied: string[],
  offers: UpgradeChoice[],
): Promise<{ offer: UpgradeChoice; offers: UpgradeChoice[] }> {
  const newLevel = (session.battleLevel || 1) + 1;
  const seed = parseInt(session.sessionSeed || '0') + newLevel * 1000 + (session.killsReported || 0);
  const available = ALL_UPGRADES.filter((upgrade) => {
    if (applied.includes(upgrade.id)) return false;
    const parentTier = upgrade.tier > 1
      ? ALL_UPGRADES.find((candidate) => candidate.group === upgrade.group && candidate.tier === upgrade.tier - 1)
      : null;
    return !parentTier || applied.includes(parentTier.id);
  });
  const chosen: { slot: number; upgradeId: string }[] = [];
  for (let slot = 0; slot < P.UPGRADE_CHOICES_PER_LEVEL && available.length > 0; slot += 1) {
    const idx = seededWeightedChoice(seed + slot, available);
    chosen.push({ slot, upgradeId: available[idx].id });
    available.splice(idx, 1);
  }
  if (chosen.length === 0) {
    throw new AppError('더 이상 선택할 수 있는 강화가 없습니다.', 409, 'NO_UPGRADES_AVAILABLE');
  }

  const offer: UpgradeChoice = { level: newLevel, options: chosen };
  const nextOffers = [...offers, offer];
  const saved = await repo.saveUpgradeChoices(session.id, newLevel, chosen, {
    battleLevel: newLevel,
    currentLevel: newLevel,
    offeredChoices: JSON.stringify(nextOffers),
  });
  if (saved) return { offer, offers: nextOffers };

  const latest = await repo.getSession(session.id);
  const latestOffers: UpgradeChoice[] = JSON.parse(latest?.offeredChoices || '[]');
  const pending = findPendingOffer(latestOffers, JSON.parse(latest?.upgradesApplied || '[]'));
  if (!pending) throw new AppError('강화 선택지를 저장하지 못했습니다.', 409, 'UPGRADE_OFFER_CONFLICT');
  return { offer: pending, offers: latestOffers };
}

/** 플레이어의 장착 파츠·연구를 반영한 전투 스탯. 파츠/연구 저장소 조회 실패 시 baseStats 로 대체한다. */
export async function getPlayerBattleStats(playerId: string, mechStats?: Partial<MechaStatSnapshot> | null): Promise<BattleLoadoutStats> {
  const baseStats = parseStatSnapshot({ statSnapshot: mechStats ?? {} });
  let equipped: EquipSlot | null = null;
  let inventory: PlayerPart[] = [];
  let research: PlayerResearch[] = [];
  try {
    const partsRepo = await getPartsRepo();
    [equipped, inventory] = await Promise.all([partsRepo.getEquipped(playerId), partsRepo.getInventory(playerId)]);
  } catch (err) {
    logger.warn({ playerId, err, event: 'battle_parts_unavailable' }, 'Parts lookup failed; using base stats');
  }
  try {
    research = await (await getResearchRepo()).getAll(playerId);
  } catch (err) {
    logger.warn({ playerId, err, event: 'battle_research_unavailable' }, 'Research lookup failed; using base stats');
  }
  return computeBattleLoadoutStats(baseStats, equipped, inventory, research);
}
