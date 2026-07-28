/**
 * 전투 세션 권위 모델 (MVP)
 *
 * 서버가 전투 세션을 생성·관리하며, 클라이언트가 보고하는
 * 이벤트(kill, core_energy, boss defeat)를 통계적 상한선으로 검증한다.
 * 클라이언트는 절대 수치를 결정할 수 없다.
 *
 * 아키텍처:
 *   세션 시작 → statSnapshot + sessionSeed + contentVersion 고정
 *   클라이언트 이벤트 보고 → 서버 검증 → 레벨업 시 선택지 생성·저장
 *   클라이언트 선택 → 서버가 저장된 선택지에서 검증 후 적용
 *   세션 종료 → 전체 검증 → 영구 보상 확정 (단일 트랜잭션)
 *
 * ═══════════════════════════════════════════════════════
 * 보안 경계 (MVP)
 * ═══════════════════════════════════════════════════════
 *
 * [보호됨 — 서버 권위]
 *   - 세션 생성, statSnapshot, sessionSeed, contentVersion
 *   - core_energy 누적 상한 (스테이지 정의 기반)
 *   - 처치 수 상한 (메카 스탯 × 경과시간 기반)
 *   - 보스 처치 타이밍 검증
 *   - 강화 선택지 생성·저장·검증 (클라이언트가 선택지 위조 불가)
 *   - 최종 보상량 계산 (세션 기록 + 스테이지 보상표)
 *   - 보상 지급 (단일 트랜잭션: 세션 종료 + 지갑 입금)
 *
 * [경계 밖 — 클라이언트 책임]
 *   - 실시간 전투 시뮬레이션 (이동, 충돌, 프레임별 데미지)
 *   - 개별 적 처치 순서와 정확한 타이밍
 *   - 플레이어 컨트롤 (대시, 궁극기)
 *
 * [Unity 연동 예정]
 *   - 클라이언트가 battle/event로 주기적(2~5초) 누적 수치 보고
 *   - 서버는 통계적 상한 + 이전 보고 대비 단조증가 검증
 *   - 추후 프레임별 시드 재현 검증으로 전환 가능 (sessionSeed 활용)
 */

import { getDb } from '../db/connection.js';
import { stages, stageRewards, battleSessions, playerRecords, mechaStats, walletBalances, currencyLedger, battleUpgradeOffers, battleEvents, battleResults, playerStageProgress, itemLedger, accountSanctions, securityEvents } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { AppError } from './errors.js';
import { logger, auditLog } from './logger.js';
import { BATTLE_POLICY } from './battle-policy.js';

const P = BATTLE_POLICY;

/** 검증 거부 시 감사 로그 */
function logRejection(sessionId: string, playerId: string, code: string, detail: Record<string, unknown>) {
  auditLog.warn({ sessionId, playerId, code, ...detail, event: 'battle_rejected' }, `Battle rejected: ${code}`);

  // DB에도 보안 이벤트 기록 (비동기, 실패해도 throw 안 함)
  getDb().insert(securityEvents).values({
    id: crypto.randomUUID(),
    eventType: 'battle_rejected',
    playerId,
    sessionId,
    code,
    severity: detail.severity as string || 'warn',
    source: 'battle-session',
    detail: JSON.stringify(detail),
    safeDetails: JSON.stringify({ code, sessionId }),
    occurredAt: new Date(),
    createdAt: new Date(),
  }).catch(() => { /* best effort */ });
}

// ═══════════════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════════════

export interface BattleSessionState {
  sessionId: string;
  playerId: string;
  stageId: string;
  status: 'active' | 'completed' | 'abandoned';
  coreEnergy: number;
  battleLevel: number;
  killsReported: number;
  scrapAccumulated: number;
  upgradesApplied: UpgradeRecord[];
  offeredChoices: UpgradeChoice[] | null;
  bossDefeated: string[];
  stage: {
    id: string; name: string; durationSeconds: number; recommendedPower: number;
    maxKills: number; maxCoreEnergy: number; corePerLevel: number; corePerKill: number; scrapPerKill: number;
  } | null;
  startTime: string;
  endTime: string | null;
  expiresAt: string | null;
}

export interface MechaStatSnapshot {
  attackPower: number;
  attackSpeed: number;
  moveSpeed: number;
  dashCooldown: number;
  ultimatePower: number;
  ultimateCooldown: number;
  maxHp: number;
}

export interface UpgradeChoice {
  id: string;
  code: string;
  name: string;
  description: string;
  category: 'weapon' | 'drone' | 'armor' | 'ultimate' | 'utility';
  effectType: 'attack' | 'speed' | 'ultimate' | 'heal' | 'scrap';
  effectValue: number;
  rarity: 'common' | 'rare' | 'epic';
  group: string;
  tier: number;
  maxTier: number;
  evolvesTo: string | null;
  prerequisites: string[];
  compatibleWeapon: string | null;
  effectDefinition: string;
  weight: number;
  enabled: number;
  contentVersion: string;
}

interface UpgradeRecord {
  choice: UpgradeChoice;
  appliedAt: number;
}

export interface BattleEventReport {
  sequence: number;
  killsDelta: number;
  coreEnergyDelta: number;
  bossId?: string;
}

export interface BattleEndReport {
  totalKills: number;
  totalCoreEnergy: number;
  bossDefeated: string[];
  elapsedSeconds: number;
}

export interface BattleReward {
  scrap: number;
  blueprintId: string | null;
  partId: string | null;
  isFirstClear: boolean;
}

// ═══════════════════════════════════════════════════════
// 상수
// ═══════════════════════════════════════════════════════

const CONTENT_VERSION = P.CONTENT_VERSION;
const MAX_ACTIVE_SESSIONS_PER_USER = P.MAX_ACTIVE_SESSIONS_PER_USER;

// ═══════════════════════════════════════════════════════
// 강화 선택지 풀
// ═══════════════════════════════════════════════════════

const UPGRADE_POOL: UpgradeChoice[] = [
  // ═══════════ weapon (10) ═══════════
  { id: 'machine_gun_1', code: 'machine_gun_1', name: '머신건 I', description: '공격력 +15%', category: 'weapon', effectType: 'attack', effectValue: 15, rarity: 'common', group: 'machine_gun', tier: 1, maxTier: 3, evolvesTo: 'machine_gun_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'attack_mult:1.15', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'machine_gun_2', code: 'machine_gun_2', name: '머신건 II', description: '공격력 +30%', category: 'weapon', effectType: 'attack', effectValue: 30, rarity: 'common', group: 'machine_gun', tier: 2, maxTier: 3, evolvesTo: 'machine_gun_3', prerequisites: ['machine_gun_1'], compatibleWeapon: null, effectDefinition: 'attack_mult:1.30', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'machine_gun_3', code: 'machine_gun_3', name: '머신건 III', description: '공격력 +50%', category: 'weapon', effectType: 'attack', effectValue: 50, rarity: 'rare', group: 'machine_gun', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['machine_gun_2'], compatibleWeapon: null, effectDefinition: 'attack_mult:1.50', weight: 100, enabled: 1, contentVersion: '1.0.0' },

  { id: 'piercing_round_1', code: 'piercing_round_1', name: '관통탄 I', description: '공격력 +20%', category: 'weapon', effectType: 'attack', effectValue: 20, rarity: 'common', group: 'piercing_round', tier: 1, maxTier: 3, evolvesTo: 'piercing_round_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'attack_mult:1.20', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'piercing_round_2', code: 'piercing_round_2', name: '관통탄 II', description: '공격력 +40%', category: 'weapon', effectType: 'attack', effectValue: 40, rarity: 'rare', group: 'piercing_round', tier: 2, maxTier: 3, evolvesTo: 'piercing_round_3', prerequisites: ['piercing_round_1'], compatibleWeapon: null, effectDefinition: 'attack_mult:1.40', weight: 80, enabled: 1, contentVersion: '1.0.0' },
  { id: 'piercing_round_3', code: 'piercing_round_3', name: '관통탄 III', description: '공격력 +65%', category: 'weapon', effectType: 'attack', effectValue: 65, rarity: 'rare', group: 'piercing_round', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['piercing_round_2'], compatibleWeapon: null, effectDefinition: 'attack_mult:1.65', weight: 80, enabled: 1, contentVersion: '1.0.0' },

  { id: 'high_explosive_1', code: 'high_explosive_1', name: '고폭탄 I', description: '공격력 +25%', category: 'weapon', effectType: 'attack', effectValue: 25, rarity: 'rare', group: 'high_explosive', tier: 1, maxTier: 2, evolvesTo: 'high_explosive_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'attack_mult:1.25', weight: 60, enabled: 1, contentVersion: '1.0.0' },
  { id: 'high_explosive_2', code: 'high_explosive_2', name: '고폭탄 II', description: '공격력 +55%', category: 'weapon', effectType: 'attack', effectValue: 55, rarity: 'epic', group: 'high_explosive', tier: 2, maxTier: 2, evolvesTo: null, prerequisites: ['high_explosive_1'], compatibleWeapon: null, effectDefinition: 'attack_mult:1.55', weight: 40, enabled: 1, contentVersion: '1.0.0' },

  { id: 'rapid_fire_1', code: 'rapid_fire_1', name: '속사 I', description: '공격 속도 +15%', category: 'weapon', effectType: 'speed', effectValue: 15, rarity: 'common', group: 'rapid_fire', tier: 1, maxTier: 3, evolvesTo: 'rapid_fire_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'speed_mult:1.15', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'rapid_fire_2', code: 'rapid_fire_2', name: '속사 II', description: '공격 속도 +30%', category: 'weapon', effectType: 'speed', effectValue: 30, rarity: 'common', group: 'rapid_fire', tier: 2, maxTier: 3, evolvesTo: 'rapid_fire_3', prerequisites: ['rapid_fire_1'], compatibleWeapon: null, effectDefinition: 'speed_mult:1.30', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'rapid_fire_3', code: 'rapid_fire_3', name: '속사 III', description: '공격 속도 +50%', category: 'weapon', effectType: 'speed', effectValue: 50, rarity: 'rare', group: 'rapid_fire', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['rapid_fire_2'], compatibleWeapon: null, effectDefinition: 'speed_mult:1.50', weight: 100, enabled: 1, contentVersion: '1.0.0' },

  // ═══════════ drone (6) ═══════════
  { id: 'attack_drone_1', code: 'attack_drone_1', name: '공격 드론 I', description: '드론 공격력 +20%', category: 'drone', effectType: 'attack', effectValue: 20, rarity: 'common', group: 'attack_drone', tier: 1, maxTier: 3, evolvesTo: 'attack_drone_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'drone_attack:1.20', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'attack_drone_2', code: 'attack_drone_2', name: '공격 드론 II', description: '드론 공격력 +40%', category: 'drone', effectType: 'attack', effectValue: 40, rarity: 'rare', group: 'attack_drone', tier: 2, maxTier: 3, evolvesTo: 'attack_drone_3', prerequisites: ['attack_drone_1'], compatibleWeapon: null, effectDefinition: 'drone_attack:1.40', weight: 80, enabled: 1, contentVersion: '1.0.0' },
  { id: 'attack_drone_3', code: 'attack_drone_3', name: '공격 드론 III', description: '드론 공격력 +65%', category: 'drone', effectType: 'attack', effectValue: 65, rarity: 'epic', group: 'attack_drone', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['attack_drone_2'], compatibleWeapon: null, effectDefinition: 'drone_attack:1.65', weight: 60, enabled: 1, contentVersion: '1.0.0' },

  { id: 'repair_drone_1', code: 'repair_drone_1', name: '수리 드론 I', description: '초당 체력 +2', category: 'drone', effectType: 'heal', effectValue: 2, rarity: 'common', group: 'repair_drone', tier: 1, maxTier: 2, evolvesTo: 'repair_drone_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'hp_regen:2', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'repair_drone_2', code: 'repair_drone_2', name: '수리 드론 II', description: '초당 체력 +5', category: 'drone', effectType: 'heal', effectValue: 5, rarity: 'rare', group: 'repair_drone', tier: 2, maxTier: 2, evolvesTo: null, prerequisites: ['repair_drone_1'], compatibleWeapon: null, effectDefinition: 'hp_regen:5', weight: 80, enabled: 1, contentVersion: '1.0.0' },

  { id: 'drone_overclock', code: 'drone_overclock', name: '드론 과충전', description: '드론 공속 +50%', category: 'drone', effectType: 'speed', effectValue: 50, rarity: 'epic', group: 'drone_overclock', tier: 1, maxTier: 1, evolvesTo: null, prerequisites: [], compatibleWeapon: null, effectDefinition: 'drone_speed:1.50', weight: 50, enabled: 1, contentVersion: '1.0.0' },

  // ═══════════ armor (5) ═══════════
  { id: 'reinforced_armor_1', code: 'reinforced_armor_1', name: '강화 장갑 I', description: '최대 체력 +15%', category: 'armor', effectType: 'heal', effectValue: 15, rarity: 'common', group: 'reinforced_armor', tier: 1, maxTier: 3, evolvesTo: 'reinforced_armor_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'max_hp_mult:1.15', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'reinforced_armor_2', code: 'reinforced_armor_2', name: '강화 장갑 II', description: '최대 체력 +30%', category: 'armor', effectType: 'heal', effectValue: 30, rarity: 'rare', group: 'reinforced_armor', tier: 2, maxTier: 3, evolvesTo: 'reinforced_armor_3', prerequisites: ['reinforced_armor_1'], compatibleWeapon: null, effectDefinition: 'max_hp_mult:1.30', weight: 80, enabled: 1, contentVersion: '1.0.0' },
  { id: 'reinforced_armor_3', code: 'reinforced_armor_3', name: '강화 장갑 III', description: '최대 체력 +50%', category: 'armor', effectType: 'heal', effectValue: 50, rarity: 'epic', group: 'reinforced_armor', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['reinforced_armor_2'], compatibleWeapon: null, effectDefinition: 'max_hp_mult:1.50', weight: 60, enabled: 1, contentVersion: '1.0.0' },

  { id: 'shield_1', code: 'shield_1', name: '보호막 I', description: '30초마다 피해 면역 1초', category: 'armor', effectType: 'heal', effectValue: 1, rarity: 'rare', group: 'shield', tier: 1, maxTier: 2, evolvesTo: 'shield_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'shield:30,1', weight: 70, enabled: 1, contentVersion: '1.0.0' },
  { id: 'shield_2', code: 'shield_2', name: '보호막 II', description: '20초마다 피해 면역 2초', category: 'armor', effectType: 'heal', effectValue: 2, rarity: 'epic', group: 'shield', tier: 2, maxTier: 2, evolvesTo: null, prerequisites: ['shield_1'], compatibleWeapon: null, effectDefinition: 'shield:20,2', weight: 50, enabled: 1, contentVersion: '1.0.0' },

  // ═══════════ ultimate (5) ═══════════
  { id: 'overcharge_1', code: 'overcharge_1', name: '과충전 I', description: '궁극기 위력 +30%', category: 'ultimate', effectType: 'ultimate', effectValue: 30, rarity: 'common', group: 'overcharge', tier: 1, maxTier: 3, evolvesTo: 'overcharge_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'ult_power:1.30', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'overcharge_2', code: 'overcharge_2', name: '과충전 II', description: '궁극기 위력 +60%', category: 'ultimate', effectType: 'ultimate', effectValue: 60, rarity: 'rare', group: 'overcharge', tier: 2, maxTier: 3, evolvesTo: 'overcharge_3', prerequisites: ['overcharge_1'], compatibleWeapon: null, effectDefinition: 'ult_power:1.60', weight: 80, enabled: 1, contentVersion: '1.0.0' },
  { id: 'overcharge_3', code: 'overcharge_3', name: '과충전 III', description: '궁극기 위력 +100%', category: 'ultimate', effectType: 'ultimate', effectValue: 100, rarity: 'epic', group: 'overcharge', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['overcharge_2'], compatibleWeapon: null, effectDefinition: 'ult_power:2.00', weight: 60, enabled: 1, contentVersion: '1.0.0' },

  { id: 'cooldown_reduction_1', code: 'cooldown_reduction_1', name: '충전 가속 I', description: '궁극기 쿨타임 -15%', category: 'ultimate', effectType: 'ultimate', effectValue: -15, rarity: 'common', group: 'cooldown_reduction', tier: 1, maxTier: 2, evolvesTo: 'cooldown_reduction_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'ult_cd:0.85', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'cooldown_reduction_2', code: 'cooldown_reduction_2', name: '충전 가속 II', description: '궁극기 쿨타임 -35%', category: 'ultimate', effectType: 'ultimate', effectValue: -35, rarity: 'rare', group: 'cooldown_reduction', tier: 2, maxTier: 2, evolvesTo: null, prerequisites: ['cooldown_reduction_1'], compatibleWeapon: null, effectDefinition: 'ult_cd:0.65', weight: 80, enabled: 1, contentVersion: '1.0.0' },

  // ═══════════ utility (4) ═══════════
  { id: 'scrap_collector_1', code: 'scrap_collector_1', name: '수집가 I', description: 'scrap +20%', category: 'utility', effectType: 'scrap', effectValue: 20, rarity: 'common', group: 'scrap_collector', tier: 1, maxTier: 3, evolvesTo: 'scrap_collector_2', prerequisites: [], compatibleWeapon: null, effectDefinition: 'scrap_mult:1.20', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'scrap_collector_2', code: 'scrap_collector_2', name: '수집가 II', description: 'scrap +40%', category: 'utility', effectType: 'scrap', effectValue: 40, rarity: 'rare', group: 'scrap_collector', tier: 2, maxTier: 3, evolvesTo: 'scrap_collector_3', prerequisites: ['scrap_collector_1'], compatibleWeapon: null, effectDefinition: 'scrap_mult:1.40', weight: 80, enabled: 1, contentVersion: '1.0.0' },
  { id: 'scrap_collector_3', code: 'scrap_collector_3', name: '수집가 III', description: 'scrap +70%', category: 'utility', effectType: 'scrap', effectValue: 70, rarity: 'epic', group: 'scrap_collector', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['scrap_collector_2'], compatibleWeapon: null, effectDefinition: 'scrap_mult:1.70', weight: 60, enabled: 1, contentVersion: '1.0.0' },

  { id: 'core_amplifier', code: 'core_amplifier', name: '코어 증폭', description: 'core_energy +25%', category: 'utility', effectType: 'scrap', effectValue: 25, rarity: 'rare', group: 'core_amplifier', tier: 1, maxTier: 1, evolvesTo: null, prerequisites: [], compatibleWeapon: null, effectDefinition: 'core_mult:1.25', weight: 70, enabled: 1, contentVersion: '1.0.0' },
];

/** 32비트 LCG PRNG — 세션 시드로 결정론적 난수열 생성 */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}
function seededWeightedChoice(
  pool: UpgradeChoice[],
  count: number,
  seed: number,
  alreadyApplied: UpgradeRecord[],
): UpgradeChoice[] {
  const appliedIds = new Set(alreadyApplied.map((u) => u.choice.id));
  const appliedGroups = new Map<string, number>();
  for (const u of alreadyApplied) {
    const g = u.choice.group;
    appliedGroups.set(g, Math.max(appliedGroups.get(g) || 0, u.choice.tier));
  }

  // 필터: enabled=1, 최대단계 미도달, 선행조건 충족, 중복 제외
  const candidates = pool.filter((c) => {
    if (c.enabled !== 1) return false;
    // 이미 적용된 동일 upgrade 제외
    if (appliedIds.has(c.id)) return false;
    // 최대 단계 초과 제외
    const currentTier = appliedGroups.get(c.group) || 0;
    if (currentTier >= c.maxTier) return false;
    // 선행 조건: prerequisites에 있는 ID 중 applied되지 않은 것이 있으면 제외
    for (const prereq of c.prerequisites) {
      if (!appliedIds.has(prereq)) return false;
    }
    // 직전 tier가 아닌 경우 제외 (tier=1은 항상 가능, tier=n은 tier=n-1 필요)
    if (c.tier > 1) {
      const prevTier = c.tier - 1;
      const hasPrevTier = alreadyApplied.some(
        (u) => u.choice.group === c.group && u.choice.tier === prevTier,
      );
      if (!hasPrevTier && currentTier < c.tier - 1) return false;
    }
    return true;
  });

  if (candidates.length === 0) return [];

  const rng = createRng(seed);

  const result: UpgradeChoice[] = [];
  const used = new Set<string>();

  for (let i = 0; i < count && candidates.length > 0; i++) {
    const available = candidates.filter((c) => !used.has(c.id));
    if (available.length === 0) break;

    const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
    let target = Math.floor(rng() * totalWeight);

    let picked = available[0];
    for (const c of available) {
      target -= c.weight;
      if (target < 0) { picked = c; break; }
    }

    result.push(picked);
    used.add(picked.id);
    // 같은 group 중복 제시 방지
    for (const c of candidates) {
      if (c.group === picked.group) used.add(c.id);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════
// 세션 시작 — 스냅샷 + 시드 + 버전 고정
// ═══════════════════════════════════════════════════════

export async function startBattleSession(
  playerId: string,
  stageId: string,
): Promise<BattleSessionState> {
  const db = getDb();

  // 스테이지 검증 (존재, 활성화, 해금 확인)
  const stageRows = await db.select().from(stages).where(eq(stages.id, stageId)).limit(1);
  if (stageRows.length === 0) {
    throw new AppError('존재하지 않는 스테이지입니다.', 404, 'STAGE_NOT_FOUND');
  }
  if (stageRows[0].enabled !== 1) {
    throw new AppError('현재 출격할 수 없는 스테이지입니다.', 400, 'STAGE_DISABLED');
  }

  // 해금 조건 확인 (entryRequirement)
  const entryReq = stageRows[0].entryRequirement;
  if (entryReq && entryReq !== 'none' && entryReq.startsWith('clear_stage_')) {
    const requiredId = entryReq.replace('clear_', '');
    const records = await db.select().from(playerRecords)
      .where(and(eq(playerRecords.playerId, playerId), eq(playerRecords.stageId, requiredId)))
      .limit(1);
    if (records.length === 0) {
      throw new AppError('이전 스테이지를 먼저 클리어해야 합니다.', 400, 'STAGE_LOCKED');
    }
  }

  // 메카 스탯 확인 (없으면 기본 생성)
  let mechaRows = await db.select().from(mechaStats).where(eq(mechaStats.playerId, playerId)).limit(1);
  if (mechaRows.length === 0) {
    const now = new Date();
    await db.insert(mechaStats).values({
      id: crypto.randomUUID(),
      playerId,
      attackPower: 10,
      attackSpeed: 100,
      moveSpeed: 100,
      dashCooldown: 5000,
      ultimatePower: 30,
      ultimateCooldown: 30000,
      maxHp: 100,
      createdAt: now,
      updatedAt: now,
    });
    mechaRows = await db.select().from(mechaStats).where(eq(mechaStats.playerId, playerId)).limit(1);
  }
  const mecha = mechaRows[0];

  const now = new Date();

  // ─── 제재 확인: battle_restriction → 출격 차단 ───
  const restrictions = await db.select().from(accountSanctions)
    .where(and(eq(accountSanctions.userId, playerId), eq(accountSanctions.type, 'battle_restriction'), eq(accountSanctions.status, 'active')))
    .limit(1);
  if (restrictions.length > 0) {
    throw new AppError('전투 출격이 제한된 계정입니다.', 403, 'BATTLE_RESTRICTED');
  }

  // 활성 세션 상한 검사
  const activeSessions = await db.select().from(battleSessions)
    .where(and(eq(battleSessions.playerId, playerId), eq(battleSessions.status, 'active')))
    .limit(MAX_ACTIVE_SESSIONS_PER_USER);

  if (activeSessions.length >= MAX_ACTIVE_SESSIONS_PER_USER) {
    const existing = activeSessions[0];
    // 만료된 세션이면 자동 포기 후 새로 생성
    if (existing.expiresAt && new Date() > existing.expiresAt) {
      await db.update(battleSessions)
        .set({ status: 'abandoned', resultCode: 'expired', updatedAt: now })
        .where(eq(battleSessions.id, existing.id));
      logger.info({ playerId, oldSessionId: existing.id, event: 'battle_auto_abandoned' }, 'Expired session auto-abandoned');
    } else {
      // 유효한 세션이면 기존 세션 반환 (새로 생성하지 않음)
      return {
        sessionId: existing.id,
        playerId,
        stageId: existing.stageId,
        status: 'active' as const,
        coreEnergy: existing.coreEnergy,
        battleLevel: existing.battleLevel,
        killsReported: existing.killsReported,
        scrapAccumulated: existing.scrapAccumulated,
        upgradesApplied: JSON.parse(existing.upgradesApplied),
        offeredChoices: null,
        bossDefeated: JSON.parse(existing.bossDefeated),
        stage: null,
        startTime: existing.startTime.toISOString(),
        endTime: null,
        expiresAt: existing.expiresAt?.toISOString() || null,
      };
    }
  }

  // ─── 스냅샷: 현재 메카 스탯을 고정 ───
  const statSnapshot: MechaStatSnapshot = {
    attackPower: mecha.attackPower,
    attackSpeed: mecha.attackSpeed,
    moveSpeed: mecha.moveSpeed,
    dashCooldown: mecha.dashCooldown,
    ultimatePower: mecha.ultimatePower,
    ultimateCooldown: mecha.ultimateCooldown,
    maxHp: mecha.maxHp,
  };

  // ─── 세션 시드: 재현 가능한 무작위 시퀀스 ───
  const sessionSeed = Math.floor(Math.random() * 0xFFFFFFFF);

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + (stageRows[0].durationSeconds + 120) * 1000);

  await db.insert(battleSessions).values({
    id: sessionId,
    playerId,
    userId: '',
    stageId,
    status: 'active',
    coreEnergy: 0,
    currentCoreEnergy: 0,
    battleLevel: 1,
    currentLevel: 1,
    killsReported: 0,
    totalKills: 0,
    scrapAccumulated: 0,
    scrapEarnedInSession: 0,
    upgradesApplied: '[]',
    bossDefeated: '[]',
    highestBossSequence: 0,
    statSnapshot: JSON.stringify(statSnapshot),
    loadoutSnapshot: '{}',
    researchSnapshot: '{}',
    baseStatsSnapshot: JSON.stringify(statSnapshot),
    sessionSeed: String(sessionSeed),
    randomSeed: String(sessionSeed),
    contentVersion: CONTENT_VERSION,
    startTime: now,
    startedAt: now,
    expiresAt,
    currentElapsedMs: 0,
    createdAt: now,
    updatedAt: now,
  });

  logger.info({
    playerId, stageId, sessionId, sessionSeed,
    statSnapshot, contentVersion: CONTENT_VERSION,
    event: 'battle_start',
  }, 'Battle session started with snapshot');

  return {
    sessionId,
    playerId,
    stageId,
    status: 'active',
    coreEnergy: 0,
    battleLevel: 1,
    killsReported: 0,
    scrapAccumulated: 0,
    upgradesApplied: [],
    offeredChoices: null,
    bossDefeated: [],
    stage: null,
    startTime: now.toISOString(),
    endTime: null,
    expiresAt: null,
  };
}

// ═══════════════════════════════════════════════════════
// 이벤트 보고 (클라이언트 → 서버 검증)
// ═══════════════════════════════════════════════════════

export async function reportBattleEvent(
  sessionId: string,
  playerId: string,
  report: BattleEventReport,
): Promise<{
  accepted: boolean;
  coreEnergy: number;
  battleLevel: number;
  leveledUp: boolean;
  /** 서버가 생성·저장한 선택지 (클라이언트는 이 중 하나만 선택 가능) */
  offeredChoices: UpgradeChoice[] | null;
}> {
  const db = getDb();

  const rows = await db.select().from(battleSessions).where(eq(battleSessions.id, sessionId)).limit(1);
  if (rows.length === 0) {
    throw new AppError('존재하지 않는 전투 세션입니다.', 404, 'SESSION_NOT_FOUND');
  }

  const session = rows[0];
  if (session.playerId !== playerId) {
    throw new AppError('세션 소유자가 아닙니다.', 403, 'FORBIDDEN');
  }
  if (session.status !== 'active') {
    throw new AppError('이미 종료된 세션입니다.', 400, 'SESSION_NOT_ACTIVE');
  }

  // 세션 만료 확인
  if (session.expiresAt && new Date() > session.expiresAt) {
    logRejection(sessionId, playerId, 'SESSION_EXPIRED', {});
    throw new AppError('세션이 만료되었습니다.', 400, 'SESSION_EXPIRED');
  }

  // 세션 경과 시간
  const elapsedMs = Date.now() - session.startTime.getTime();
  const elapsedSec = Math.floor(elapsedMs / 1000);

  // ─── 스냅샷에서 스탯 읽기 (시작 시 고정된 값) ───
  const snap: MechaStatSnapshot = JSON.parse(session.statSnapshot);

  // 스테이지 정보
  const stageRows = await db.select().from(stages).where(eq(stages.id, session.stageId)).limit(1);
  const stage = stageRows[0];

  // 강화 효과 적용 (누적)
  const upgrades: UpgradeRecord[] = JSON.parse(session.upgradesApplied);
  let effectiveAttack = snap.attackPower;
  let effectiveSpeed = snap.attackSpeed;
  let scrapMultiplier = 1.0;

  for (const u of upgrades) {
    if (u.choice.effectType === 'attack') effectiveAttack = Math.floor(effectiveAttack * (1 + u.choice.effectValue / 100));
    if (u.choice.effectType === 'speed') effectiveSpeed = Math.floor(effectiveSpeed * (1 + u.choice.effectValue / 100));
    if (u.choice.effectType === 'scrap') scrapMultiplier *= (1 + u.choice.effectValue / 100);
  }

  // 선택지 미처리 상태에서는 새 이벤트 거부 (강제 선택 정책)
  let pendingChoices: UpgradeChoice[] | null = null;
  try {
    const parsed = JSON.parse(session.offeredChoices || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) pendingChoices = parsed;
  } catch { /* 무시 */ }

  if (pendingChoices && pendingChoices.length > 0) {
    throw new AppError('선택하지 않은 강화가 남아있습니다. 먼저 선택해주세요.', 400, 'PENDING_UPGRADE_CHOICE');
  }

  // ─── 검증 0: 이벤트 순서 (단조증가, DB UNIQUE로 중복 방지) ───
  if (report.sequence === undefined || report.sequence <= 0) {
    throw new AppError('이벤트 순서가 유효하지 않습니다.', 400, 'INVALID_SEQUENCE');
  }
  const newKills = session.killsReported + report.killsDelta;
  if (report.killsDelta < 0 || newKills > stage.maxKills + Math.floor(stage.maxKills * 0.05)) {
    throw new AppError('처치 수가 비정상적입니다.', 400, 'INVALID_KILL_COUNT');
  }

  // ─── 검증 2: core_energy 상한 (적 처치 기반 검증) ───
  const maxCoreFromKills = report.killsDelta * (stage.corePerKill || 5) * 1.2;
  if (report.coreEnergyDelta < 0 || report.coreEnergyDelta > maxCoreFromKills) {
    throw new AppError('core_energy가 처치 수 대비 비정상적입니다.', 400, 'INVALID_CORE_ENERGY');
  }
  const newCoreEnergy = session.coreEnergy + report.coreEnergyDelta;
  if (report.coreEnergyDelta < 0 || newCoreEnergy > stage.maxCoreEnergy + Math.floor(stage.maxCoreEnergy * 0.05)) {
    throw new AppError('core_energy가 비정상적입니다.', 400, 'INVALID_CORE_ENERGY');
  }

  // ─── 검증 3: 보스 처치 타이밍 ───
  if (report.bossId) {
    const bossTimings: number[] = JSON.parse(stage.bossTimings);
    const bossIndex = parseInt(report.bossId.replace('boss_', ''), 10);
    if (!isNaN(bossIndex) && bossIndex >= 0 && bossIndex < bossTimings.length) {
      if (elapsedSec < bossTimings[bossIndex] - 5) {
        throw new AppError('보스 등장 시간 이전입니다.', 400, 'BOSS_TIMING_INVALID');
      }
    }
  }

  // ─── 레벨업 체크 & 선택지 생성 (다중 레벨업 지원) ───
  const corePerLevel = stage.corePerLevel || 50;
  const newLevel = Math.floor(newCoreEnergy / corePerLevel) + 1;
  const levelDelta = newLevel - session.battleLevel;
  const leveledUp = levelDelta > 0;
  let offeredChoices: UpgradeChoice[] | null = null;
  let offeredChoicesJson: string | null = null;

  if (leveledUp) {
    // 시드: 세션시드 + (이전 레벨) → 각 레벨마다 결정론적 선택지
    // 여러 레벨을 건너뛴 경우, 마지막 레벨의 선택지만 제공
    // (중간 레벨은 자동 건너뛰기로 간주)
    const baseSeed = parseInt(session.sessionSeed || '0', 10);
    const lastLevelSeed = baseSeed + newLevel;
    offeredChoices = seededWeightedChoice(UPGRADE_POOL, 3, lastLevelSeed, upgrades);
    offeredChoicesJson = JSON.stringify(offeredChoices);
  }

  // DB 갱신
  const now = new Date();
  const bossDefeated: string[] = JSON.parse(session.bossDefeated);
  if (report.bossId && !bossDefeated.includes(report.bossId)) {
    bossDefeated.push(report.bossId);
  }

  const scrapGain = Math.floor(report.killsDelta * stage.scrapPerKill * scrapMultiplier);

  const updateData: Record<string, unknown> = {
    killsReported: newKills,
    coreEnergy: newCoreEnergy,
    battleLevel: newLevel,
    scrapAccumulated: session.scrapAccumulated + scrapGain,
    bossDefeated: JSON.stringify(bossDefeated),
    updatedAt: now,
  };

  // 선택지가 생성되었으면 DB에 저장
  if (offeredChoicesJson) {
    updateData.offeredChoices = offeredChoicesJson;
  }

  await db.update(battleSessions)
    .set(updateData)
    .where(eq(battleSessions.id, sessionId));

  // ─── 이벤트 로그 기록 (UNIQUE 제약으로 중복 sequence 방지) ───
  if (report.sequence !== undefined) {
    try {
      await db.insert(battleEvents).values({
        id: crypto.randomUUID(),
        battleSessionId: sessionId,
        sequence: report.sequence,
        eventType: report.bossId ? 'boss_defeat' : 'kill',
        elapsedMs: elapsedMs,
        payload: JSON.stringify({ killsDelta: report.killsDelta, coreEnergyDelta: report.coreEnergyDelta, bossId: report.bossId }),
        createdAt: now,
      });
    } catch (err) {
      if ((err as { errno?: number }).errno === 1062) { // ER_DUP_ENTRY
        throw new AppError('이미 처리된 이벤트 순서입니다.', 409, 'DUPLICATE_SEQUENCE');
      }
      throw err;
    }
  }

  logger.info({
    sessionId, playerId, killsDelta: report.killsDelta,
    coreEnergy: newCoreEnergy, battleLevel: newLevel,
    leveledUp, offeredCount: offeredChoices?.length || 0,
    event: 'battle_event',
  }, 'Battle event verified');

  return {
    accepted: true,
    coreEnergy: newCoreEnergy,
    battleLevel: newLevel,
    leveledUp,
    offeredChoices,
  };
}

// ═══════════════════════════════════════════════════════
// 강화 선택 (서버 저장 선택지에서만 선택 가능)
// ═══════════════════════════════════════════════════════

export async function selectUpgrade(
  sessionId: string,
  playerId: string,
  selectedId: string,
): Promise<{ applied: UpgradeChoice; allUpgrades: UpgradeChoice[] }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(battleSessions).where(eq(battleSessions.id, sessionId)).limit(1);
    if (rows.length === 0) {
      throw new AppError('존재하지 않는 전투 세션입니다.', 404, 'SESSION_NOT_FOUND');
    }

    const session = rows[0];
    if (session.playerId !== playerId) {
      throw new AppError('세션 소유자가 아닙니다.', 403, 'FORBIDDEN');
    }
    if (session.status !== 'active') {
      throw new AppError('이미 종료된 세션입니다.', 400, 'SESSION_NOT_ACTIVE');
    }

    if (session.expiresAt && new Date() > session.expiresAt) {
      throw new AppError('세션이 만료되었습니다.', 400, 'SESSION_EXPIRED');
    }

    // 서버가 저장한 선택지에서만 선택 가능
    let offeredChoices: UpgradeChoice[] = [];
    try {
      offeredChoices = JSON.parse(session.offeredChoices || '[]');
    } catch {
      throw new AppError('선택지 데이터가 손상되었습니다.', 500, 'INTERNAL_ERROR');
    }

    if (offeredChoices.length === 0) {
      throw new AppError('아직 선택지가 생성되지 않았습니다.', 400, 'NO_CHOICES_OFFERED');
    }

    // 이미 선택한 레벨인지 확인 (중복 선택 방지)
    const upgrades: UpgradeRecord[] = JSON.parse(session.upgradesApplied);
    const currentLevel = session.battleLevel;
    const alreadyChoseThisLevel = upgrades.some((u) => u.choice.id === selectedId);
    if (alreadyChoseThisLevel) {
      throw new AppError('이미 선택한 강화입니다.', 409, 'UPGRADE_ALREADY_SELECTED');
    }

    // 강화 조건 검증: maxTier, prerequisites
    const selected = UPGRADE_POOL.find((c) => c.id === selectedId);
    if (!selected) {
      throw new AppError('존재하지 않는 강화입니다.', 404, 'UPGRADE_NOT_FOUND');
    }

    const validIds = new Set(offeredChoices.map((c) => c.id));
    if (!validIds.has(selectedId)) {
      throw new AppError('이번 선택지에 포함되지 않은 강화입니다.', 400, 'INVALID_UPGRADE_CHOICE');
    }

    // 최대 단계 검증
    const appliedGroupTier = upgrades.filter((u) => u.choice.group === selected.group).length;
    if (appliedGroupTier >= selected.maxTier) {
      throw new AppError('이미 최대 단계에 도달했습니다.', 400, 'MAX_TIER_REACHED');
    }

    const elapsedMs = Date.now() - session.startTime.getTime();
    const now = new Date();

    upgrades.push({ choice: selected, appliedAt: elapsedMs });

    // 세션 갱신
    await tx.update(battleSessions)
      .set({
        upgradesApplied: JSON.stringify(upgrades),
        offeredChoices: '[]',
        updatedAt: now,
      })
      .where(eq(battleSessions.id, sessionId));

    // 선택 기록 저장
    await tx.insert(battleUpgradeOffers).values({
      id: crypto.randomUUID(),
      battleSessionId: sessionId,
      level: currentLevel,
      sequence: 1,
      optionSlot: 1,
      upgradeId: selectedId,
      selected: 1,
      selectedAt: now,
      createdAt: now,
    }).catch(() => { /* UNIQUE 제약 위반 시 조용히 넘김 */ });

    const allUpgrades = upgrades.map((u) => u.choice);

    logger.info({ sessionId, playerId, upgradeId: selectedId, totalUpgrades: allUpgrades.length, event: 'battle_upgrade' }, 'Upgrade selected and applied');

    return { applied: selected, allUpgrades };
  });
}

// ═══════════════════════════════════════════════════════
// 전투 종료 & 전체 검증 → 영구 보상 확정 (단일 트랜잭션)
// ═══════════════════════════════════════════════════════

export async function endBattleSession(
  sessionId: string,
  playerId: string,
  report: BattleEndReport,
): Promise<{ verified: boolean; reward: BattleReward; isNewRecord: boolean }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // ─── 원자적 상태 전이 (CAS): active → completing ───
    // 단 하나의 요청만 이 UPDATE에 성공
    const transitionResult = await tx.update(battleSessions)
      .set({ status: 'completing' })
      .where(and(eq(battleSessions.id, sessionId), eq(battleSessions.status, 'active')));

    if ((transitionResult[0]?.affectedRows ?? 0) === 0) {
      throw new AppError('이미 종료되었거나 처리 중인 세션입니다.', 409, 'SESSION_NOT_ACTIVE');
    }

    // CAS 성공 후 세션 재조회
    const rows = await tx.select().from(battleSessions)
      .where(eq(battleSessions.id, sessionId))
      .limit(1);

    if (rows.length === 0) {
      throw new AppError('존재하지 않는 전투 세션입니다.', 404, 'SESSION_NOT_FOUND');
    }

    const session = rows[0];
    if (session.playerId !== playerId) {
      throw new AppError('세션 소유자가 아닙니다.', 403, 'FORBIDDEN');
    }

    // 만료 확인
    if (session.expiresAt && new Date() > session.expiresAt) {
      throw new AppError('세션이 만료되었습니다.', 400, 'SESSION_EXPIRED');
    }

    // 미선택 강화 확인
    let pendingChoices: UpgradeChoice[] | null = null;
    try {
      const parsed = JSON.parse(session.offeredChoices || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) pendingChoices = parsed;
    } catch { /* 무시 */ }

    if (pendingChoices && pendingChoices.length > 0) {
      throw new AppError('선택하지 않은 강화가 남아있습니다. 먼저 선택해주세요.', 400, 'PENDING_UPGRADE_CHOICE');
    }

    const stageRows = await tx.select().from(stages)
      .where(eq(stages.id, session.stageId)).limit(1);
    const stage = stageRows[0];

    // ─── 검증 1: 세션 경과시간 ───
    const actualElapsedMs = Date.now() - session.startTime.getTime();
    const actualElapsedSec = Math.floor(actualElapsedMs / 1000);
    if (report.elapsedSeconds > actualElapsedSec + 10) {
      throw new AppError('보고된 경과시간이 실제와 일치하지 않습니다.', 400, 'TIME_MISMATCH');
    }

    // ─── 검증 2: 총 처치 수 ───
    if (report.totalKills > session.killsReported + 5) {
      throw new AppError('보고된 처치 수가 세션 기록을 초과합니다.', 400, 'KILL_COUNT_MISMATCH');
    }

    // ─── 검증 3: 총 core_energy ───
    if (report.totalCoreEnergy > session.coreEnergy + 10) {
      throw new AppError('보고된 core_energy가 세션 기록을 초과합니다.', 400, 'CORE_ENERGY_MISMATCH');
    }

    // ─── 검증 4: 보스 처치 — 서버가 기록한 것만 인정 ───
    const sessionBosses: string[] = JSON.parse(session.bossDefeated);
    for (const b of report.bossDefeated) {
      if (!sessionBosses.includes(b)) {
        throw new AppError(`검증되지 않은 보스 처치: ${b}`, 400, 'BOSS_VERIFY_FAILED');
      }
    }

    // ─── 클리어 타입 판정 ───
    const allStageBosses = JSON.parse(stage.bossTimings).map((_: number, i: number) => `boss_${i}`);
    const allBossesDefeated = allStageBosses.length > 0 && allStageBosses.every((b: string) => sessionBosses.includes(b));

    // 기존 기록 확인 (최초 클리어 여부)
    const recordRows = await tx.select().from(playerRecords)
      .where(and(eq(playerRecords.playerId, playerId), eq(playerRecords.stageId, session.stageId)))
      .limit(1);
    const isFirstClear = recordRows.length === 0;
    const effectiveClearType = isFirstClear ? 'first' : (allBossesDefeated ? 'normal' : 'partial');

    // ─── 보상 계산 (세션 시드 기반 결정론적 난수) ───
    const rng = createRng(parseInt(session.sessionSeed || '0', 10) + 999);

    const rewardRows = await tx.select().from(stageRewards)
      .where(and(eq(stageRewards.stageId, session.stageId), eq(stageRewards.clearType, effectiveClearType)))
      .limit(1);

    let scrapReward = session.scrapAccumulated;
    let blueprintId: string | null = null;
    let partId: string | null = null;

    if (rewardRows.length > 0) {
      const rw = rewardRows[0];
      const bonusScrap = rw.scrapMin + Math.floor(rng() * (rw.scrapMax - rw.scrapMin + 1));
      scrapReward = session.scrapAccumulated + bonusScrap;

      if (rw.blueprintDropRate > 0 && rng() * 100 < rw.blueprintDropRate) {
        blueprintId = `blueprint_stage_${session.stageId}`;
      }

      // 파츠 드롭 (10% 기본 확률)
      if (rng() * 100 < 10) {
        partId = `part_common_${Math.floor(rng() * 5) + 1}`;
      }
    }

    if (isFirstClear) {
      // 최초 클리어 보상은 stageRewards.clearType='first' 행으로 처리됨
      // 추가 배율 없음: first 행이 이미 높은 값을 포함
      if (!blueprintId && rewardRows.length > 0 && rewardRows[0].blueprintDropRate > 0) {
        blueprintId = `blueprint_first_${session.stageId}`;
      }
    }

    const now = new Date();
    const isNewRecord = recordRows.length === 0 || report.totalKills > recordRows[0].bestKillCount;

    // ─── 1. 세션 종료 ───
    await tx.update(battleSessions)
      .set({
        status: 'completed',
        completedAt: now,
        resultCode: 'completed',
        endTime: now,
        verifiedAt: now,
        rewardScrap: scrapReward,
        rewardBlueprint: blueprintId,
        updatedAt: now,
      })
      .where(eq(battleSessions.id, sessionId));

    // ─── 1.5 전투 결과 확정 기록 (UNIQUE 방어: 중복 시 조용히 넘김) ───
    try {
      await tx.insert(battleResults).values({
        id: crypto.randomUUID(),
        battleSessionId: sessionId,
        userId: session.userId || playerId,
        result: allBossesDefeated ? 'completed' : 'partial',
        isFirstClear: isFirstClear ? 1 : 0,
        verifiedElapsedMs: report.elapsedSeconds * 1000,
        verifiedKills: report.totalKills,
        verifiedBossSequence: sessionBosses.length,
        scrapReward,
        rewardSummary: JSON.stringify({ blueprintId, partId, isFirstClear, effectiveClearType }),
        finalizedAt: now,
        createdAt: now,
      });
    } catch (err) {
      if ((err as { errno?: number }).errno === 1062) { /* ER_DUP_ENTRY: 이미 존재, 무시 */ }
      else throw err;
    }

    // ─── 2. 지갑에 scrap 입금 (기존 재화 서비스와 동일 패턴) ───
    const walletRows = await tx.select().from(walletBalances)
      .where(eq(walletBalances.playerId, playerId))
      .limit(1);

    if (walletRows.length > 0) {
      const wallet = walletRows[0];
      const newScrap = wallet.scrap + scrapReward;
      await tx.update(walletBalances)
        .set({ scrap: newScrap, updatedAt: now })
        .where(eq(walletBalances.playerId, playerId));

      // 원장 기록 (append-only)
      await tx.insert(currencyLedger).values({
        id: crypto.randomUUID(),
        playerId,
        userId: wallet.userId,
        currency: 'scrap',
        amount: scrapReward,
        balanceAfter: newScrap,
        source: 'battle',
        reason: `stage_${session.stageId}_${effectiveClearType}`,
        referenceType: 'battle_session',
        referenceId: sessionId,
        createdAt: now,
      });

      // 파츠 획득 시 아이템 원장 기록
      if (partId) {
        await tx.insert(itemLedger).values({
          id: crypto.randomUUID(),
          playerId,
          userId: wallet.userId,
          itemType: 'part',
          itemId: partId,
          quantity: 1,
          source: 'battle_reward',
          referenceType: 'battle_session',
          referenceId: sessionId,
          createdAt: now,
        });
      }
    }

    // ─── 3. 기록 갱신 ───
    if (isNewRecord) {
      if (recordRows.length === 0) {
        await tx.insert(playerRecords).values({
          id: crypto.randomUUID(),
          playerId,
          stageId: session.stageId,
          bestKillCount: report.totalKills,
          bestClearTimeSec: report.elapsedSeconds,
          totalClears: 1,
          firstClearedAt: now,
          lastClearedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await tx.update(playerRecords)
          .set({
            bestKillCount: Math.max(recordRows[0].bestKillCount, report.totalKills),
            bestClearTimeSec: recordRows[0].bestClearTimeSec
              ? Math.min(recordRows[0].bestClearTimeSec, report.elapsedSeconds)
              : report.elapsedSeconds,
            totalClears: recordRows[0].totalClears + 1,
            lastClearedAt: now,
            updatedAt: now,
          })
          .where(eq(playerRecords.id, recordRows[0].id));
      }
    } else if (recordRows.length > 0) {
      await tx.update(playerRecords)
        .set({
          totalClears: recordRows[0].totalClears + 1,
          lastClearedAt: now,
          updatedAt: now,
        })
        .where(eq(playerRecords.id, recordRows[0].id));
    }

    // ─── 3.5 최초 클리어 시 다음 스테이지 해금 ───
    if (isFirstClear && allBossesDefeated) {
      const currentStageSeq = stage.sequence;
      const nextStages = await tx.select().from(stages)
        .where(eq(stages.sequence, currentStageSeq + 1))
        .limit(1);
      if (nextStages.length > 0) {
        const nextStageId = nextStages[0].id;
        const existingProgress = await tx.select().from(playerStageProgress)
          .where(and(eq(playerStageProgress.playerId, playerId), eq(playerStageProgress.stageId, nextStageId)))
          .limit(1);
        if (existingProgress.length === 0) {
          await tx.insert(playerStageProgress).values({
            id: crypto.randomUUID(),
            playerId,
            userId: session.userId || playerId,
            stageId: nextStageId,
            unlockedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    const reward: BattleReward = { scrap: scrapReward, blueprintId, partId, isFirstClear };

    logger.info({
      playerId, sessionId, stageId: session.stageId,
      kills: report.totalKills, scrapReward, isFirstClear,
      event: 'battle_end',
    }, 'Battle session completed, verified, and rewards credited');

    return { verified: true, reward, isNewRecord };
  });
}

// ═══════════════════════════════════════════════════════
// 세션 포기
// ═══════════════════════════════════════════════════════

export async function abandonBattleSession(sessionId: string, playerId: string): Promise<void> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(battleSessions)
      .where(eq(battleSessions.id, sessionId))
      .limit(1);

    if (rows.length === 0) {
      throw new AppError('존재하지 않는 전투 세션입니다.', 404, 'SESSION_NOT_FOUND');
    }

    const session = rows[0];
    if (session.playerId !== playerId) {
      throw new AppError('세션 소유자가 아닙니다.', 403, 'FORBIDDEN');
    }
    if (session.status !== 'active') {
      throw new AppError('이미 종료된 세션입니다.', 400, 'SESSION_NOT_ACTIVE');
    }

    // 만료된 세션도 포기 가능 (상태 정리 목적)
    // 이미 만료됐으면 조용히 abandoned 처리

    const now = new Date();
    await tx.update(battleSessions)
      .set({
        status: 'abandoned',
        completedAt: now,
        endTime: now,
        resultCode: 'abandoned',
        updatedAt: now,
      })
      .where(eq(battleSessions.id, sessionId));

    // 포기 시 영구 보상 없음
    await tx.insert(battleResults).values({
      id: crypto.randomUUID(),
      battleSessionId: sessionId,
      userId: session.userId || playerId,
      result: 'abandoned',
      isFirstClear: 0,
      verifiedElapsedMs: Math.floor(Date.now() - session.startTime.getTime()),
      verifiedKills: session.killsReported,
      verifiedBossSequence: 0,
      scrapReward: 0,
      rewardSummary: '{}',
      finalizedAt: now,
      createdAt: now,
    });

    logger.info({ playerId, sessionId, event: 'battle_abandoned' }, 'Battle session abandoned');
  });
}

// ═══════════════════════════════════════════════════════
// 세션 조회
// ═══════════════════════════════════════════════════════

export async function getBattleSession(sessionId: string, playerId: string): Promise<BattleSessionState> {
  const db = getDb();
  const rows = await db.select().from(battleSessions).where(eq(battleSessions.id, sessionId)).limit(1);
  if (rows.length === 0) {
    throw new AppError('존재하지 않는 전투 세션입니다.', 404, 'SESSION_NOT_FOUND');
  }

  const session = rows[0];
  if (session.playerId !== playerId) {
    throw new AppError('세션 소유자가 아닙니다.', 403, 'FORBIDDEN');
  }

  let offeredChoices: UpgradeChoice[] | null = null;
  try {
    const parsed = JSON.parse(session.offeredChoices || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) offeredChoices = parsed;
  } catch { /* 빈 배열 유지 */ }

  // 스테이지 정보 포함
  const stageRows = await db.select().from(stages)
    .where(eq(stages.id, session.stageId)).limit(1);
  const stageInfo = stageRows.length > 0 ? {
    id: stageRows[0].id,
    name: stageRows[0].name,
    durationSeconds: stageRows[0].durationSeconds,
    recommendedPower: stageRows[0].recommendedPower,
    maxKills: stageRows[0].maxKills,
    maxCoreEnergy: stageRows[0].maxCoreEnergy,
    corePerLevel: stageRows[0].corePerLevel || 50,
    corePerKill: stageRows[0].corePerKill || 5,
    scrapPerKill: stageRows[0].scrapPerKill,
  } : null;

  return {
    sessionId: session.id,
    playerId: session.playerId,
    stageId: session.stageId,
    status: session.status as 'active' | 'completed' | 'abandoned',
    coreEnergy: session.coreEnergy,
    battleLevel: session.battleLevel,
    killsReported: session.killsReported,
    scrapAccumulated: session.scrapAccumulated,
    upgradesApplied: JSON.parse(session.upgradesApplied),
    offeredChoices,
    bossDefeated: JSON.parse(session.bossDefeated),
    stage: stageInfo,
    startTime: session.startTime.toISOString(),
    endTime: session.endTime?.toISOString() || null,
    expiresAt: null,
  };
}
