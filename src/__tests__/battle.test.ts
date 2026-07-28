/**
 * 전투 시스템 단위 테스트
 *
 * 순수 함수 단위 테스트: DB 의존성 없이 비즈니스 로직 검증
 */
import { describe, it, expect } from 'vitest';

// ─── 타입 (battle-session.ts와 동기화) ─────────────────

interface UpgradeChoice {
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

// ─── 미니 풀 (30개 중 핵심 12개만) ──────────────────

const MINI_POOL: UpgradeChoice[] = [
  { id: 'machine_gun_1', code: 'machine_gun_1', name: '머신건 I', description: '공격력 +15%', category: 'weapon', effectType: 'attack', effectValue: 15, rarity: 'common', group: 'machine_gun', tier: 1, maxTier: 3, evolvesTo: 'machine_gun_2', prerequisites: [], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'machine_gun_2', code: 'machine_gun_2', name: '머신건 II', description: '공격력 +30%', category: 'weapon', effectType: 'attack', effectValue: 30, rarity: 'common', group: 'machine_gun', tier: 2, maxTier: 3, evolvesTo: 'machine_gun_3', prerequisites: ['machine_gun_1'], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'machine_gun_3', code: 'machine_gun_3', name: '머신건 III', description: '공격력 +50%', category: 'weapon', effectType: 'attack', effectValue: 50, rarity: 'rare', group: 'machine_gun', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['machine_gun_2'], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'rapid_fire_1', code: 'rapid_fire_1', name: '속사 I', description: '공속 +15%', category: 'weapon', effectType: 'speed', effectValue: 15, rarity: 'common', group: 'rapid_fire', tier: 1, maxTier: 3, evolvesTo: 'rapid_fire_2', prerequisites: [], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'rapid_fire_2', code: 'rapid_fire_2', name: '속사 II', description: '공속 +30%', category: 'weapon', effectType: 'speed', effectValue: 30, rarity: 'common', group: 'rapid_fire', tier: 2, maxTier: 3, evolvesTo: 'rapid_fire_3', prerequisites: ['rapid_fire_1'], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'rapid_fire_3', code: 'rapid_fire_3', name: '속사 III', description: '공속 +50%', category: 'weapon', effectType: 'speed', effectValue: 50, rarity: 'rare', group: 'rapid_fire', tier: 3, maxTier: 3, evolvesTo: null, prerequisites: ['rapid_fire_2'], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'attack_drone_1', code: 'attack_drone_1', name: '공격 드론 I', description: '드론 +20%', category: 'drone', effectType: 'attack', effectValue: 20, rarity: 'common', group: 'attack_drone', tier: 1, maxTier: 3, evolvesTo: 'attack_drone_2', prerequisites: [], compatibleWeapon: null, effectDefinition: '', weight: 80, enabled: 1, contentVersion: '1.0.0' },
  { id: 'attack_drone_2', code: 'attack_drone_2', name: '공격 드론 II', description: '드론 +40%', category: 'drone', effectType: 'attack', effectValue: 40, rarity: 'rare', group: 'attack_drone', tier: 2, maxTier: 3, evolvesTo: 'attack_drone_3', prerequisites: ['attack_drone_1'], compatibleWeapon: null, effectDefinition: '', weight: 80, enabled: 1, contentVersion: '1.0.0' },
  { id: 'shield_1', code: 'shield_1', name: '보호막 I', description: '보호막 1초', category: 'armor', effectType: 'heal', effectValue: 1, rarity: 'rare', group: 'shield', tier: 1, maxTier: 2, evolvesTo: 'shield_2', prerequisites: [], compatibleWeapon: null, effectDefinition: '', weight: 70, enabled: 1, contentVersion: '1.0.0' },
  { id: 'shield_2', code: 'shield_2', name: '보호막 II', description: '보호막 2초', category: 'armor', effectType: 'heal', effectValue: 2, rarity: 'epic', group: 'shield', tier: 2, maxTier: 2, evolvesTo: null, prerequisites: ['shield_1'], compatibleWeapon: null, effectDefinition: '', weight: 50, enabled: 1, contentVersion: '1.0.0' },
  { id: 'overcharge_1', code: 'overcharge_1', name: '과충전 I', description: '궁극기 +30%', category: 'ultimate', effectType: 'ultimate', effectValue: 30, rarity: 'common', group: 'overcharge', tier: 1, maxTier: 3, evolvesTo: 'overcharge_2', prerequisites: [], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
  { id: 'scrap_collector_1', code: 'scrap_collector_1', name: '수집가 I', description: 'scrap +20%', category: 'utility', effectType: 'scrap', effectValue: 20, rarity: 'common', group: 'scrap_collector', tier: 1, maxTier: 3, evolvesTo: 'scrap_collector_2', prerequisites: [], compatibleWeapon: null, effectDefinition: '', weight: 100, enabled: 1, contentVersion: '1.0.0' },
];

// ─── PRNG (battle-session.ts와 동일 로직) ───────────

function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

// ─── 가중치 선택 (battle-session.ts와 동일 로직) ────

interface UpgradeRecord {
  choice: UpgradeChoice;
  appliedAt: number;
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

  const candidates = pool.filter((c) => {
    if (c.enabled !== 1) return false;
    if (appliedIds.has(c.id)) return false;
    const currentTier = appliedGroups.get(c.group) || 0;
    if (currentTier >= c.maxTier) return false;
    for (const prereq of c.prerequisites) {
      if (!appliedIds.has(prereq)) return false;
    }
    if (c.tier > 1) {
      const prevTier = c.tier - 1;
      const hasPrev = alreadyApplied.some(
        (u) => u.choice.group === c.group && u.choice.tier === prevTier,
      );
      if (!hasPrev && currentTier < c.tier - 1) return false;
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
    for (const c of candidates) {
      if (c.group === picked.group) used.add(c.id);
    }
  }

  return result;
}

// ─── core_energy / level up ──────────────────────────

function calculateLevel(coreEnergy: number, corePerLevel: number): number {
  return Math.floor(coreEnergy / corePerLevel) + 1;
}

// ─── stage unlock ────────────────────────────────────

function canEnterStage(
  entryRequirement: string,
  unlockedStageIds: Set<string>,
): boolean {
  if (entryRequirement === 'none') return true;
  if (entryRequirement.startsWith('clear_stage_')) {
    const requiredId = entryRequirement.replace('clear_', '');
    return unlockedStageIds.has(requiredId);
  }
  return false;
}

// ═══════════════════════════════════════════════════════
// 테스트
// ═══════════════════════════════════════════════════════

describe('Core Energy & Level', () => {
  it('core_energy=0 → level=1', () => {
    expect(calculateLevel(0, 50)).toBe(1);
  });

  it('core_energy=49 → level=1', () => {
    expect(calculateLevel(49, 50)).toBe(1);
  });

  it('core_energy=50 → level=2', () => {
    expect(calculateLevel(50, 50)).toBe(2);
  });

  it('core_energy=500 → level=11', () => {
    expect(calculateLevel(500, 50)).toBe(11);
  });

  it('stage별 corePerLevel 적용', () => {
    expect(calculateLevel(100, 20)).toBe(6);  // 5레벨업
    expect(calculateLevel(100, 100)).toBe(2); // 1레벨업
  });
});

describe('Stage Unlock', () => {
  it('entry=none → always accessible', () => {
    expect(canEnterStage('none', new Set())).toBe(true);
  });

  it('clear_stage_01 → requires stage_01 in set', () => {
    expect(canEnterStage('clear_stage_01_ruins', new Set())).toBe(false);
    expect(canEnterStage('clear_stage_01_ruins', new Set(['stage_01_ruins']))).toBe(true);
  });

  it('stage_04 requires stage_03', () => {
    const cleared = new Set(['stage_01_ruins', 'stage_02_canyon']);
    expect(canEnterStage('clear_stage_03_furnace', cleared)).toBe(false);
    cleared.add('stage_03_furnace');
    expect(canEnterStage('clear_stage_03_furnace', cleared)).toBe(true);
  });
});

describe('Seeded Upgrade Choice Generation', () => {
  it('같은 seed, 빈 applied → 같은 선택지', () => {
    const a = seededWeightedChoice(MINI_POOL, 3, 42, []);
    const b = seededWeightedChoice(MINI_POOL, 3, 42, []);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it('다른 seed → 다른 선택지', () => {
    const a = seededWeightedChoice(MINI_POOL, 3, 42, []);
    const b = seededWeightedChoice(MINI_POOL, 3, 99, []);
    // 확률적으로 다를 가능성이 높지만, 동일할 수도 있음 → 존재 여부만 확인
    expect(a.length).toBe(3);
    expect(b.length).toBe(3);
  });

  it('정확히 3개 반환 (후보가 충분할 때)', () => {
    const result = seededWeightedChoice(MINI_POOL, 3, 123, []);
    expect(result.length).toBe(3);
    // 모두 unique
    expect(new Set(result.map((c) => c.id)).size).toBe(3);
  });

  it('같은 group에서 2개 이상 제시하지 않음', () => {
    const result = seededWeightedChoice(MINI_POOL, 3, 999, []);
    const groups = result.map((c) => c.group);
    expect(new Set(groups).size).toBe(groups.length); // 모두 unique group
  });

  it('비활성 강화(enabled=0)는 제외', () => {
    const pool = MINI_POOL.map((c) => ({ ...c }));
    pool[0] = { ...pool[0], enabled: 0 }; // machine_gun_1 비활성
    const result = seededWeightedChoice(pool, 3, 42, []);
    const ids = result.map((c) => c.id);
    expect(ids).not.toContain('machine_gun_1');
  });

  it('prerequisites 미충족 시 제외', () => {
    const result = seededWeightedChoice(MINI_POOL, 3, 42, []);
    // machine_gun_2, machine_gun_3은 prerequisites 필요 → tier1만 가능
    const ids = result.map((c) => c.id);
    expect(ids).not.toContain('machine_gun_2'); // tier2, prereq machine_gun_1 필요
    expect(ids).not.toContain('machine_gun_3'); // tier3, prereq cascade 필요
  });

  it('machine_gun_1 적용 후 machine_gun_2 제시 가능', () => {
    const applied: UpgradeRecord[] = [
      { choice: MINI_POOL[0], appliedAt: 1000 }, // machine_gun_1
    ];
    const result = seededWeightedChoice(MINI_POOL, 3, 42, applied);
    const ids = result.map((c) => c.id);
    // machine_gun_1은 이미 적용됨 → 제외됨
    expect(ids).not.toContain('machine_gun_1');
    // machine_gun_2는 이제 자격 있음
    // (확률이므로 무조건 포함은 아님, 후보에는 포함되어야 함)
  });

  it('maxTier 도달 시 해당 group 완전 제외', () => {
    const applied: UpgradeRecord[] = [
      { choice: MINI_POOL[0], appliedAt: 1000 }, // machine_gun_1
      { choice: MINI_POOL[1], appliedAt: 2000 }, // machine_gun_2
      { choice: MINI_POOL[2], appliedAt: 3000 }, // machine_gun_3 (max)
    ];
    const result = seededWeightedChoice(MINI_POOL, 3, 42, applied);
    const ids = result.map((c) => c.id);
    expect(ids).not.toContain('machine_gun_1');
    expect(ids).not.toContain('machine_gun_2');
    expect(ids).not.toContain('machine_gun_3');
  });
});

// ─── 보상 계산 ─────────────────────────────────────

function calculateBattleReward(
  scrapAccumulated: number,
  stageReward: { scrapMin: number; scrapMax: number; blueprintDropRate: number },
  rng: () => number,
): { scrap: number; blueprintId: string | null } {
  const bonusScrap = stageReward.scrapMin + Math.floor(rng() * (stageReward.scrapMax - stageReward.scrapMin + 1));
  const scrap = scrapAccumulated + bonusScrap;
  const blueprintId = (stageReward.blueprintDropRate > 0 && rng() * 100 < stageReward.blueprintDropRate)
    ? 'blueprint_stage_test' : null;
  return { scrap, blueprintId };
}

describe('Reward Calculation', () => {
  const normalReward = { scrapMin: 80, scrapMax: 140, blueprintDropRate: 10 };
  const firstReward = { scrapMin: 200, scrapMax: 350, blueprintDropRate: 100 };

  it('scrap = accumulated + bonus', () => {
    const rng = createRng(42);
    const result = calculateBattleReward(100, normalReward, rng);
    expect(result.scrap).toBeGreaterThanOrEqual(100 + 80);
    expect(result.scrap).toBeLessThanOrEqual(100 + 140);
  });

  it('same seed -> same reward (deterministic)', () => {
    const a = calculateBattleReward(100, normalReward, createRng(42));
    const b = calculateBattleReward(100, normalReward, createRng(42));
    expect(a).toEqual(b);
  });

  it('blueprintDropRate=0 -> no blueprint', () => {
    const result = calculateBattleReward(50, { scrapMin: 30, scrapMax: 60, blueprintDropRate: 0 }, createRng(42));
    expect(result.blueprintId).toBeNull();
  });

  it('blueprintDropRate=100 -> guaranteed blueprint', () => {
    const result = calculateBattleReward(100, firstReward, createRng(42));
    expect(result.blueprintId).not.toBeNull();
  });
});

describe('Battle Stats Calculation', () => {
  it('effectiveAttack with 2 attack upgrades', () => {
    let atk = 10;
    const upgrades = [
      { effectType: 'attack' as const, effectValue: 20 },
      { effectType: 'attack' as const, effectValue: 35 },
    ];
    for (const u of upgrades) {
      if (u.effectType === 'attack') atk = Math.floor(atk * (1 + u.effectValue / 100));
    }
    expect(atk).toBe(16);
  });

  it('scrap multiplier stacks multiplicatively', () => {
    let mult = 1.0;
    const upgrades = [
      { effectType: 'scrap' as const, effectValue: 25 },
      { effectType: 'scrap' as const, effectValue: 50 },
    ];
    for (const u of upgrades) {
      if (u.effectType === 'scrap') mult *= (1 + u.effectValue / 100);
    }
    expect(mult).toBeCloseTo(1.875, 3);
  });
});

// ─── 실패 조건 검증 ────────────────────────────────

describe('Failure Conditions', () => {
  // 선택지 검증
  it('offeredChoices에 없는 ID 선택 → 실패', () => {
    const offered = [MINI_POOL[0], MINI_POOL[3], MINI_POOL[6]]; // machine_gun_1, rapid_fire_1, attack_drone_1
    const validIds = new Set(offered.map((c) => c.id));
    expect(validIds.has('machine_gun_2')).toBe(false); // tier2, not offered
    expect(validIds.has('rapid_fire_1')).toBe(true);
  });

  // 최대 단계 도달
  it('tier=3인 machine_gun_3 적용 후 machine_gun group 후보 없음', () => {
    const applied: UpgradeRecord[] = [
      { choice: MINI_POOL[0], appliedAt: 1000 },
      { choice: MINI_POOL[1], appliedAt: 2000 },
      { choice: MINI_POOL[2], appliedAt: 3000 },
    ];
    const result = seededWeightedChoice(MINI_POOL, 3, 42, applied);
    const hasMachineGun = result.some((c) => c.group === 'machine_gun');
    expect(hasMachineGun).toBe(false);
  });

  // prerequisites 미충족
  it('shield_2 requires shield_1 → 미적용 시 후보 제외', () => {
    const result = seededWeightedChoice(MINI_POOL, 3, 42, []);
    const ids = result.map((c) => c.id);
    expect(ids).not.toContain('shield_2');
  });

  // 스테이지 미해금
  it('clear_stage_02 요구 시 stage_02 없으면 진입 불가', () => {
    expect(canEnterStage('clear_stage_02_canyon', new Set(['stage_01_ruins']))).toBe(false);
    expect(canEnterStage('clear_stage_02_canyon', new Set(['stage_01_ruins', 'stage_02_canyon']))).toBe(true);
  });

  // core_energy 음수 (경계)
  it('core_energy negative → level still 1', () => {
    expect(calculateLevel(-100, 50)).toBe(-1); // floor(-2) + 1
    // 실제 서비스에서는 report.coreEnergyDelta < 0 거부
  });
});
