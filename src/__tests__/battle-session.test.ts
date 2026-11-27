process.env.DB_DRIVER = 'json';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { getBattleRepo, resetAllRepos } from '../provider.js';
import { resetAuthStores, jsonAuthRepo } from '../store-auth.js';
import { resetBattleStores } from '../store-battle.js';
import { resetWalletStores } from '../store-wallet.js';
import { resetCraftingStores } from '../store-crafting.js';
import { resetItemLedger } from '../store-item-ledger.js';

beforeEach(async () => {
  for (const file of ['data-users.json', 'data-sessions.json', 'data-sanctions.json', 'data-profiles.json', 'data-wallets.json', 'data-ledger.json', 'data-blueprints.json', 'data-item-ledger.json', 'data-battles.json', 'data-battle-events.json', 'data-battle-results.json']) {
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
    expect(selected.selectedUpgrade.id).toBe(choices[0].upgradeId);
    expect(selected.effectiveStats).toMatchObject({ attackPower: expect.any(Number), shieldHp: expect.any(Number), healOnKill: expect.any(Number) });
    // 코어 에너지는 음수로 내려가지 않고 stage corePerLevel(50)만큼 차감된다
    expect((await repo.getSession(session.id)).currentCoreEnergy).toBe(450);
    expect(session.loadoutSnapshot).toEqual({});
    expect(session.researchSnapshot).toEqual({});

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

  it('스테이지 클리어 시 다음 스테이지를 해금하고 GET /api/stages에 반영한다', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);

    const playerId = 'battle-player-profile-id';
    const now = startedAt.toISOString();
    await jsonAuthRepo.createProfile({
      id: crypto.randomUUID(), playerId, userId: 'battle-user',
      nickname: 'battle-user', highestStage: 1, createdAt: now, updatedAt: now,
    });
    await jsonAuthRepo.createWallet({
      id: crypto.randomUUID(), playerId, userId: 'battle-user',
      electricity: 0, electricityPerSecond: 1, scrap: 0, balance: 0,
      lastClaimedAt: now, createdAt: now, updatedAt: now,
    });

    const { app } = await import('../app.js');
    const { startBattleSession, reportBattleEvent, endBattleSession } = await import('../shared/battle-session.js');
    const repo = await getBattleRepo();

    await expect(startBattleSession('battle-user', 'stage_02_factory'))
      .rejects.toMatchObject({ code: 'STAGE_LOCKED' });

    const session = await startBattleSession('battle-user', 'stage_01_ruins');
    expect(session.playerId).toBe(playerId);

    vi.setSystemTime(new Date(startedAt.getTime() + 120_000));
    await reportBattleEvent(session.id, 'battle-user', {
      sequence: 1, killsDelta: 10, coreEnergyDelta: 50,
      bossId: 'boss_ruins_guardian', elapsedSeconds: 120,
    });

    vi.setSystemTime(new Date(startedAt.getTime() + 180_000));
    const finished = await endBattleSession(session.id, 'battle-user', {
      totalKills: 10, totalCoreEnergy: 50,
      bossDefeated: ['boss_ruins_guardian'], elapsedSeconds: 180,
    });
    expect(finished.reward.scrap).toBe(10);

    const stage1Progress = await repo.getPlayerStageProgress(playerId, 'stage_01_ruins');
    const stage2Progress = await repo.getPlayerStageProgress(playerId, 'stage_02_factory');
    expect(stage1Progress?.firstClearedAt).toBeTruthy();
    expect(stage1Progress?.clearCount).toBe(1);
    expect(stage2Progress?.unlockedAt).toBeTruthy();

    const stage2Session = await startBattleSession('battle-user', 'stage_02_factory');
    expect(stage2Session.stageId).toBe('stage_02_factory');

    const token = jwt.sign(
      { sub: 'battle-user', type: 'access', role: 'user' },
      process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production',
      { expiresIn: 900 },
    );
    const authedStagesRes = await app.request('/api/stages', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authedStagesRes.status).toBe(200);
    const authedStages = await authedStagesRes.json() as any[];
    expect(authedStages.find((s) => s.id === 'stage_01_ruins')).toMatchObject({ unlocked: true, canEnter: true });
    expect(authedStages.find((s) => s.id === 'stage_02_factory')).toMatchObject({ unlocked: true, canEnter: true });
    expect(authedStages.find((s) => s.id === 'stage_03_lab')).toMatchObject({ unlocked: false, canEnter: false });

    const anonStagesRes = await app.request('/api/stages');
    expect(anonStagesRes.status).toBe(200);
    const anonStages = await anonStagesRes.json() as any[];
    expect(anonStages.find((s) => s.id === 'stage_01_ruins')).toMatchObject({ unlocked: true, canEnter: true });
    expect(anonStages.find((s) => s.id === 'stage_02_factory')).toMatchObject({ unlocked: false, canEnter: false });
  });

  it('stage_03_lab과 stage_04_core의 모든 보스 처치 후 클리어가 정상 확정된다', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(baseTime);

    const playerId = 'battle-player-late-stages';
    const now = baseTime.toISOString();
    await jsonAuthRepo.createProfile({
      id: crypto.randomUUID(), playerId, userId: 'battle-user',
      nickname: 'battle-user', highestStage: 4, createdAt: now, updatedAt: now,
    });
    await jsonAuthRepo.createWallet({
      id: crypto.randomUUID(), playerId, userId: 'battle-user',
      electricity: 0, electricityPerSecond: 1, scrap: 0, balance: 0,
      lastClaimedAt: now, createdAt: now, updatedAt: now,
    });

    const repo = await getBattleRepo();
    await repo.upsertPlayerStageProgress({
      id: crypto.randomUUID(), playerId, userId: 'battle-user',
      stageId: 'stage_02_factory', unlockedAt: baseTime, firstClearedAt: baseTime,
      clearCount: 1, createdAt: baseTime, updatedAt: baseTime,
    });

    const { startBattleSession, reportBattleEvent, endBattleSession } = await import('../shared/battle-session.js');

    const s3 = await startBattleSession('battle-user', 'stage_03_lab');
    vi.setSystemTime(new Date(baseTime.getTime() + 240_000));
    await reportBattleEvent(s3.id, 'battle-user', {
      sequence: 1, killsDelta: 10, coreEnergyDelta: 70,
      bossId: 'boss_lab_mutant', elapsedSeconds: 240,
    });
    vi.setSystemTime(new Date(baseTime.getTime() + 300_000));
    await reportBattleEvent(s3.id, 'battle-user', {
      sequence: 2, killsDelta: 10, coreEnergyDelta: 70,
      bossId: 'boss_lab_defender', elapsedSeconds: 300,
    });
    vi.setSystemTime(new Date(baseTime.getTime() + 360_000));
    const s3End = await endBattleSession(s3.id, 'battle-user', {
      totalKills: 20, totalCoreEnergy: 140,
      bossDefeated: ['boss_lab_mutant', 'boss_lab_defender'], elapsedSeconds: 360,
    });
    expect(s3End.reward.scrap).toBe(60);

    const s4Start = new Date('2026-01-01T01:00:00.000Z');
    vi.setSystemTime(s4Start);
    const s4 = await startBattleSession('battle-user', 'stage_04_core');
    vi.setSystemTime(new Date(s4Start.getTime() + 180_000));
    await reportBattleEvent(s4.id, 'battle-user', {
      sequence: 1, killsDelta: 5, coreEnergyDelta: 40,
      bossId: 'boss_core_sentinel', elapsedSeconds: 180,
    });
    vi.setSystemTime(new Date(s4Start.getTime() + 270_000));
    await reportBattleEvent(s4.id, 'battle-user', {
      sequence: 2, killsDelta: 5, coreEnergyDelta: 40,
      bossId: 'boss_core_overlord', elapsedSeconds: 270,
    });
    vi.setSystemTime(new Date(s4Start.getTime() + 330_000));
    await reportBattleEvent(s4.id, 'battle-user', {
      sequence: 3, killsDelta: 5, coreEnergyDelta: 40,
      bossId: 'boss_final_overmind', elapsedSeconds: 330,
    });
    vi.setSystemTime(new Date(s4Start.getTime() + 360_000));
    const s4End = await endBattleSession(s4.id, 'battle-user', {
      totalKills: 15, totalCoreEnergy: 120,
      bossDefeated: ['boss_core_sentinel', 'boss_core_overlord', 'boss_final_overmind'], elapsedSeconds: 360,
    });
    expect(s4End.reward.scrap).toBe(60);
  });
});
