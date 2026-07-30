/**
 * 연구(Research) 노드 데이터 — 20개
 *
 * 각 노드는 code 기반 식별. DB에는 code와 level로 저장.
 * 선행 연구: prerequisites.code + 해당 연구의 level 조건.
 */
export interface ResearchNodeData {
  code: string;
  name: string;
  description: string;
  category: 'production' | 'combat' | 'economy' | 'utility' | 'special';
  maxLevel: number;
  /** 각 레벨별 비용 { electricity, scrap, ... } */
  costPerLevel: (level: number) => { electricity?: number; scrap?: number };
  /** 각 레벨별 효과 요약 */
  effectPerLevel: (level: number) => string;
  /** 선행 연구: [{ code: string; level: number }] */
  prerequisites: { code: string; level: number }[];
  /** 트리 내 위치 (UI 표시용) */
  gridPos: { row: number; col: number };
}

// ─── 카테고리 1: 생산 (Production) ─────────────────

const PRODUCTION: ResearchNodeData[] = [
  {
    code: 'prod_eff_1',
    name: '전기 효율 I',
    description: '기본 전기 생산량이 증가한다.',
    category: 'production', maxLevel: 5,
    costPerLevel: (l) => ({ electricity: 100 * l }),
    effectPerLevel: (l) => `생산량 +${l * 10}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 0 },
  },
  {
    code: 'prod_eff_2',
    name: '전기 효율 II',
    description: '전기 생산 효율을 추가로 향상시킨다.',
    category: 'production', maxLevel: 5,
    costPerLevel: (l) => ({ electricity: 500 * l }),
    effectPerLevel: (l) => `생산량 +${l * 15}%`,
    prerequisites: [{ code: 'prod_eff_1', level: 3 }],
    gridPos: { row: 0, col: 1 },
  },
  {
    code: 'prod_passive',
    name: '방치 최적화',
    description: '오프라인 상태에서도 더 많은 전기를 생산한다.',
    category: 'production', maxLevel: 3,
    costPerLevel: (l) => ({ electricity: 300 * l }),
    effectPerLevel: (l) => `방치 생산량 +${l * 20}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 2 },
  },
  {
    code: 'prod_cap',
    name: '저장 용량 확장',
    description: '최대 방치 적립 시간이 늘어난다.',
    category: 'production', maxLevel: 3,
    costPerLevel: (l) => ({ electricity: 200 * l }),
    effectPerLevel: (l) => `최대 방치 +${l * 2}시간`,
    prerequisites: [{ code: 'prod_passive', level: 1 }],
    gridPos: { row: 1, col: 2 },
  },
];

// ─── 카테고리 2: 전투 (Combat) ─────────────────────

const COMBAT: ResearchNodeData[] = [
  {
    code: 'combat_atk_1',
    name: '공격 강화 I',
    description: '메카의 기본 공격력을 높인다.',
    category: 'combat', maxLevel: 5,
    costPerLevel: (l) => ({ scrap: 10 * l }),
    effectPerLevel: (l) => `공격력 +${l * 8}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 0 },
  },
  {
    code: 'combat_atk_2',
    name: '공격 강화 II',
    description: '공격력을 대폭 증가시킨다.',
    category: 'combat', maxLevel: 5,
    costPerLevel: (l) => ({ scrap: 50 * l }),
    effectPerLevel: (l) => `공격력 +${l * 12}%`,
    prerequisites: [{ code: 'combat_atk_1', level: 3 }],
    gridPos: { row: 0, col: 1 },
  },
  {
    code: 'combat_hp_1',
    name: '장갑 강화 I',
    description: '메카의 최대 체력을 늘린다.',
    category: 'combat', maxLevel: 5,
    costPerLevel: (l) => ({ scrap: 10 * l }),
    effectPerLevel: (l) => `최대 체력 +${l * 10}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 2 },
  },
  {
    code: 'combat_hp_2',
    name: '장갑 강화 II',
    description: '장갑을 추가로 강화한다.',
    category: 'combat', maxLevel: 5,
    costPerLevel: (l) => ({ scrap: 50 * l }),
    effectPerLevel: (l) => `최대 체력 +${l * 15}%`,
    prerequisites: [{ code: 'combat_hp_1', level: 3 }],
    gridPos: { row: 0, col: 3 },
  },
  {
    code: 'combat_speed',
    name: '기동력 향상',
    description: '메카의 이동 속도와 대시 쿨다운을 개선한다.',
    category: 'combat', maxLevel: 3,
    costPerLevel: (l) => ({ scrap: 30 * l }),
    effectPerLevel: (l) => `이동속도 +${l * 8}%, 대시쿨다운 -${l * 5}%`,
    prerequisites: [{ code: 'combat_atk_1', level: 2 }],
    gridPos: { row: 1, col: 0 },
  },
  {
    code: 'combat_ult',
    name: '궁극기 충전',
    description: '궁극기 충전 속도를 높인다.',
    category: 'combat', maxLevel: 3,
    costPerLevel: (l) => ({ scrap: 40 * l }),
    effectPerLevel: (l) => `궁극기 충전속도 +${l * 10}%`,
    prerequisites: [{ code: 'combat_hp_1', level: 2 }],
    gridPos: { row: 1, col: 3 },
  },
];

// ─── 카테고리 3: 경제 (Economy) ────────────────────

const ECONOMY: ResearchNodeData[] = [
  {
    code: 'econ_upgrade_discount_1',
    name: '업그레이드 할인 I',
    description: 'EPS 업그레이드 비용이 감소한다.',
    category: 'economy', maxLevel: 3,
    costPerLevel: (l) => ({ electricity: 200 * l }),
    effectPerLevel: (l) => `업그레이드 비용 -${l * 5}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 0 },
  },
  {
    code: 'econ_upgrade_discount_2',
    name: '업그레이드 할인 II',
    description: '업그레이드 비용을 추가로 할인받는다.',
    category: 'economy', maxLevel: 3,
    costPerLevel: (l) => ({ electricity: 800 * l }),
    effectPerLevel: (l) => `업그레이드 비용 -${l * 8}%`,
    prerequisites: [{ code: 'econ_upgrade_discount_1', level: 2 }],
    gridPos: { row: 0, col: 1 },
  },
  {
    code: 'econ_battle_reward',
    name: '전투 보상 증대',
    description: '전투 승리 시 획득하는 전기 보상이 증가한다.',
    category: 'economy', maxLevel: 3,
    costPerLevel: (l) => ({ scrap: 20 * l }),
    effectPerLevel: (l) => `전투 보상 +${l * 15}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 2 },
  },
  {
    code: 'econ_scrap',
    name: '스크랩 수집',
    description: '처치당 획득하는 스크랩이 증가한다.',
    category: 'economy', maxLevel: 3,
    costPerLevel: (l) => ({ scrap: 15 * l }),
    effectPerLevel: (l) => `처치당 스크랩 +${l * 1}`,
    prerequisites: [{ code: 'econ_battle_reward', level: 1 }],
    gridPos: { row: 1, col: 2 },
  },
];

// ─── 카테고리 4: 유틸리티 (Utility) ────────────────

const UTILITY: ResearchNodeData[] = [
  {
    code: 'util_research_speed',
    name: '연구 가속',
    description: '모든 연구 속도가 빨라진다.',
    category: 'utility', maxLevel: 3,
    costPerLevel: (l) => ({ electricity: 300 * l, scrap: 10 * l }),
    effectPerLevel: (l) => `연구 속도 +${l * 15}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 0 },
  },
  {
    code: 'util_claim_bonus',
    name: '수집 보너스',
    description: '전기 수집(claim) 시 추가 보너스를 받는다.',
    category: 'utility', maxLevel: 3,
    costPerLevel: (l) => ({ electricity: 150 * l }),
    effectPerLevel: (l) => `수집량 +${l * 10}%`,
    prerequisites: [],
    gridPos: { row: 0, col: 1 },
  },
  {
    code: 'util_idle_reward',
    name: '방치 보상 강화',
    description: '오프라인 방치 보상이 증가한다.',
    category: 'utility', maxLevel: 3,
    costPerLevel: (l) => ({ electricity: 250 * l }),
    effectPerLevel: (l) => `방치 보상 +${l * 15}%`,
    prerequisites: [{ code: 'util_claim_bonus', level: 1 }],
    gridPos: { row: 1, col: 1 },
  },
];

// ─── 카테고리 5: 특수 (Special) ────────────────────

const SPECIAL: ResearchNodeData[] = [
  {
    code: 'spc_overflow',
    name: '오버플로우',
    description: '최대치를 초과한 전기를 보너스로 전환한다.',
    category: 'special', maxLevel: 1,
    costPerLevel: () => ({ electricity: 2000, scrap: 100 }),
    effectPerLevel: () => '초과 전기 10% → 보너스',
    prerequisites: [{ code: 'prod_eff_1', level: 5 }, { code: 'econ_upgrade_discount_1', level: 2 }],
    gridPos: { row: 2, col: 0 },
  },
  {
    code: 'spc_adrenaline',
    name: '아드레날린',
    description: '체력이 낮을수록 공격력이 증가한다.',
    category: 'special', maxLevel: 1,
    costPerLevel: () => ({ scrap: 200 }),
    effectPerLevel: () => '체력 50% 이하 → 공격력 +30%',
    prerequisites: [{ code: 'combat_atk_2', level: 3 }, { code: 'combat_hp_2', level: 2 }],
    gridPos: { row: 2, col: 1 },
  },
  {
    code: 'spc_rich_get_richer',
    name: '부익부',
    description: '보유 전기가 많을수록 생산량이 증가한다.',
    category: 'special', maxLevel: 1,
    costPerLevel: () => ({ electricity: 5000 }),
    effectPerLevel: () => '전기 1000당 생산량 +1% (최대 50%)',
    prerequisites: [{ code: 'prod_eff_2', level: 3 }, { code: 'econ_upgrade_discount_2', level: 2 }],
    gridPos: { row: 2, col: 2 },
  },
  {
    code: 'spc_last_stand',
    name: '라스트 스탠드',
    description: '치명타 시 체력이 소량 회복된다.',
    category: 'special', maxLevel: 1,
    costPerLevel: () => ({ scrap: 300 }),
    effectPerLevel: () => '치명타 시 체력 +3% 회복',
    prerequisites: [{ code: 'combat_ult', level: 2 }, { code: 'econ_scrap', level: 2 }],
    gridPos: { row: 2, col: 3 },
  },
];

// ─── 전체 목록 ─────────────────────────────────────

export const RESEARCH_TREE: ResearchNodeData[] = [
  ...PRODUCTION,
  ...COMBAT,
  ...ECONOMY,
  ...UTILITY,
  ...SPECIAL,
];

export function getResearchNode(code: string): ResearchNodeData | undefined {
  return RESEARCH_TREE.find((n) => n.code === code);
}

/** 전체 노드 수 = 4 + 6 + 4 + 3 + 4 = 21? 확인 */
