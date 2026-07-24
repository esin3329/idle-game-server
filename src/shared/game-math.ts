// ─── 게임 밸런스 상수 ──────────────────────────────

export const GAME = {
  /** 기본 초당 전기 생산량 */
  BASE_ELECTRICITY_PER_SECOND: 1,
  /** 방치 보상 최대 적립 시간 (초) */
  MAX_IDLE_SECONDS: 8 * 60 * 60,
  /** 업그레이드 비용 배율 (cost = eps × UPGRADE_COST_MULTIPLIER) */
  UPGRADE_COST_MULTIPLIER: 50,
  /** 전투력 배율 (power = eps × BATTLE_POWER_MULTIPLIER) */
  BATTLE_POWER_MULTIPLIER: 10,
  /** 전투 기본 보상 배율 (baseReward = eps × BATTLE_REWARD_MULTIPLIER) */
  BATTLE_REWARD_MULTIPLIER: 30,
  /** 적 전투력 변동폭 (20% = 0.2) */
  BATTLE_ENEMY_VARIANCE: 0.2,
} as const;

// ─── 생산량 계산 유틸 ──────────────────────────────

export function calculateProduction(
  lastClaimedAt: string,
  electricityPerSecond: number,
): { elapsed: number; produced: number; maxCapped: boolean } {
  const now = Date.now();
  const last = new Date(lastClaimedAt).getTime();
  const maxIdle = GAME.MAX_IDLE_SECONDS;
  const raw = Math.max(0, Math.floor((now - last) / 1000));
  const elapsed = Math.min(raw, maxIdle);

  return {
    elapsed,
    produced: elapsed * electricityPerSecond,
    maxCapped: raw > maxIdle,
  };
}
