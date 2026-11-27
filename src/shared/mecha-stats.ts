/**
 * 메카 전투 스탯 계산 (서버 권위)
 *
 * 장착 파츠 · 연구 · 전투 중 강화를 합산해 전투 스탯을 만든다.
 * 인벤토리에 실제로 보유한 장착 파츠만 반영하므로, 파츠가 없는 플레이어의
 * 스탯은 baseStats 그대로 유지된다.
 */
import { getFrame, getWeapon, getCore, getModule } from '../data/parts.js';
import { getUpgrade } from '../data/upgrades.js';
import type { UpgradeData, UpgradeStatEffect } from '../data/upgrades.js';
import type { EquipSlot, PlayerPart, PlayerResearch } from '../types.js';

// ─── 타입 ──────────────────────────────────────────

export interface MechaStatSnapshot {
  attackPower: number; attackSpeed: number; moveSpeed: number;
  dashCooldown: number; ultimatePower: number; ultimateCooldown: number;
  maxHp: number;
}

export interface EffectiveBattleStats extends MechaStatSnapshot {
  hpRegenPerSec: number; shieldHp: number;
  critRate: number; critDamage: number; healOnKill: number;
  projectileSpeed: number; splashRadius: number; duration: number;
  chainTargets: number; bombRadius: number;
}

export interface LoadoutPartSnapshot { code: string; level: number }

export interface LoadoutSnapshot {
  frame?: LoadoutPartSnapshot;
  weapon?: LoadoutPartSnapshot;
  core?: LoadoutPartSnapshot;
  module?: LoadoutPartSnapshot;
  /** 모듈이 제공하는 전투 보너스 (0이 아닌 값만 존재) */
  bonuses?: { shieldHp?: number; hpRegenPerSec?: number; ultimateChargeSpeed?: number };
}

export type ResearchSnapshot = Record<string, number>;

export interface BattleLoadoutStats {
  baseStats: MechaStatSnapshot;
  statSnapshot: MechaStatSnapshot;
  loadoutSnapshot: LoadoutSnapshot;
  researchSnapshot: ResearchSnapshot;
}

export interface UpgradeOfferLike {
  level: number;
  options: { slot: number; upgradeId: string }[];
}

export interface EnrichedUpgradeOption {
  slot: number; upgradeId: string; name: string; description: string;
  category: UpgradeData['category']; tier: number; group: string;
  effects: UpgradeStatEffect;
}

export interface EnrichedUpgradeChoice {
  level: number; options: EnrichedUpgradeOption[];
}

/** 신규 플레이어 기본 메카 스탯 */
export const DEFAULT_MECH_STATS: Readonly<MechaStatSnapshot> = {
  attackPower: 10, attackSpeed: 100, moveSpeed: 100,
  dashCooldown: 5000, ultimatePower: 30, ultimateCooldown: 30000, maxHp: 100,
};

// ─── 밸런스 상수 ───────────────────────────────────

/** 파츠 레벨당 긍정 스탯 증가율 */
const PART_LEVEL_POSITIVE = 0.1;
/** 프레임/코어 쿨다운 레벨당 단축 계수 */
const PART_LEVEL_COOLDOWN = 0.05;
/** 무기 레벨당 공격 간격 단축 (ms) */
const WEAPON_LEVEL_SPEEDUP_MS = 5;
/** 이 값보다 빠른 무기만 공격 간격 보너스 (ms 기준선) */
const WEAPON_SPEED_BONUS_BASELINE_MS = 1000;
const WEAPON_SPEED_BONUS_DIVISOR_MS = 100;

export const MIN_ATTACK_SPEED_MS = 80;
export const MIN_DASH_COOLDOWN_MS = 250;
export const MIN_ULTIMATE_COOLDOWN_MS = 3000;
const MIN_RESEARCH_DASH_COOLDOWN_MS = 500;
const MIN_RESEARCH_ULTIMATE_COOLDOWN_MS = 5000;

const RESEARCH_PER_LEVEL = {
  combat_atk_1: 0.08,
  combat_atk_2: 0.12,
  combat_hp_1: 0.10,
  combat_hp_2: 0.15,
  combat_speed_move: 0.08,
  combat_speed_dash: 0.05,
  combat_ult: 0.10,
} as const;

const ECON_BATTLE_REWARD_PCT_PER_LEVEL = 15;

function positiveMul(level: number): number {
  return 1 + (Math.max(1, level) - 1) * PART_LEVEL_POSITIVE;
}

function cooldownDiv(level: number): number {
  return 1 + (Math.max(1, level) - 1) * PART_LEVEL_COOLDOWN;
}

function ownedLevel(inventory: readonly PlayerPart[], code: string | undefined): number | null {
  if (!code) return null;
  let level: number | null = null;
  for (const part of inventory) {
    if (part.partCode === code) level = Math.max(level ?? 0, part.level || 1);
  }
  return level;
}

// ─── 로드아웃 스탯 ─────────────────────────────────

export function computeBattleLoadoutStats(
  baseStats: MechaStatSnapshot,
  equipped: Pick<EquipSlot, 'frame' | 'weapon' | 'core' | 'module'> | null | undefined,
  inventory: readonly PlayerPart[],
  researchList: readonly Pick<PlayerResearch, 'code' | 'level'>[],
): BattleLoadoutStats {
  const base: MechaStatSnapshot = { ...baseStats };
  let { attackPower, attackSpeed, moveSpeed, dashCooldown, ultimatePower, ultimateCooldown, maxHp } = base;
  const loadout: LoadoutSnapshot = {};
  let attackPowerPct = 0;
  let maxHpPct = 0;
  let moveSpeedPct = 0;
  let attackSpeedPct = 0;
  let ultimateChargePct = 0;
  let shieldHp = 0;
  let hpRegenPerSec = 0;

  // frame
  const frameLv = ownedLevel(inventory, equipped?.frame);
  const frame = frameLv !== null ? getFrame(equipped!.frame) : undefined;
  if (frame && frameLv !== null) {
    const mul = positiveMul(frameLv);
    maxHp = frame.stats.maxHp * mul;
    moveSpeed = frame.stats.moveSpeed * mul;
    attackPower = frame.stats.attackPower * mul;
    dashCooldown = frame.stats.dashCooldown / cooldownDiv(frameLv);
    loadout.frame = { code: frame.code, level: frameLv };
  }

  // weapon: 공격력 가산, 공격 간격은 baseStats 기준으로 소폭 단축
  const weaponLv = ownedLevel(inventory, equipped?.weapon);
  const weapon = weaponLv !== null ? getWeapon(equipped!.weapon) : undefined;
  if (weapon && weaponLv !== null) {
    attackPower += weapon.stats.attackPower * positiveMul(weaponLv);
    const traitBonus = Math.round(Math.max(0, WEAPON_SPEED_BONUS_BASELINE_MS - weapon.stats.attackSpeed) / WEAPON_SPEED_BONUS_DIVISOR_MS);
    attackSpeed = Math.max(MIN_ATTACK_SPEED_MS, attackSpeed - (weaponLv - 1) * WEAPON_LEVEL_SPEEDUP_MS - traitBonus);
    loadout.weapon = { code: weapon.code, level: weaponLv };
  }

  // core
  const coreLv = ownedLevel(inventory, equipped?.core);
  const core = coreLv !== null ? getCore(equipped!.core) : undefined;
  if (core && coreLv !== null) {
    const mul = positiveMul(coreLv);
    attackPowerPct += core.stats.attackPowerBonus * mul;
    maxHpPct += core.stats.maxHpBonus * mul;
    ultimatePower = core.stats.ultimatePower * mul;
    ultimateCooldown = core.stats.ultimateCooldown / cooldownDiv(coreLv);
    loadout.core = { code: core.code, level: coreLv };
  }

  // module
  const moduleLv = ownedLevel(inventory, equipped?.module);
  const mod = moduleLv !== null ? getModule(equipped!.module) : undefined;
  if (mod && moduleLv !== null) {
    const mul = positiveMul(moduleLv);
    shieldHp = Math.round((mod.stats.shieldHp ?? 0) * mul);
    hpRegenPerSec = Math.round((mod.stats.hpRegenPerSec ?? 0) * mul * 100) / 100;
    ultimateChargePct = (mod.stats.ultimateChargeSpeed ?? 0) * mul;
    moveSpeedPct += (mod.stats.moveSpeedBonus ?? 0) * mul;
    attackSpeedPct += (mod.stats.attackSpeedBonus ?? 0) * mul;
    loadout.module = { code: mod.code, level: moduleLv };
    const bonuses: NonNullable<LoadoutSnapshot['bonuses']> = {};
    if (shieldHp) bonuses.shieldHp = shieldHp;
    if (hpRegenPerSec) bonuses.hpRegenPerSec = hpRegenPerSec;
    if (ultimateChargePct) bonuses.ultimateChargeSpeed = ultimateChargePct;
    if (Object.keys(bonuses).length > 0) loadout.bonuses = bonuses;
  }

  // research
  const researchSnapshot: ResearchSnapshot = {};
  for (const r of researchList) {
    if (r.level > 0) researchSnapshot[r.code] = r.level;
  }
  const lv = (code: string) => researchSnapshot[code] || 0;
  const R = RESEARCH_PER_LEVEL;
  attackPowerPct += (lv('combat_atk_1') * R.combat_atk_1 + lv('combat_atk_2') * R.combat_atk_2) * 100;
  maxHpPct += (lv('combat_hp_1') * R.combat_hp_1 + lv('combat_hp_2') * R.combat_hp_2) * 100;
  moveSpeedPct += lv('combat_speed') * R.combat_speed_move * 100;

  // 퍼센트 보너스 적용
  attackPower *= 1 + attackPowerPct / 100;
  maxHp *= 1 + maxHpPct / 100;
  moveSpeed *= 1 + moveSpeedPct / 100;
  if (attackSpeedPct > 0) attackSpeed = Math.max(MIN_ATTACK_SPEED_MS, attackSpeed / (1 + attackSpeedPct / 100));
  if (ultimateChargePct > 0) ultimateCooldown /= 1 + ultimateChargePct / 100;

  if (lv('combat_speed') > 0) {
    dashCooldown = Math.max(MIN_RESEARCH_DASH_COOLDOWN_MS, dashCooldown * (1 - lv('combat_speed') * R.combat_speed_dash));
  }
  if (lv('combat_ult') > 0) {
    // 충전 속도 +10%/lv: power_module과 동일하게 나눗셈으로 쿨다운 단축
    ultimateCooldown = Math.max(MIN_RESEARCH_ULTIMATE_COOLDOWN_MS, Math.round(ultimateCooldown / (1 + lv('combat_ult') * R.combat_ult)));
  }

  const statSnapshot: MechaStatSnapshot = {
    attackPower: Math.round(attackPower),
    attackSpeed: Math.round(attackSpeed),
    moveSpeed: Math.round(moveSpeed),
    dashCooldown: Math.round(dashCooldown),
    ultimatePower: Math.round(ultimatePower),
    ultimateCooldown: Math.round(ultimateCooldown),
    maxHp: Math.round(maxHp),
  };

  return { baseStats: base, statSnapshot, loadoutSnapshot: loadout, researchSnapshot };
}

// ─── 전투 중 강화 누적 ─────────────────────────────

export function applyBattleUpgrades(
  baseSnapshot: MechaStatSnapshot,
  upgradesApplied: readonly string[],
  loadoutSnapshot?: LoadoutSnapshot,
): EffectiveBattleStats {
  const sum: Required<Pick<UpgradeStatEffect,
    'attackPower' | 'attackSpeed' | 'moveSpeed' | 'maxHp' | 'dashCooldown' | 'ultimatePower' | 'ultimateCooldown' |
    'critRate' | 'critDamage' | 'hpRegenPerSec' | 'shieldHp' | 'healAmount' |
    'projectileSpeed' | 'splashRadius' | 'duration' | 'chainTargets' | 'bombRadius'>> = {
    attackPower: 0, attackSpeed: 0, moveSpeed: 0, maxHp: 0, dashCooldown: 0, ultimatePower: 0, ultimateCooldown: 0,
    critRate: 0, critDamage: 0, hpRegenPerSec: 0, shieldHp: 0, healAmount: 0,
    projectileSpeed: 0, splashRadius: 0, duration: 0, chainTargets: 0, bombRadius: 0,
  };
  for (const id of upgradesApplied) {
    const effects = getUpgrade(id)?.effects;
    if (!effects) continue;
    for (const key of Object.keys(sum) as (keyof typeof sum)[]) {
      sum[key] += effects[key] ?? 0;
    }
  }

  const bonuses = loadoutSnapshot?.bonuses;
  return {
    attackPower: Math.max(1, Math.round(baseSnapshot.attackPower + sum.attackPower)),
    attackSpeed: Math.max(MIN_ATTACK_SPEED_MS, Math.round(baseSnapshot.attackSpeed + sum.attackSpeed)),
    // moveSpeed / ultimatePower 강화는 +n% 효과
    moveSpeed: Math.round(baseSnapshot.moveSpeed * (1 + sum.moveSpeed / 100)),
    dashCooldown: Math.max(MIN_DASH_COOLDOWN_MS, Math.round(baseSnapshot.dashCooldown + sum.dashCooldown)),
    ultimatePower: Math.round(baseSnapshot.ultimatePower * (1 + sum.ultimatePower / 100)),
    ultimateCooldown: Math.max(MIN_ULTIMATE_COOLDOWN_MS, Math.round(baseSnapshot.ultimateCooldown + sum.ultimateCooldown)),
    maxHp: Math.max(1, Math.round(baseSnapshot.maxHp + sum.maxHp)),
    hpRegenPerSec: (bonuses?.hpRegenPerSec ?? 0) + sum.hpRegenPerSec,
    shieldHp: (bonuses?.shieldHp ?? 0) + sum.shieldHp,
    critRate: sum.critRate,
    critDamage: sum.critDamage,
    healOnKill: sum.healAmount,
    projectileSpeed: sum.projectileSpeed,
    splashRadius: sum.splashRadius,
    duration: sum.duration,
    chainTargets: sum.chainTargets,
    bombRadius: sum.bombRadius,
  };
}

// ─── 선택지 보강 ───────────────────────────────────

export function enrichUpgradeChoice(offer: UpgradeOfferLike): EnrichedUpgradeChoice {
  const options: EnrichedUpgradeOption[] = [];
  for (const option of offer.options) {
    const upgrade = getUpgrade(option.upgradeId);
    if (!upgrade) continue;
    options.push({
      slot: option.slot, upgradeId: option.upgradeId,
      name: upgrade.name, description: upgrade.description,
      category: upgrade.category, tier: upgrade.tier, group: upgrade.group,
      effects: upgrade.effects,
    });
  }
  return { level: offer.level, options };
}

// ─── 전투 보상 연구 ────────────────────────────────

/** econ_scrap(+1/처치/lv), econ_battle_reward(+15%/lv) 반영. 연구 레벨 0이면 totalKills × scrapPerKill. */
export function calcBattleScrapReward(totalKills: number, scrapPerKill: number, researchSnapshot: ResearchSnapshot): number {
  const perKill = scrapPerKill + (researchSnapshot.econ_scrap || 0);
  // 정수 퍼센트로 계산해 부동소수 오차 방지
  const rewardPct = 100 + (researchSnapshot.econ_battle_reward || 0) * ECON_BATTLE_REWARD_PCT_PER_LEVEL;
  return Math.floor(totalKills * perKill * rewardPct / 100);
}
