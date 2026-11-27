process.env.DB_DRIVER = 'json';

import { app } from '../app.js';
import { endBattleSession, reportBattleEvent, selectUpgrade, startBattleSession } from '../shared/battle-session.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { getBattleRepo, resetAllRepos } from '../provider.js';
import { resetAuthStores, jsonAuthRepo } from '../store-auth.js';
import { resetBattleStores } from '../store-battle.js';
import { resetWalletStores } from '../store-wallet.js';
import { resetCraftingStores } from '../store-crafting.js';
import { resetItemLedger } from '../store-item-ledger.js';
import { jsonPartsRepo, resetPartsStores } from '../store-parts.js';
import { resetResearchStores } from '../store-research.js';
import { ALL_UPGRADES } from '../data/upgrades.js';
import {
  applyBattleUpgrades,
  calcBattleScrapReward,
  computeBattleLoadoutStats,
  DEFAULT_MECH_STATS,
  enrichUpgradeChoice,
} from '../shared/mecha-stats.js';
import type { EquipSlot, PlayerPart } from '../types.js';

const BASE = { ...DEFAULT_MECH_STATS };
const TOKEN = jwt.sign({ sub: 'battle-user', type: 'access' }, process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production', { expiresIn: 3600 });

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' };
}

function part(partCode: string, partType: PlayerPart['partType'], level = 1): PlayerPart {
  return { id: crypto.randomUUID(), playerId: 'p', partCode, partType, level, equipped: 1, createdAt: new Date().toISOString() };
}

function slot(overrides: Partial<EquipSlot>): EquipSlot {
  return { id: 'e', playerId: 'p', frame: 'medium_frame', weapon: 'machine_gun', core: 'defense_core', module: 'shield_module', updatedAt: '', ...overrides };
}

beforeEach(async () => {
  for (const file of ['data-users.json', 'data-sessions.json', 'data-sanctions.json', 'data-profiles.json', 'data-wallets.json', 'data-ledger.json', 'data-blueprints.json', 'data-item-ledger.json', 'data-battles.json', 'data-battle-events.json', 'data-battle-results.json', 'data-parts.json', 'data-equip.json', 'data-research.json']) {
    for (const suffix of ['', '.bak']) {
      try { require('fs').unlinkSync(require('path').join(process.cwd(), file + suffix)); } catch {}
    }
  }
  resetAuthStores();
  resetAllRepos();
  resetBattleStores();
  resetWalletStores();
  resetCraftingStores();
  resetItemLedger();
  resetPartsStores();
  resetResearchStores();
  const now = new Date().toISOString();
  await jsonAuthRepo.createUser({ id: 'battle-user', email: 'battle-user@example.test', nickname: 'battle-user', passwordHash: '', status: 'active', role: 'user', createdAt: now, updatedAt: now });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeBattleLoadoutStats', () => {
  it('인벤토리에 없는 장착 파츠와 연구 0레벨은 baseStats를 그대로 유지한다', () => {
    const result = computeBattleLoadoutStats(BASE, slot({ frame: 'heavy_frame', weapon: 'sniper_rifle', core: 'assault_core' }), [], [{ code: 'combat_atk_1', level: 0 }]);
    expect(result.statSnapshot).toEqual(BASE);
    expect(result.baseStats).toEqual(BASE);
    expect(result.loadoutSnapshot).toEqual({});
    expect(result.researchSnapshot).toEqual({});
  });

  it('보유한 프레임만 maxHp/moveSpeed/attackPower/dashCooldown에 반영하고 레벨 보정을 적용한다', () => {
    const lv1 = computeBattleLoadoutStats(BASE, slot({ frame: 'heavy_frame' }), [part('heavy_frame', 'frame')], []);
    expect(lv1.statSnapshot).toMatchObject({ maxHp: 150, moveSpeed: 70, attackPower: 12, dashCooldown: 7000 });
    expect(lv1.loadoutSnapshot.frame).toEqual({ code: 'heavy_frame', level: 1 });

    const lv3 = computeBattleLoadoutStats(BASE, slot({ frame: 'heavy_frame' }), [part('heavy_frame', 'frame', 3)], []);
    expect(lv3.statSnapshot.maxHp).toBe(180); // 150 * 1.2
    expect(lv3.statSnapshot.dashCooldown).toBe(Math.round(7000 / 1.1));
  });

  it('무기는 공격력을 가산하되 공격 간격을 80ms 아래로 낮추거나 무기 값으로 덮어쓰지 않는다', () => {
    const sniper = computeBattleLoadoutStats(BASE, slot({ weapon: 'sniper_rifle' }), [part('sniper_rifle', 'weapon')], []);
    expect(sniper.statSnapshot.attackPower).toBe(10 + 35);
    expect(sniper.statSnapshot.attackSpeed).toBe(100);

    const machineGun = computeBattleLoadoutStats(BASE, slot({ weapon: 'machine_gun' }), [part('machine_gun', 'weapon', 50)], []);
    expect(machineGun.statSnapshot.attackSpeed).toBe(80);
  });

  it('코어·모듈·전투 연구를 합산한다', () => {
    const result = computeBattleLoadoutStats(
      BASE,
      slot({ core: 'assault_core', module: 'scanner_module' }),
      [part('assault_core', 'core'), part('scanner_module', 'module')],
      [
        { code: 'combat_atk_1', level: 2 },
        { code: 'combat_hp_2', level: 2 },
        { code: 'combat_speed', level: 2 },
        { code: 'combat_ult', level: 3 },
      ],
    );
    // 공격력 +20%(코어) +16%(연구) → 13.6 → 14
    expect(result.statSnapshot.attackPower).toBe(14);
    // 체력 +30%(combat_hp_2 lv2)
    expect(result.statSnapshot.maxHp).toBe(130);
    // 이동속도 +5%(모듈) +16%(연구)
    expect(result.statSnapshot.moveSpeed).toBe(121);
    expect(result.statSnapshot.dashCooldown).toBe(4500);
    expect(result.statSnapshot.ultimatePower).toBe(45);
    expect(result.statSnapshot.ultimateCooldown).toBe(21000); // 30000 * 0.7
    expect(result.researchSnapshot).toEqual({ combat_atk_1: 2, combat_hp_2: 2, combat_speed: 2, combat_ult: 3 });
  });

  it('모듈의 실드/재생/충전 보너스는 loadoutSnapshot.bonuses에 남고 궁극기 쿨다운을 줄인다', () => {
    const shield = computeBattleLoadoutStats(BASE, slot({ module: 'shield_module' }), [part('shield_module', 'module')], []);
    expect(shield.loadoutSnapshot.bonuses).toEqual({ shieldHp: 50 });

    const power = computeBattleLoadoutStats(BASE, slot({ module: 'power_module' }), [part('power_module', 'module')], []);
    expect(power.statSnapshot.ultimateCooldown).toBe(24000); // 30000 / 1.25
  });

  it('연구 쿨다운 하한을 지킨다', () => {
    const result = computeBattleLoadoutStats(BASE, null, [], [{ code: 'combat_speed', level: 30 }, { code: 'combat_ult', level: 30 }]);
    expect(result.statSnapshot.dashCooldown).toBe(500);
    expect(result.statSnapshot.ultimateCooldown).toBe(5000);
  });
});

describe('calcBattleScrapReward', () => {
  it('연구 레벨 0이면 기존 계산(kills × scrapPerKill)과 같다', () => {
    expect(calcBattleScrapReward(10, 1, {})).toBe(10);
    expect(calcBattleScrapReward(7, 3, {})).toBe(21);
  });

  it('econ_scrap은 처치당 +1/lv, econ_battle_reward는 +15%/lv', () => {
    expect(calcBattleScrapReward(10, 1, { econ_scrap: 2 })).toBe(30);
    expect(calcBattleScrapReward(10, 1, { econ_scrap: 2, econ_battle_reward: 2 })).toBe(39);
  });
});

describe('applyBattleUpgrades', () => {
  it('효과를 누적 적용한다', () => {
    const stats = applyBattleUpgrades(BASE, ['machine_gun_1']);
    expect(stats).toMatchObject({ attackPower: 12, attackSpeed: 80, moveSpeed: 100, maxHp: 100, shieldHp: 0, critRate: 0, healOnKill: 0 });
  });

  it('moveSpeed·ultimatePower는 %, 나머지는 절대값으로 가산하고 모듈 보너스를 유지한다', () => {
    const stats = applyBattleUpgrades(BASE, ['speed_1', 'armor_3', 'shield_1', 'crit_2', 'heal_1', 'ulti_1'], { bonuses: { shieldHp: 50, hpRegenPerSec: 2 } });
    expect(stats.moveSpeed).toBe(110);
    expect(stats.maxHp).toBe(180);
    expect(stats.shieldHp).toBe(50 + 30 + 30);
    expect(stats.hpRegenPerSec).toBe(2 + 2);
    expect(stats.critRate).toBe(12);
    expect(stats.critDamage).toBe(30);
    expect(stats.healOnKill).toBe(5);
    expect(stats.ultimatePower).toBe(Math.round(30 * 1.1));
    expect(stats.ultimateCooldown).toBe(27000);
  });

  it('하한을 클램프한다', () => {
    const everything = ALL_UPGRADES.map((u) => u.id);
    const stats = applyBattleUpgrades({ ...BASE, dashCooldown: 600, ultimateCooldown: 4000, attackSpeed: 90 }, everything);
    expect(stats.attackSpeed).toBe(80);
    expect(stats.dashCooldown).toBe(250);
    expect(stats.ultimateCooldown).toBe(3000);
    expect(stats.maxHp).toBeGreaterThanOrEqual(1);
    expect(stats.attackPower).toBeGreaterThanOrEqual(1);
    expect(applyBattleUpgrades({ ...BASE, attackPower: 1, maxHp: 1 }, []).maxHp).toBe(1);
  });
});

describe('enrichUpgradeChoice', () => {
  it('각 옵션에 이름·설명·카테고리·티어·그룹·효과를 붙인다', () => {
    const enriched = enrichUpgradeChoice({ level: 2, options: [{ slot: 0, upgradeId: 'machine_gun_1' }, { slot: 1, upgradeId: 'unknown_id' }] });
    expect(enriched.level).toBe(2);
    expect(enriched.options).toEqual([{
      slot: 0, upgradeId: 'machine_gun_1', name: '기관총 강화 I', description: '기관총의 연사력이 향상된다.',
      category: 'weapon', tier: 1, group: 'machine_gun', effects: { attackSpeed: -20, attackPower: 2 },
    }]);
  });
});

describe('GET /api/mecha/stats + 전투 세션 스냅샷', () => {
  it('파츠가 없는 플레이어는 baseStats와 statSnapshot이 같다', async () => {
    const res = await app.request('/api/mecha/stats', { headers: headers() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ baseStats: BASE, statSnapshot: BASE, loadoutSnapshot: {}, researchSnapshot: {} });

    const anon = await app.request('/api/mecha/stats');
    expect(anon.status).toBe(401);
  });

  it('보유·장착 파츠가 API 응답과 새 전투 세션 스냅샷에 반영된다', async () => {
    await jsonPartsRepo.grantPart('battle-user', 'heavy_frame', 'frame');
    await jsonPartsRepo.equipPart('battle-user', 'heavy_frame', 'frame');

    const res = await app.request('/api/mecha/stats', { headers: headers() });
    const body = await res.json();
    expect(body.baseStats).toEqual(BASE);
    expect(body.statSnapshot).toMatchObject({ maxHp: 150, moveSpeed: 70, attackPower: 12, dashCooldown: 7000 });
    expect(body.loadoutSnapshot.frame).toEqual({ code: 'heavy_frame', level: 1 });

    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    expect(session.statSnapshot).toEqual(body.statSnapshot);
    expect(session.loadoutSnapshot).toEqual(body.loadoutSnapshot);

    const stored = await (await getBattleRepo()).getSession(session.id);
    expect(JSON.parse(stored.statSnapshot)).toEqual(body.statSnapshot);
    expect(JSON.parse(stored.baseStatsSnapshot)).toEqual(BASE);
    expect(JSON.parse(stored.loadoutSnapshot)).toEqual(body.loadoutSnapshot);
  });
});

describe('강화 offer/select 흐름', () => {
  it('progress는 선택지를 만들지 않고, offer가 멱등하게 선택지를 만들며, select가 effectiveStats를 돌려준다', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);

    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    const post = (path: string, body?: unknown) => app.request(`/api/battles/${session.id}/${path}`, {
      method: 'POST', headers: headers(), body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 조건 미충족
    const early = await post('upgrades/offer');
    expect(early.status).toBe(400);
    expect((await early.json()).code).toBe('UPGRADE_NOT_AVAILABLE');

    vi.setSystemTime(new Date(startedAt.getTime() + 20_000));
    const progress = await post('progress', { sequence: 1, killsDelta: 10, coreEnergyDelta: 50, elapsedSeconds: 10 });
    expect(progress.status).toBe(200);
    expect(await progress.json()).toEqual({ accepted: true, battleLevel: 1, upgradesAvailable: true, pendingOffer: null });
    expect((await (await getBattleRepo()).getSession(session.id)).offeredChoices).toBe('[]');

    const offered = await post('upgrades/offer');
    expect(offered.status).toBe(200);
    const offerBody = await offered.json();
    expect(offerBody.battleLevel).toBe(2);
    expect(offerBody.applied).toEqual([]);
    expect(offerBody.offer.level).toBe(2);
    expect(offerBody.offer.options).toHaveLength(3);
    for (const option of offerBody.offer.options) {
      expect(option).toEqual(expect.objectContaining({ slot: expect.any(Number), upgradeId: expect.any(String), name: expect.any(String), description: expect.any(String), category: expect.any(String), tier: expect.any(Number), group: expect.any(String), effects: expect.any(Object) }));
    }

    const again = await post('upgrades/offer');
    expect(await again.json()).toEqual(offerBody);

    vi.setSystemTime(new Date(startedAt.getTime() + 21_000));
    const progress2 = await post('progress', { sequence: 2, killsDelta: 0, coreEnergyDelta: 0, elapsedSeconds: 11 });
    const progress2Body = await progress2.json();
    expect(progress2Body).toMatchObject({ accepted: true, battleLevel: 2, upgradesAvailable: true });
    expect(progress2Body.pendingOffer).toEqual(offerBody.offer);

    const invalid = await post('upgrades/select', { selectedUpgradeCode: 'not_offered' });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('INVALID_CHOICE');

    const chosen = offerBody.offer.options[0];
    const selected = await post('upgrades/select', { selectedUpgradeCode: chosen.upgradeId });
    expect(selected.status).toBe(200);
    const selectedBody = await selected.json();
    expect(selectedBody.applied).toEqual([chosen.upgradeId]);
    expect(selectedBody.offeredChoices).toHaveLength(1);
    expect(selectedBody.selectedUpgrade).toEqual({
      id: chosen.upgradeId, name: chosen.name, description: chosen.description,
      category: chosen.category, tier: chosen.tier, effects: chosen.effects,
    });
    expect(selectedBody.effectiveStats).toEqual(applyBattleUpgrades(BASE, [chosen.upgradeId]));
    expect(Object.keys(selectedBody.effectiveStats).sort()).toEqual([
      'attackPower', 'attackSpeed', 'critDamage', 'critRate', 'dashCooldown', 'healOnKill', 'hpRegenPerSec',
      'maxHp', 'moveSpeed', 'shieldHp', 'ultimateCooldown', 'ultimatePower',
    ]);

    // 선택 후에는 미선택 offer가 없고 코어 에너지가 다음 레벨 문턱(100)에 못 미쳐 새 offer를 만들 수 없다
    const none = await post('upgrades/offer');
    expect(none.status).toBe(400);
    expect((await none.json()).code).toBe('UPGRADE_NOT_AVAILABLE');
  });

  it('소유자·세션·상태 검증과 기존 select 계약(CHOICES_GENERATED)을 유지한다', async () => {
    const missing = await app.request('/api/battles/does-not-exist/upgrades/offer', { method: 'POST', headers: headers() });
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('SESSION_NOT_FOUND');

    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    const otherToken = jwt.sign({ sub: 'someone-else', type: 'access' }, process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production', { expiresIn: 3600 });
    const forbidden = await app.request(`/api/battles/${session.id}/upgrades/offer`, {
      method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(forbidden.status).toBe(403);

    await expect(selectUpgrade(session.id, 'battle-user', 'machine_gun_1')).rejects.toMatchObject({ code: 'CHOICES_GENERATED' });
    const repo = await getBattleRepo();
    expect(JSON.parse((await repo.getSession(session.id)).offeredChoices)).toHaveLength(1);

    await repo.abandonSession(session.id);
    const inactive = await app.request(`/api/battles/${session.id}/upgrades/offer`, { method: 'POST', headers: headers() });
    expect(inactive.status).toBe(400);
    expect((await inactive.json()).code).toBe('SESSION_NOT_ACTIVE');
  });

  it('종료 시 연구 스냅샷의 econ_scrap/econ_battle_reward를 보상에 반영한다', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);
    await jsonAuthRepo.createWallet({
      id: crypto.randomUUID(), playerId: 'battle-user', userId: 'battle-user',
      electricity: 0, electricityPerSecond: 1, scrap: 0, balance: 0,
      lastClaimedAt: startedAt.toISOString(), createdAt: startedAt.toISOString(), updatedAt: startedAt.toISOString(),
    });
    const repo = await getBattleRepo();
    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    await repo.updateSession(session.id, { researchSnapshot: JSON.stringify({ econ_scrap: 1, econ_battle_reward: 2 }) });

    vi.setSystemTime(new Date(startedAt.getTime() + 120_000));
    await reportBattleEvent(session.id, 'battle-user', {
      sequence: 1, killsDelta: 10, coreEnergyDelta: 50, bossId: 'boss_ruins_guardian', elapsedSeconds: 120,
    });
    vi.setSystemTime(new Date(startedAt.getTime() + 180_000));
    const finished = await endBattleSession(session.id, 'battle-user', {
      totalKills: 10, totalCoreEnergy: 50, bossDefeated: ['boss_ruins_guardian'], elapsedSeconds: 180,
    });
    // (1+1) * 10 = 20, × 1.30 = 26
    expect(finished.reward.scrap).toBe(26);
  });
});
