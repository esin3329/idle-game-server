/**
 * 전투 중 강화(Upgrade) 데이터 — 30개 선택지
 *
 * 5개 카테고리, 13개 진화 그룹, 최대 3티어.
 * 각 강화는 구체적인 스탯 효과를 가진다.
 */

// ─── 스탯 효과 타입 ────────────────────────────────

export interface UpgradeStatEffect {
  attackPower?: number;       // 공격력 (+n)
  attackSpeed?: number;       // 공격속도 ms (-n = 더 빠름)
  moveSpeed?: number;         // 이동속도 (+n%)
  maxHp?: number;             // 최대 체력 (+n)
  dashCooldown?: number;      // 대시 쿨다운 ms (-n)
  ultimatePower?: number;     // 궁극기 위력 (+n%)
  ultimateCooldown?: number;  // 궁극기 쿨다운 ms (-n)
  projectileSpeed?: number;   // 투사체 속도 (+n%)
  splashRadius?: number;      // 스플래시 범위 (+n)
  critRate?: number;          // 치명타 확률 (+n%)
  critDamage?: number;        // 치명타 데미지 (+n%)
  hpRegenPerSec?: number;     // 초당 체력 회복 (+n)
  shieldHp?: number;          // 보호막 (+n)
  duration?: number;          // 지속시간 (+n%)
  chainTargets?: number;      // 연쇄 대상 수 (+n)
  bombRadius?: number;        // 폭발 범위 (+n)
  healAmount?: number;        // 회복량 (+n)
}

export interface UpgradeData {
  id: string;
  name: string;
  description: string;
  group: string;               // 진화 그룹 코드
  tier: number;                // 1 | 2 | 3
  category: 'weapon' | 'armor' | 'drone' | 'utility' | 'special';
  weight: number;              // 선택 가중치 (높을수록 잘 나옴)
  /** 각 티어별 스탯 효과 (tier 1 기준, 상위 티어는 누적) */
  effects: UpgradeStatEffect;
  prerequisites?: string[];    // 선행 강화 ID (상위 티어 진화 조건)
}

// ═══════════════════════════════════════════════════════
// 무기 (Weapon) — 11개
// ═══════════════════════════════════════════════════════

const WEAPON_UPGRADES: UpgradeData[] = [
  {
    id: 'machine_gun_1', name: '기관총 강화 I', description: '기관총의 연사력이 향상된다.',
    group: 'machine_gun', tier: 1, category: 'weapon', weight: 10,
    effects: { attackSpeed: -20, attackPower: 2 },
  },
  {
    id: 'machine_gun_2', name: '기관총 강화 II', description: '기관총에 관통 효과가 추가된다.',
    group: 'machine_gun', tier: 2, category: 'weapon', weight: 6,
    effects: { attackSpeed: -30, attackPower: 3, projectileSpeed: 15 },
    prerequisites: ['machine_gun_1'],
  },
  {
    id: 'machine_gun_3', name: '기관총 강화 III', description: '기관총이 최종 형태로 각성한다.',
    group: 'machine_gun', tier: 3, category: 'weapon', weight: 3,
    effects: { attackSpeed: -40, attackPower: 5, critRate: 10 },
    prerequisites: ['machine_gun_2'],
  },
  {
    id: 'shotgun_1', name: '샷건 강화 I', description: '샷건의 산탄 범위가 넓어진다.',
    group: 'shotgun', tier: 1, category: 'weapon', weight: 8,
    effects: { splashRadius: 1, attackPower: 3 },
  },
  {
    id: 'shotgun_2', name: '샷건 강화 II', description: '샷건에 화염 효과가 추가된다.',
    group: 'shotgun', tier: 2, category: 'weapon', weight: 5,
    effects: { splashRadius: 2, attackPower: 5, attackSpeed: -100 },
    prerequisites: ['shotgun_1'],
  },
  {
    id: 'sniper_1', name: '저격소총 강화 I', description: '저격소총의 집탄율이 향상된다.',
    group: 'sniper', tier: 1, category: 'weapon', weight: 6,
    effects: { attackPower: 8, projectileSpeed: 20 },
  },
  {
    id: 'sniper_2', name: '저격소총 강화 II', description: '저격소총에 관통 효과가 추가된다.',
    group: 'sniper', tier: 2, category: 'weapon', weight: 3,
    effects: { attackPower: 12, critRate: 15, critDamage: 20 },
    prerequisites: ['sniper_1'],
  },
  {
    id: 'laser_1', name: '레이저 강화 I', description: '레이저 빔의 폭이 넓어진다.',
    group: 'laser', tier: 1, category: 'weapon', weight: 8,
    effects: { attackPower: 3, splashRadius: 1, duration: 15 },
  },
  {
    id: 'laser_2', name: '레이저 강화 II', description: '레이저에 화상 효과가 추가된다.',
    group: 'laser', tier: 2, category: 'weapon', weight: 5,
    effects: { attackPower: 5, attackSpeed: -50, duration: 20 },
    prerequisites: ['laser_1'],
  },
  {
    id: 'missile_1', name: '미사일 강화', description: '미사일의 폭발 범위가 넓어진다.',
    group: 'missile', tier: 1, category: 'weapon', weight: 5,
    effects: { splashRadius: 3, attackPower: 5 },
  },
  {
    id: 'plasma_1', name: '플라즈마 강화', description: '플라즈마 소드의 위력이 증가한다.',
    group: 'plasma', tier: 1, category: 'weapon', weight: 6,
    effects: { attackPower: 10, attackSpeed: -100 },
  },
];

// ═══════════════════════════════════════════════════════
// 방어 (Armor) — 3개
// ═══════════════════════════════════════════════════════

const ARMOR_UPGRADES: UpgradeData[] = [
  {
    id: 'armor_1', name: '장갑 강화 I', description: '메카의 장갑을 보강한다.',
    group: 'armor', tier: 1, category: 'armor', weight: 10,
    effects: { maxHp: 30 },
  },
  {
    id: 'armor_2', name: '장갑 강화 II', description: '추가 장갑판을 장착한다.',
    group: 'armor', tier: 2, category: 'armor', weight: 6,
    effects: { maxHp: 50, hpRegenPerSec: 1 },
    prerequisites: ['armor_1'],
  },
  {
    id: 'armor_3', name: '장갑 강화 III', description: '장갑이 최대치로 강화된다.',
    group: 'armor', tier: 3, category: 'armor', weight: 3,
    effects: { maxHp: 80, hpRegenPerSec: 2, shieldHp: 30 },
    prerequisites: ['armor_2'],
  },
];

// ═══════════════════════════════════════════════════════
// 드론 (Drone) — 2개
// ═══════════════════════════════════════════════════════

const DRONE_UPGRADES: UpgradeData[] = [
  {
    id: 'drone_1', name: '드론 강화 I', description: '지원 드론의 공격력이 증가한다.',
    group: 'drone', tier: 1, category: 'drone', weight: 8,
    effects: { attackPower: 4 },
  },
  {
    id: 'drone_2', name: '드론 강화 II', description: '드론의 공격 속도가 빨라진다.',
    group: 'drone', tier: 2, category: 'drone', weight: 5,
    effects: { attackPower: 6, attackSpeed: -30 },
    prerequisites: ['drone_1'],
  },
];

// ═══════════════════════════════════════════════════════
// 유틸리티 (Utility) — 14개
// ═══════════════════════════════════════════════════════

const UTILITY_UPGRADES: UpgradeData[] = [
  {
    id: 'speed_1', name: '이동 속도 I', description: '메카의 기동력이 향상된다.',
    group: 'speed', tier: 1, category: 'utility', weight: 8,
    effects: { moveSpeed: 10 },
  },
  {
    id: 'speed_2', name: '이동 속도 II', description: '메카가 더 빨라진다.',
    group: 'speed', tier: 2, category: 'utility', weight: 5,
    effects: { moveSpeed: 15, dashCooldown: -500 },
    prerequisites: ['speed_1'],
  },
  {
    id: 'reload_1', name: '재장전 I', description: '무기 재장전 시간이 단축된다.',
    group: 'reload', tier: 1, category: 'utility', weight: 8,
    effects: { attackSpeed: -30 },
  },
  {
    id: 'reload_2', name: '재장전 II', description: '재장전이 더 빨라진다.',
    group: 'reload', tier: 2, category: 'utility', weight: 5,
    effects: { attackSpeed: -50 },
    prerequisites: ['reload_1'],
  },
  {
    id: 'shield_1', name: '보호막 I', description: '전투 시작 시 보호막이 생성된다.',
    group: 'shield', tier: 1, category: 'utility', weight: 8,
    effects: { shieldHp: 30 },
  },
  {
    id: 'shield_2', name: '보호막 II', description: '보호막의 내구도가 증가한다.',
    group: 'shield', tier: 2, category: 'utility', weight: 5,
    effects: { shieldHp: 50 },
    prerequisites: ['shield_1'],
  },
  {
    id: 'regen_1', name: '자동 수복', description: '시간에 따라 체력이 회복된다.',
    group: 'regen', tier: 1, category: 'utility', weight: 6,
    effects: { hpRegenPerSec: 2 },
  },
  {
    id: 'crit_1', name: '치명타 I', description: '치명타 확률이 증가한다.',
    group: 'crit', tier: 1, category: 'utility', weight: 8,
    effects: { critRate: 8 },
  },
  {
    id: 'crit_2', name: '치명타 II', description: '치명타 데미지가 대폭 증가한다.',
    group: 'crit', tier: 2, category: 'utility', weight: 5,
    effects: { critRate: 12, critDamage: 30 },
    prerequisites: ['crit_1'],
  },
  {
    id: 'ulti_1', name: '궁극기 충전 I', description: '궁극기 충전 속도가 빨라진다.',
    group: 'ulti', tier: 1, category: 'utility', weight: 7,
    effects: { ultimateCooldown: -3000, ultimatePower: 10 },
  },
  {
    id: 'ulti_2', name: '궁극기 충전 II', description: '궁극기가 더 자주 발동된다.',
    group: 'ulti', tier: 2, category: 'utility', weight: 4,
    effects: { ultimateCooldown: -5000, ultimatePower: 20 },
    prerequisites: ['ulti_1'],
  },
  {
    id: 'dash_1', name: '대시 강화', description: '대시 쿨다운이 감소한다.',
    group: 'dash', tier: 1, category: 'utility', weight: 8,
    effects: { dashCooldown: -1000, moveSpeed: 5 },
  },
  {
    id: 'bomb_1', name: '폭발 강화', description: '처치 시 주변에 폭발이 발생한다.',
    group: 'bomb', tier: 1, category: 'special', weight: 5,
    effects: { bombRadius: 3, attackPower: 2 },
  },
  {
    id: 'chain_1', name: '연쇄 번개', description: '공격이 주변 적으로 연쇄된다.',
    group: 'chain', tier: 1, category: 'special', weight: 6,
    effects: { chainTargets: 2, attackPower: 2 },
  },
  {
    id: 'heal_1', name: '처치 회복', description: '적 처치 시 체력이 소량 회복된다.',
    group: 'heal', tier: 1, category: 'special', weight: 7,
    effects: { healAmount: 5 },
  },
];

// ═══════════════════════════════════════════════════════
// 전체 목록
// ═══════════════════════════════════════════════════════

export const ALL_UPGRADES: UpgradeData[] = [
  ...WEAPON_UPGRADES,
  ...ARMOR_UPGRADES,
  ...DRONE_UPGRADES,
  ...UTILITY_UPGRADES,
];

/** 13개 진화 그룹 */
export const UPGRADE_GROUPS = [
  { id: 'machine_gun', name: '기관총', tiers: 3, category: 'weapon' },
  { id: 'shotgun', name: '샷건', tiers: 2, category: 'weapon' },
  { id: 'sniper', name: '저격소총', tiers: 2, category: 'weapon' },
  { id: 'laser', name: '레이저', tiers: 2, category: 'weapon' },
  { id: 'missile', name: '미사일', tiers: 1, category: 'weapon' },
  { id: 'plasma', name: '플라즈마', tiers: 1, category: 'weapon' },
  { id: 'armor', name: '장갑', tiers: 3, category: 'armor' },
  { id: 'drone', name: '드론', tiers: 2, category: 'drone' },
  { id: 'speed', name: '이동 속도', tiers: 2, category: 'utility' },
  { id: 'reload', name: '재장전', tiers: 2, category: 'utility' },
  { id: 'shield', name: '보호막', tiers: 2, category: 'utility' },
  { id: 'crit', name: '치명타', tiers: 2, category: 'utility' },
  { id: 'ulti', name: '궁극기', tiers: 2, category: 'utility' },
];

export function getUpgrade(id: string): UpgradeData | undefined {
  return ALL_UPGRADES.find((u) => u.id === id);
}

export function getUpgradesByGroup(group: string): UpgradeData[] {
  return ALL_UPGRADES.filter((u) => u.group === group);
}
