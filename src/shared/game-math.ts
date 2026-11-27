// ─── 게임 밸런스 상수 ──────────────────────────────

export const GAME = {
  /** 기본 초당 전기 생산량 */
  BASE_ELECTRICITY_PER_SECOND: 1,
  /** 방치 보상 최대 적립 시간 (초) */
  MAX_IDLE_SECONDS: 8 * 60 * 60,
  /** 업그레이드 비용 배율 (cost = eps × UPGRADE_COST_MULTIPLIER) */
  UPGRADE_COST_MULTIPLIER: 50,
  /** 플레이어 전투력 환산 계수 (power = eps × COMBAT_POWER_PER_EPS) */
  COMBAT_POWER_PER_EPS: 10,
  /** 전투 기본 보상 배율 (baseReward = eps × BATTLE_REWARD_PER_EPS) */
  BATTLE_REWARD_PER_EPS: 30,
  /** 적 전투력 변동 비율 (0.2 = playerPower ±20%) */
  ENEMY_POWER_VARIANCE: 0.2,
  /** 전투 보상 최소 비율 (0.5 = 기본 보상의 50%) */
  BATTLE_REWARD_MIN_RATIO: 0.5,
  /** 전투 보상 최대 비율 (1.5 = 기본 보상의 150%) */
  BATTLE_REWARD_MAX_RATIO: 1.5,
} as const;

export interface ResearchBonus {
  /** 방치 생산량 증가 배율 (1.0 = 기본) */
  idleProdMultiplier: number;
  /** 최대 방치 시간 추가 (초) */
  extraMaxIdleSeconds: number;
  /** 방치 보상 증가 배율 (1.0 = 기본) */
  idleRewardMultiplier: number;
  /** 수집량(claim) 증가 배율 (1.0 = 기본) */
  claimBonusMultiplier: number;
  /** 업그레이드 비용 배율 (1.0 = 기본, 최소 UPGRADE_COST_MIN_MULTIPLIER) */
  upgradeCostMultiplier: number;
}

/** 업그레이드 비용 할인 하한 배율 */
export const UPGRADE_COST_MIN_MULTIPLIER = 0.2;

/** 연구 보너스 기본값 (효과 없음) */
export const DEFAULT_RESEARCH_BONUS: ResearchBonus = {
  idleProdMultiplier: 1.0,
  extraMaxIdleSeconds: 0,
  idleRewardMultiplier: 1.0,
  claimBonusMultiplier: 1.0,
  upgradeCostMultiplier: 1.0,
};

/**
 * 연구 진행도로 ResearchBonus 계산
 *
 * 앞의 3개 인자만 넘기면 기존 결과와 동일하다.
 */
export function calcResearchBonus(
  prodPassiveLevel: number,  // 방치 최적화 레벨
  prodCapLevel: number,      // 저장 용량 확장 레벨
  idleRewardLevel: number,   // 방치 보상 강화 레벨
  prodEff1Level = 0,         // prod_eff_1 (+10%/lv)
  prodEff2Level = 0,         // prod_eff_2 (+15%/lv)
  utilClaimBonusLevel = 0,   // util_claim_bonus (+10%/lv)
  econDiscount1Level = 0,    // econ_upgrade_discount_1 (-5%/lv)
  econDiscount2Level = 0,    // econ_upgrade_discount_2 (-8%/lv)
): ResearchBonus {
  const discount = 1.0 - econDiscount1Level * 0.05 - econDiscount2Level * 0.08;
  return {
    idleProdMultiplier: 1.0 + prodPassiveLevel * 0.2 + prodEff1Level * 0.1 + prodEff2Level * 0.15,
    extraMaxIdleSeconds: prodCapLevel * 2 * 3600,
    idleRewardMultiplier: 1.0 + idleRewardLevel * 0.15,
    claimBonusMultiplier: 1.0 + utilClaimBonusLevel * 0.1,
    // 부동소수 오차로 floor 결과가 1 낮아지지 않도록 소수 4자리로 정규화
    upgradeCostMultiplier: Math.max(UPGRADE_COST_MIN_MULTIPLIER, Math.round(discount * 10000) / 10000),
  };
}

/** EPS 업그레이드 비용 (연구 할인 반영) */
export function calcUpgradeCost(eps: number, researchBonus: ResearchBonus = DEFAULT_RESEARCH_BONUS): number {
  return Math.max(1, Math.floor(eps * GAME.UPGRADE_COST_MULTIPLIER * researchBonus.upgradeCostMultiplier));
}

// ─── 생산량 계산 유틸 ──────────────────────────────

export function calculateProduction(
  lastClaimedAt: string,
  electricityPerSecond: number,
  researchBonus: ResearchBonus = DEFAULT_RESEARCH_BONUS,
): { elapsed: number; produced: number; maxCapped: boolean } {
  const now = Date.now();
  const last = new Date(lastClaimedAt).getTime();
  const maxIdle = GAME.MAX_IDLE_SECONDS + researchBonus.extraMaxIdleSeconds;
  const raw = Math.max(0, Math.floor((now - last) / 1000));
  const elapsed = Math.min(raw, maxIdle);

  const baseProduced = elapsed * electricityPerSecond;
  const produced = Math.floor(
    baseProduced * researchBonus.idleProdMultiplier * researchBonus.idleRewardMultiplier * researchBonus.claimBonusMultiplier,
  );

  return {
    elapsed,
    produced,
    maxCapped: raw > maxIdle,
  };
}
