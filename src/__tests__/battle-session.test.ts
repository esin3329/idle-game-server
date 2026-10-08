process.env.DB_DRIVER = 'json';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBattleRepo, resetAllRepos } from '../provider.js';
import { resetAuthStores, jsonAuthRepo } from '../store-auth.js';
import { resetBattleStores } from '../store-battle.js';
import { resetWalletStores } from '../store-wallet.js';

beforeEach(async () => {
  for (const file of ['data-users.json', 'data-sessions.json', 'data-sanctions.json', 'data-profiles.json', 'data-wallets.json', 'data-battles.json', 'data-battle-events.json', 'data-battle-results.json']) {
    try { require('fs').unlinkSync(require('path').join(process.cwd(), file)); } catch {}
  }
  resetAuthStores();
  resetAllRepos();
  resetBattleStores();
  resetWalletStores();
  const now = new Date().toISOString();
  await jsonAuthRepo.createUser({ id: 'battle-user', email: 'battle-user@example.test', nickname: 'battle-user', passwordHash: '', status: 'active', role: 'user', createdAt: now, updatedAt: now });
});

afterEach(() => {
  vi.useRealTimers();
});

function writeBattleSanction(type: string): void {
  const now = new Date().toISOString();
  const file = process.env.DATA_FILE_SANCTIONS || require('path').join(process.cwd(), 'data-sanctions.json');
  require('fs').writeFileSync(file, JSON.stringify([{
    id: crypto.randomUUID(),
    userId: 'battle-user',
    type,
    status: 'active',
    reasonText: 'regression test',
    startsAt: now,
    createdAt: now,
  }]));
  resetAuthStores();
}

describe('서버 검증 전투 보상 확정', () => {
  it('즉시 완료, 최종 수치 불일치, 미처치 보스 보고를 거부한다', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);

    const { startBattleSession, reportBattleEvent, endBattleSession } = await import('../shared/battle-session.js');
    const session = await startBattleSession('battle-user', 'stage_01_ruins');

    await expect(endBattleSession(session.id, 'battle-user', {
      totalKills: 0,
      totalCoreEnergy: 0,
      bossDefeated: [],
      elapsedSeconds: 10,
    })).rejects.toMatchObject({ code: 'TIME_OUT_OF_RANGE' });

    vi.setSystemTime(new Date(startedAt.getTime() + 20_000));
    await reportBattleEvent(session.id, 'battle-user', {
      sequence: 1,
      killsDelta: 1,
      coreEnergyDelta: 5,
      elapsedSeconds: 10,
    });

    await expect(endBattleSession(session.id, 'battle-user', {
      totalKills: 0,
      totalCoreEnergy: 5,
      bossDefeated: [],
      elapsedSeconds: 10,
    })).rejects.toMatchObject({ code: 'FINAL_KILLS_MISMATCH' });

    await expect(endBattleSession(session.id, 'battle-user', {
      totalKills: 1,
      totalCoreEnergy: 5,
      bossDefeated: [],
      elapsedSeconds: 10,
    })).rejects.toMatchObject({ code: 'BOSS_MISMATCH' });

    const stored = await (await getBattleRepo()).getSession(session.id);
    expect(stored.status).toBe('active');
  });

  it('한 레벨의 여러 강화 선택지 중 하나만 선택되고 저장된다', async () => {
    const { startBattleSession, selectUpgrade } = await import('../shared/battle-session.js');
    const { ALL_UPGRADES } = await import('../data/upgrades.js');
    const repo = await getBattleRepo();
    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    const choices = ALL_UPGRADES.slice(0, 2).map((upgrade, slot) => ({ slot, upgradeId: upgrade.id }));
    const offeredChoices = [{ level: 2, options: choices }];

    await repo.saveUpgradeChoices(session.id, 2, choices, {
      battleLevel: 2,
      currentLevel: 2,
      currentCoreEnergy: 500,
      offeredChoices: JSON.stringify(offeredChoices),
    });

    const selected = await selectUpgrade(session.id, 'battle-user', choices[0].upgradeId);
    expect(selected.applied).toEqual([choices[0].upgradeId]);

    const persistedChoices = (await repo.getUpgradeOffers(session.id)).filter((offer) => offer.level === 2);
    expect(persistedChoices).toHaveLength(2);
    expect(persistedChoices.filter((offer) => offer.selected === 1).map((offer) => offer.upgradeId))
      .toEqual([choices[0].upgradeId]);

    await expect(selectUpgrade(session.id, 'battle-user', choices[1].upgradeId))
      .rejects.toMatchObject({ code: 'CHOICES_GENERATED' });
    const refreshed = await repo.getSession(session.id);
    expect(JSON.parse(refreshed.upgradesApplied)).toEqual([choices[0].upgradeId]);
    expect((await repo.getUpgradeOffers(session.id)).filter((offer) => offer.level === 2 && offer.selected === 1))
      .toHaveLength(1);
  });

  it('다른 사용자는 전투 이벤트와 보상을 확정할 수 없다', async () => {
    const { startBattleSession, reportBattleEvent, endBattleSession } = await import('../shared/battle-session.js');
    const repo = await getBattleRepo();
    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    const report = { totalKills: 0, totalCoreEnergy: 0, bossDefeated: [], elapsedSeconds: 10 };

    await expect(reportBattleEvent(session.id, 'attacker', {
      sequence: 1, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 10,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(endBattleSession(session.id, 'attacker', report))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await repo.getSession(session.id)).status).toBe('active');
  });

  it('보상 제한 제재 중에는 전투 보상을 확정하지 않고 세션을 복구한다', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);

    const { startBattleSession, reportBattleEvent, endBattleSession } = await import('../shared/battle-session.js');
    const repo = await getBattleRepo();
    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    vi.setSystemTime(new Date(startedAt.getTime() + 120_000));
    await reportBattleEvent(session.id, 'battle-user', {
      sequence: 1,
      killsDelta: 1,
      coreEnergyDelta: 5,
      bossId: 'boss_ruins_guardian',
      elapsedSeconds: 120,
    });
    writeBattleSanction('reward_restriction');

    await expect(endBattleSession(session.id, 'battle-user', {
      totalKills: 1,
      totalCoreEnergy: 5,
      bossDefeated: ['boss_ruins_guardian'],
      elapsedSeconds: 120,
    })).rejects.toMatchObject({ code: 'REWARD_RESTRICTED' });
    expect((await repo.getSession(session.id)).status).toBe('active');
    expect(await repo.getBattleResult(session.id)).toBeNull();
  });

  it('전투 제한 제재가 있으면 새 세션을 만들지 않는다', async () => {
    writeBattleSanction('battle_restriction');
    const { startBattleSession } = await import('../shared/battle-session.js');

    await expect(startBattleSession('battle-user', 'stage_01_ruins'))
      .rejects.toMatchObject({ code: 'BATTLE_RESTRICTED' });
    expect(await (await getBattleRepo()).getActiveSessions('battle-user')).toHaveLength(0);
  });
});
