/**
 * 파츠 게임 밸런스 데이터
 *
 * 모든 파츠는 code 기반 식별. DB에는 code로 저장.
 * 서버 권위 데이터 — 클라이언트는 code만 참조.
 */

// ─── 프레임 3종 ─────────────────────────────────────

export interface FrameData {
  code: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare';
  stats: {
    maxHp: number;
    moveSpeed: number;       // 기본 100 기준
    attackPower: number;     // 기본 10 기준
    dashCooldown: number;    // ms
  };
}

export const FRAMES: FrameData[] = [
  {
    code: 'light_frame',
    name: '경량 프레임',
    description: '기동력을 극대화한 초경량 바디. 민첩한 회피와 빠른 이동이 가능하다.',
    rarity: 'uncommon',
    stats: { maxHp: 80, moveSpeed: 130, attackPower: 8, dashCooldown: 3500 },
  },
  {
    code: 'medium_frame',
    name: '중형 프레임',
    description: '균형 잡힌 범용 바디. 다양한 전투 환경에 적응할 수 있다.',
    rarity: 'common',
    stats: { maxHp: 100, moveSpeed: 100, attackPower: 10, dashCooldown: 5000 },
  },
  {
    code: 'heavy_frame',
    name: '중량 프레임',
    description: '강력한 장갑과 높은 생존력을 자랑하는 중장갑 바디.',
    rarity: 'rare',
    stats: { maxHp: 150, moveSpeed: 70, attackPower: 12, dashCooldown: 7000 },
  },
];

// ─── 무기 6종 ──────────────────────────────────────

export interface WeaponData {
  code: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare';
  stats: {
    attackPower: number;
    attackSpeed: number;     // ms 간격 (낮을수록 빠름)
    range: number;           // 1=근접, 2=중거리, 3=원거리
    projectileSpeed?: number; // 투사체 속도 (0=즉시)
    splashRadius?: number;    // 스플래시 범위 (0=없음)
  };
}

export const WEAPONS: WeaponData[] = [
  {
    code: 'machine_gun',
    name: '머신건',
    description: '빠른 연사력으로 적을 제압하는 기관총.',
    rarity: 'common',
    stats: { attackPower: 5, attackSpeed: 150, range: 2, projectileSpeed: 20 },
  },
  {
    code: 'shotgun',
    name: '샷건',
    description: '근거리 산탄 공격으로 다수의 적을 동시에 타격한다.',
    rarity: 'uncommon',
    stats: { attackPower: 15, attackSpeed: 800, range: 1, splashRadius: 3 },
  },
  {
    code: 'sniper_rifle',
    name: '저격소총',
    description: '긴 사거리와 강력한 집탄율로 단일 표적을 정밀 제거한다.',
    rarity: 'rare',
    stats: { attackPower: 35, attackSpeed: 1500, range: 3, projectileSpeed: 50 },
  },
  {
    code: 'laser_gun',
    name: '레이저건',
    description: '지속적인 레이저 빔으로 적을 녹이는 에너지 무기.',
    rarity: 'uncommon',
    stats: { attackPower: 10, attackSpeed: 300, range: 2, projectileSpeed: 0 },
  },
  {
    code: 'missile_launcher',
    name: '미사일 런처',
    description: '광역 폭발로 적 무리를 쓸어버리는 중화기.',
    rarity: 'rare',
    stats: { attackPower: 25, attackSpeed: 2000, range: 3, projectileSpeed: 15, splashRadius: 5 },
  },
  {
    code: 'plasma_sword',
    name: '플라즈마 소드',
    description: '근접 전용 초고출력 에너지 검. 단일 대상에 막대한 피해.',
    rarity: 'uncommon',
    stats: { attackPower: 40, attackSpeed: 1000, range: 1 },
  },
];

// ─── 코어 3종 ──────────────────────────────────────

export interface CoreData {
  code: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare';
  stats: {
    ultimatePower: number;    // 궁극기 위력 (기본 30 기준)
    ultimateCooldown: number; // 궁극기 쿨다운 ms (기본 30000 기준)
    attackPowerBonus: number; // 추가 공격력 (%)
    maxHpBonus: number;       // 추가 체력 (%)
  };
}

export const CORES: CoreData[] = [
  {
    code: 'assault_core',
    name: '돌격 코어',
    description: '공격력과 궁극기 위력을 극대화하는 공격형 코어.',
    rarity: 'uncommon',
    stats: { ultimatePower: 45, ultimateCooldown: 30000, attackPowerBonus: 20, maxHpBonus: 0 },
  },
  {
    code: 'defense_core',
    name: '방어 코어',
    description: '생존력과 안정성을 우선시하는 수비형 코어.',
    rarity: 'common',
    stats: { ultimatePower: 25, ultimateCooldown: 35000, attackPowerBonus: 0, maxHpBonus: 30 },
  },
  {
    code: 'speed_core',
    name: '속도 코어',
    description: '공격 속도와 궁극기 충전을 가속하는 기동형 코어.',
    rarity: 'rare',
    stats: { ultimatePower: 35, ultimateCooldown: 22000, attackPowerBonus: 10, maxHpBonus: 10 },
  },
];

// ─── 모듈 4종 ──────────────────────────────────────

export interface ModuleData {
  code: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare';
  stats: {
    shieldHp?: number;        // 실드량 (0=없음)
    hpRegenPerSec?: number;   // 초당 체력 회복 (0=없음)
    ultimateChargeSpeed?: number; // 궁극기 충전 속도 (%)
    detectRange?: number;     // 탐지 범위 (1=기본, 2=넓음)
    moveSpeedBonus?: number;  // 이동속도 추가 (%)
    attackSpeedBonus?: number; // 공격속도 추가 (%)
  };
}

export const MODULES: ModuleData[] = [
  {
    code: 'shield_module',
    name: '실드 모듈',
    description: '전투 시작 시 일정량의 보호막을 생성한다.',
    rarity: 'uncommon',
    stats: { shieldHp: 50 },
  },
  {
    code: 'regen_module',
    name: '재생 모듈',
    description: '시간에 따라 손상된 장갑을 자동 수복한다.',
    rarity: 'rare',
    stats: { hpRegenPerSec: 2 },
  },
  {
    code: 'power_module',
    name: '파워 모듈',
    description: '궁극기 충전 속도를 대폭 향상시킨다.',
    rarity: 'common',
    stats: { ultimateChargeSpeed: 25 },
  },
  {
    code: 'scanner_module',
    name: '스캐너 모듈',
    description: '적 탐지 범위를 넓혀 전장의 상황을 파악한다.',
    rarity: 'uncommon',
    stats: { detectRange: 2, moveSpeedBonus: 5 },
  },
];

// ─── 헬퍼 ──────────────────────────────────────────

export function getFrame(code: string): FrameData | undefined {
  return FRAMES.find((f) => f.code === code);
}

export function getWeapon(code: string): WeaponData | undefined {
  return WEAPONS.find((w) => w.code === code);
}

export function getCore(code: string): CoreData | undefined {
  return CORES.find((c) => c.code === code);
}

export function getModule(code: string): ModuleData | undefined {
  return MODULES.find((m) => m.code === code);
}

export const ALL_PARTS = {
  frames: FRAMES,
  weapons: WEAPONS,
  cores: CORES,
  modules: MODULES,
} as const;
