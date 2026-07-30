/**
 * 설계도(Blueprint) + 제작(Crafting) 데이터
 *
 * 모든 파츠(프레임3/무기6/코어3/모듈4)는 설계도를 통해 제작 가능.
 * 설계도는 전투 보상 등으로 획득하고, 스크랩+재료를 소비하여 제작.
 */

export interface BlueprintData {
  code: string;
  name: string;
  description: string;
  partCode: string;           // 제작 결과 파츠 코드
  partType: 'frame' | 'weapon' | 'core' | 'module';
  rarity: 'common' | 'uncommon' | 'rare';
  /** 제작에 필요한 재료: { partCode 또는 resourceCode: 개수 } */
  materials: Record<string, number>;
  /** 제작 소요 시간 (초) */
  craftSeconds: number;
  /** 드롭 가중치 (높을수록 잘 나옴) */
  dropWeight: number;
}

const COMMON_SCRAP = 5;
const UNCOMMON_SCRAP = 15;
const RARE_SCRAP = 40;

/** 파츠 등급별 기본 스크랩 + 시간 */
const RARITY_CRAFT = {
  common: { scrapCost: COMMON_SCRAP, seconds: 30 },
  uncommon: { scrapCost: UNCOMMON_SCRAP, seconds: 120 },
  rare: { scrapCost: RARE_SCRAP, seconds: 600 },
} as const;

// ─── 프레임 3종 ─────────────────────────────────────

const FRAME_BLUEPRINTS: BlueprintData[] = [
  {
    code: 'bp_light_frame', name: '경량 프레임 설계도',
    description: '경량 프레임을 제작할 수 있는 설계도.',
    partCode: 'light_frame', partType: 'frame', rarity: 'uncommon',
    materials: { scrap: UNCOMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.uncommon.seconds,
    dropWeight: 10,
  },
  {
    code: 'bp_medium_frame', name: '중형 프레임 설계도',
    description: '중형 프레임을 제작할 수 있는 설계도.',
    partCode: 'medium_frame', partType: 'frame', rarity: 'common',
    materials: { scrap: COMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.common.seconds,
    dropWeight: 15,
  },
  {
    code: 'bp_heavy_frame', name: '중량 프레임 설계도',
    description: '중량 프레임을 제작할 수 있는 설계도.',
    partCode: 'heavy_frame', partType: 'frame', rarity: 'rare',
    materials: { scrap: RARE_SCRAP, light_frame: 1 },
    craftSeconds: RARITY_CRAFT.rare.seconds,
    dropWeight: 5,
  },
];

// ─── 무기 6종 ──────────────────────────────────────

const WEAPON_BLUEPRINTS: BlueprintData[] = [
  {
    code: 'bp_machine_gun', name: '머신건 설계도',
    description: '머신건을 제작할 수 있는 설계도.',
    partCode: 'machine_gun', partType: 'weapon', rarity: 'common',
    materials: { scrap: COMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.common.seconds,
    dropWeight: 15,
  },
  {
    code: 'bp_shotgun', name: '샷건 설계도',
    description: '샷건을 제작할 수 있는 설계도.',
    partCode: 'shotgun', partType: 'weapon', rarity: 'uncommon',
    materials: { scrap: UNCOMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.uncommon.seconds,
    dropWeight: 10,
  },
  {
    code: 'bp_sniper_rifle', name: '저격소총 설계도',
    description: '저격소총을 제작할 수 있는 설계도.',
    partCode: 'sniper_rifle', partType: 'weapon', rarity: 'rare',
    materials: { scrap: RARE_SCRAP, machine_gun: 1 },
    craftSeconds: RARITY_CRAFT.rare.seconds,
    dropWeight: 4,
  },
  {
    code: 'bp_laser_gun', name: '레이저건 설계도',
    description: '레이저건을 제작할 수 있는 설계도.',
    partCode: 'laser_gun', partType: 'weapon', rarity: 'uncommon',
    materials: { scrap: UNCOMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.uncommon.seconds,
    dropWeight: 10,
  },
  {
    code: 'bp_missile_launcher', name: '미사일 런처 설계도',
    description: '미사일 런처를 제작할 수 있는 설계도.',
    partCode: 'missile_launcher', partType: 'weapon', rarity: 'rare',
    materials: { scrap: RARE_SCRAP, shotgun: 1, laser_gun: 1 },
    craftSeconds: RARITY_CRAFT.rare.seconds,
    dropWeight: 3,
  },
  {
    code: 'bp_plasma_sword', name: '플라즈마 소드 설계도',
    description: '플라즈마 소드를 제작할 수 있는 설계도.',
    partCode: 'plasma_sword', partType: 'weapon', rarity: 'uncommon',
    materials: { scrap: UNCOMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.uncommon.seconds,
    dropWeight: 8,
  },
];

// ─── 코어 3종 ──────────────────────────────────────

const CORE_BLUEPRINTS: BlueprintData[] = [
  {
    code: 'bp_assault_core', name: '돌격 코어 설계도',
    description: '돌격 코어를 제작할 수 있는 설계도.',
    partCode: 'assault_core', partType: 'core', rarity: 'uncommon',
    materials: { scrap: UNCOMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.uncommon.seconds,
    dropWeight: 10,
  },
  {
    code: 'bp_defense_core', name: '방어 코어 설계도',
    description: '방어 코어를 제작할 수 있는 설계도.',
    partCode: 'defense_core', partType: 'core', rarity: 'common',
    materials: { scrap: COMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.common.seconds,
    dropWeight: 12,
  },
  {
    code: 'bp_speed_core', name: '속도 코어 설계도',
    description: '속도 코어를 제작할 수 있는 설계도.',
    partCode: 'speed_core', partType: 'core', rarity: 'rare',
    materials: { scrap: RARE_SCRAP, assault_core: 1, defense_core: 1 },
    craftSeconds: RARITY_CRAFT.rare.seconds,
    dropWeight: 4,
  },
];

// ─── 모듈 4종 ──────────────────────────────────────

const MODULE_BLUEPRINTS: BlueprintData[] = [
  {
    code: 'bp_shield_module', name: '실드 모듈 설계도',
    description: '실드 모듈을 제작할 수 있는 설계도.',
    partCode: 'shield_module', partType: 'module', rarity: 'uncommon',
    materials: { scrap: UNCOMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.uncommon.seconds,
    dropWeight: 10,
  },
  {
    code: 'bp_regen_module', name: '재생 모듈 설계도',
    description: '재생 모듈을 제작할 수 있는 설계도.',
    partCode: 'regen_module', partType: 'module', rarity: 'rare',
    materials: { scrap: RARE_SCRAP, shield_module: 1 },
    craftSeconds: RARITY_CRAFT.rare.seconds,
    dropWeight: 4,
  },
  {
    code: 'bp_power_module', name: '파워 모듈 설계도',
    description: '파워 모듈을 제작할 수 있는 설계도.',
    partCode: 'power_module', partType: 'module', rarity: 'common',
    materials: { scrap: COMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.common.seconds,
    dropWeight: 12,
  },
  {
    code: 'bp_scanner_module', name: '스캐너 모듈 설계도',
    description: '스캐너 모듈을 제작할 수 있는 설계도.',
    partCode: 'scanner_module', partType: 'module', rarity: 'uncommon',
    materials: { scrap: UNCOMMON_SCRAP },
    craftSeconds: RARITY_CRAFT.uncommon.seconds,
    dropWeight: 8,
  },
];

// ─── 전체 목록 ─────────────────────────────────────

export const BLUEPRINTS: BlueprintData[] = [
  ...FRAME_BLUEPRINTS,
  ...WEAPON_BLUEPRINTS,
  ...CORE_BLUEPRINTS,
  ...MODULE_BLUEPRINTS,
];

export function getBlueprint(code: string): BlueprintData | undefined {
  return BLUEPRINTS.find((b) => b.code === code);
}

export function getBlueprintByPartCode(partCode: string): BlueprintData | undefined {
  return BLUEPRINTS.find((b) => b.partCode === partCode);
}

/** 드롭 가중치 기반 랜덤 설계도 선택 */
export function randomBlueprintByDropWeight(rarity?: 'common' | 'uncommon' | 'rare'): BlueprintData {
  const pool = rarity ? BLUEPRINTS.filter((b) => b.rarity === rarity) : BLUEPRINTS;
  const totalWeight = pool.reduce((s, b) => s + b.dropWeight, 0);
  let roll = Math.random() * totalWeight;
  for (const bp of pool) {
    roll -= bp.dropWeight;
    if (roll <= 0) return bp;
  }
  return pool[pool.length - 1];
}
