/**
 * 스테이지 + 보스 데이터 — 4개 스테이지, 각 스테이지별 보스
 *
 * stage_01_ruins  (3분)  → 중간보스 1체
 * stage_02_factory (3분) → 중간보스 2체
 * stage_03_lab    (6분)  → 중간보스 2체 + 준최종보스
 * stage_04_core   (6분)  → 중간보스 3체 + 최종보스
 */

// ─── 보스 데이터 ─────────────────────────────────────

export interface BossData {
  code: string;
  name: string;
  description: string;
  hp: number;
  attackPower: number;
  attackSpeed: number;       // ms
  moveSpeed: number;
  /** 특수 패턴 (설명) */
  patterns: string[];
  /** 처치 보너스 scrap */
  scrapBonus: number;
}

export const BOSSES: Record<string, BossData> = {
  // stage_01 보스
  boss_ruins_guardian: {
    code: 'boss_ruins_guardian', name: '폐허의 수호자',
    description: '오래된 폐허를 지키는 거석 골렘. 느리지만 강력한 한 방이 특징이다.',
    hp: 500, attackPower: 15, attackSpeed: 2000, moveSpeed: 30,
    patterns: ['돌진: 직선 범위 공격', '지진: 주변 광역 데미지'],
    scrapBonus: 10,
  },
  // stage_02 보스
  boss_factory_foreman: {
    code: 'boss_factory_foreman', name: '공장 관리자',
    description: '버려진 공장을 관리하는 결함 로봇. 빠른 연사 공격이 위협적이다.',
    hp: 800, attackPower: 12, attackSpeed: 800, moveSpeed: 50,
    patterns: ['연사: 3연속 발사', '자폭 드론 소환: 2체'],
    scrapBonus: 15,
  },
  boss_factory_assembly: {
    code: 'boss_factory_assembly', name: '조립 라인',
    description: '끊임없이 적을 생산하는 컨베이어 벨트. 본체 처치가 우선이다.',
    hp: 600, attackPower: 8, attackSpeed: 1500, moveSpeed: 0,
    patterns: ['적 생산: 5초마다 일반 적 소환', '벨트 가속: 생산 주기 단축'],
    scrapBonus: 12,
  },
  // stage_03 보스
  boss_lab_mutant: {
    code: 'boss_lab_mutant', name: '돌연변이체',
    description: '실험체 도망자. 예측 불가능한 움직임으로 회피가 어렵다.',
    hp: 1200, attackPower: 18, attackSpeed: 600, moveSpeed: 80,
    patterns: ['순간이동: 무작위 위치 이동', '독액 투척: 지속 데미지 영역'],
    scrapBonus: 20,
  },
  boss_lab_defender: {
    code: 'boss_lab_defender', name: '연구소 방어 시스템',
    description: '최종 관문을 지키는 자동화 방어망. 강력한 레이저 공격을 퍼붓는다.',
    hp: 1500, attackPower: 25, attackSpeed: 1200, moveSpeed: 40,
    patterns: ['레이저: 직선 관통 공격', '방어막: 일정 시간 무적', '포탑 소환: 2기'],
    scrapBonus: 25,
  },
  // stage_04 보스
  boss_core_sentinel: {
    code: 'boss_core_sentinel', name: '코어 센티넬',
    description: '중앙 코어를 수호하는 정예 경비병. 모든 공격이 정확하다.',
    hp: 2000, attackPower: 30, attackSpeed: 900, moveSpeed: 60,
    patterns: ['조준 사격: 확정 명중', '전자기 펄스: 주변 기절'],
    scrapBonus: 30,
  },
  boss_core_overlord: {
    code: 'boss_core_overlord', name: '오버로드',
    description: '코어를 장악한 AI의 분신. 끝없이 증식하는 위협이다.',
    hp: 2500, attackPower: 22, attackSpeed: 700, moveSpeed: 70,
    patterns: ['분열: 체력 50% 이하 시 2체로 분열', '에너지 흡수: 주변 적 체력 회복'],
    scrapBonus: 35,
  },
  /** ★ 최종 보스 */
  boss_final_overmind: {
    code: 'boss_final_overmind', name: '오버마인드',
    description: '모든 것을 통제하는 최종 AI. 모든 패턴을 총동원한다.',
    hp: 4000, attackPower: 40, attackSpeed: 500, moveSpeed: 90,
    patterns: ['전체 공격: 맵 전체 데미지', '차원 왜곡: 순간이동+텔레포트',
              '코어 폭발: 체력 30% 이하 전멸급 공격', 'AI 회복: 주기적 체력 회복 5%'],
    scrapBonus: 100,
  },
};

// ─── 스테이지 데이터 ─────────────────────────────────

export interface StageData {
  id: string;
  name: string;
  description: string;
  sequence: number;
  durationSeconds: number;     // 180(3분) or 360(6분)
  recommendedPower: number;
  enemySet: string[];          // 일반 적 유형
  bossTimings: number[];       // 보스 등장 시간(초)
  bossCodes: string[];         // 등장 보스 코드 목록
  maxKills: number;
  maxCoreEnergy: number;
  corePerLevel: number;
  corePerKill: number;
  scrapPerKill: number;
  entryRequirement: string;    // 선행 스테이지 ID
  contentVersion: string;
}

export const STAGES: StageData[] = [
  {
    id: 'stage_01_ruins',
    name: '폐허',
    description: '한때 문명이 번성했던 도시의 폐허. 약한 적들이 출몰한다.',
    sequence: 1,
    durationSeconds: 180,        // 3분
    recommendedPower: 10,
    enemySet: ['좀비', '슬라임', '고블린'],
    bossTimings: [120],          // 2분
    bossCodes: ['boss_ruins_guardian'],
    maxKills: 300,
    maxCoreEnergy: 300,
    corePerLevel: 50,
    corePerKill: 5,
    scrapPerKill: 1,
    entryRequirement: 'none',
    contentVersion: '1.0.0',
  },
  {
    id: 'stage_02_factory',
    name: '공장',
    description: '자동화 설비가 여전히 가동 중인 공장. 기계형 적이 주를 이룬다.',
    sequence: 2,
    durationSeconds: 180,        // 3분
    recommendedPower: 30,
    enemySet: ['드론', '경비로봇', '컨베이어'],
    bossTimings: [90, 150],      // 1분 30초, 2분 30초
    bossCodes: ['boss_factory_foreman', 'boss_factory_assembly'],
    maxKills: 400,
    maxCoreEnergy: 400,
    corePerLevel: 60,
    corePerKill: 6,
    scrapPerKill: 2,
    entryRequirement: 'stage_01_ruins',
    contentVersion: '1.0.0',
  },
  {
    id: 'stage_03_lab',
    name: '연구소',
    description: '금단의 실험이 자행되던 비밀 연구소. 돌연변이와 방어 시스템이 기다린다.',
    sequence: 3,
    durationSeconds: 360,        // 6분
    recommendedPower: 60,
    enemySet: ['돌연변이', '실험체', '방어드론'],
    bossTimings: [120, 240, 300], // 2분, 4분, 5분
    bossCodes: ['boss_lab_mutant', 'boss_lab_defender'],
    maxKills: 500,
    maxCoreEnergy: 500,
    corePerLevel: 70,
    corePerKill: 7,
    scrapPerKill: 3,
    entryRequirement: 'stage_02_factory',
    contentVersion: '1.0.0',
  },
  {
    id: 'stage_04_core',
    name: '코어',
    description: '모든 것의 중심, AI 코어. 최종 보스 오버마인드가 기다리고 있다.',
    sequence: 4,
    durationSeconds: 360,        // 6분
    recommendedPower: 100,
    enemySet: ['엘리트 경비병', 'AI 병사', '차원 왜곡체'],
    bossTimings: [90, 180, 270, 330], // 1분30초, 3분, 4분30초, 5분30초
    bossCodes: ['boss_core_sentinel', 'boss_core_overlord', 'boss_final_overmind'],
    maxKills: 600,
    maxCoreEnergy: 600,
    corePerLevel: 80,
    corePerKill: 8,
    scrapPerKill: 4,
    entryRequirement: 'stage_03_lab',
    contentVersion: '1.0.0',
  },
];

// ─── 헬퍼 ──────────────────────────────────────────

export function getStage(id: string): StageData | undefined {
  return STAGES.find((s) => s.id === id);
}

export function getBoss(code: string): BossData | undefined {
  return BOSSES[code];
}

export function getStageBosses(stageId: string): BossData[] {
  const stage = getStage(stageId);
  if (!stage) return [];
  return stage.bossCodes.map((c) => BOSSES[c]).filter(Boolean);
}

/** 다음 스테이지 ID 반환 (없으면 undefined) */
export function getNextStageId(currentStageId: string): string | undefined {
  const current = STAGES.find((s) => s.id === currentStageId);
  if (!current) return undefined;
  const next = STAGES.find((s) => s.sequence === current.sequence + 1);
  return next?.id;
}
