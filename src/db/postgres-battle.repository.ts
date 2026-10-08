/**
 * PostgreSQL 기반 전투 세션 저장소
 */
import { eq, and, gt, isNull, lte, or, inArray, desc } from 'drizzle-orm';
import { getDb } from './postgres-connection.js';
import { stages, stageRewards, battleSessions, playerRecords, mechaStats, walletBalances, currencyLedger, battleUpgradeOffers, battleEvents, battleResults, playerStageProgress, accountSanctions, securityEvents } from './postgres-schema.js';
import type { BattleRepository } from '../repository.js';
import { toPostgresDate } from './postgres-timestamps.js';

const timestampFields = new Set([
  'startTime', 'startedAt', 'lastEventAt', 'expiresAt', 'endTime', 'completedAt',
  'verifiedAt', 'createdAt', 'updatedAt', 'selectedAt', 'finalizedAt', 'unlockedAt',
  'firstClearedAt', 'lastClearedAt', 'occurredAt', 'reviewedAt', 'revokedAt',
  'startsAt', 'grantedAt', 'deadlineAt', 'finishedAt',
]);

function normalizeTimestampFields<T extends Record<string, unknown>>(row: T): T {
  let normalized: Record<string, unknown> | undefined;
  for (const field of timestampFields) {
    const value = row[field];
    if (value instanceof Date || typeof value === 'string') {
      normalized ??= { ...row };
      normalized[field] = toPostgresDate(value);
    }
  }
  return (normalized ?? row) as T;
}

export const postgresBattleRepo: BattleRepository = {
  async getStage(stageId: string) {
    const db = getDb();
    const rows = await db.select().from(stages).where(eq(stages.id, stageId)).limit(1);
    return rows[0] ? normalizeTimestampFields(rows[0]) : null;
  },
  async getStages() {
    const db = getDb();
    return (await db.select().from(stages)).map(normalizeTimestampFields);
  },
  async getStageRewards(stageId: string) {
    const db = getDb();
    return (await db.select().from(stageRewards).where(eq(stageRewards.stageId, stageId))).map(normalizeTimestampFields);
  },

  async getMechStats(playerId: string) {
    const db = getDb();
    const rows = await db.select().from(mechaStats).where(eq(mechaStats.playerId, playerId)).limit(1);
    return rows[0] ? normalizeTimestampFields(rows[0]) : null;
  },
  async createMechStats(playerId: string, stats: any) {
    const db = getDb();
    await db.insert(mechaStats).values(normalizeTimestampFields({
      id: crypto.randomUUID(), playerId, ...stats, createdAt: new Date(), updatedAt: new Date(),
    }));
  },

  async getActiveSanctions(userId: string) {
    const db = getDb();
    const rows = await db.select().from(accountSanctions).where(and(
      eq(accountSanctions.userId, userId),
      inArray(accountSanctions.type, ['suspension', 'battle_restriction', 'reward_restriction']),
      eq(accountSanctions.status, 'active'),
      lte(accountSanctions.startsAt, new Date()),
      or(isNull(accountSanctions.expiresAt), gt(accountSanctions.expiresAt, new Date())),
    ));
    return rows.map(normalizeTimestampFields);
  },
  async getActiveSessions(playerId: string) {
    const db = getDb();
    const rows = await db.select().from(battleSessions)
      .where(and(eq(battleSessions.playerId, playerId), eq(battleSessions.status, 'active')));
    return rows.map(normalizeTimestampFields);
  },
  async abandonSession(sessionId: string) {
    const db = getDb();
    const now = new Date();
    await db.update(battleSessions).set({ status: 'abandoned', endTime: now, completedAt: now }).where(eq(battleSessions.id, sessionId));
  },

  async createSession(session: any) {
    const db = getDb();
    await db.insert(battleSessions).values(normalizeTimestampFields(session));
  },
  async getSession(sessionId: string) {
    const db = getDb();
    const rows = await db.select().from(battleSessions).where(eq(battleSessions.id, sessionId)).limit(1);
    return rows[0] ? normalizeTimestampFields(rows[0]) : null;
  },
  async updateSession(sessionId: string, data: Record<string, unknown>) {
    const db = getDb();
    await db.update(battleSessions).set(normalizeTimestampFields(data)).where(eq(battleSessions.id, sessionId));
  },

  async saveBattleEvent(event: any) {
    const db = getDb();
    await db.insert(battleEvents).values(normalizeTimestampFields(event));
  },
  async getLastBattleEventSequence(sessionId: string) {
    const db = getDb();
    const rows = await db.select({ sequence: battleEvents.sequence }).from(battleEvents)
      .where(eq(battleEvents.battleSessionId, sessionId))
      .orderBy(desc(battleEvents.sequence))
      .limit(1);
    return rows[0]?.sequence || 0;
  },
  async getUpgradeOffers(sessionId: string) {
    const db = getDb();
    return (await db.select().from(battleUpgradeOffers).where(eq(battleUpgradeOffers.battleSessionId, sessionId)))
      .map(normalizeTimestampFields);
  },
  async saveUpgradeChoices(sessionId: string, level: number, choices: { slot: number; upgradeId: string }[], sessionUpdates: Record<string, unknown>): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const sessions = await tx.select({ status: battleSessions.status }).from(battleSessions)
        .where(eq(battleSessions.id, sessionId)).limit(1).for('update');
      if (sessions.length === 0 || sessions[0].status !== 'active') return false;
      const existing = await tx.select({ id: battleUpgradeOffers.id }).from(battleUpgradeOffers)
        .where(and(eq(battleUpgradeOffers.battleSessionId, sessionId), eq(battleUpgradeOffers.level, level)))
        .limit(1);
      if (existing.length > 0) return false;

      await tx.update(battleSessions).set(normalizeTimestampFields(sessionUpdates))
        .where(eq(battleSessions.id, sessionId));
      const now = new Date();
      for (const choice of choices) {
        await tx.insert(battleUpgradeOffers).values({
          id: crypto.randomUUID(), battleSessionId: sessionId, level, sequence: level,
          optionSlot: choice.slot, upgradeId: choice.upgradeId, selected: 0, createdAt: now,
        });
      }
      return true;
    });
  },
  async selectUpgradeOffer(sessionId: string, level: number, upgradeId: string, sessionUpdates: Record<string, unknown>): Promise<boolean> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const sessions = await tx.select({ status: battleSessions.status }).from(battleSessions)
        .where(eq(battleSessions.id, sessionId)).limit(1).for('update');
      if (sessions.length === 0 || sessions[0].status !== 'active') return false;
      const offers = await tx.select().from(battleUpgradeOffers)
        .where(and(eq(battleUpgradeOffers.battleSessionId, sessionId), eq(battleUpgradeOffers.level, level)))
        .for('update');
      if (offers.length === 0 || offers.some((offer) => offer.selected === 1)
        || !offers.some((offer) => offer.upgradeId === upgradeId)) return false;

      const now = new Date();
      await tx.update(battleUpgradeOffers)
        .set({ selected: 1, selectedAt: now })
        .where(and(
          eq(battleUpgradeOffers.battleSessionId, sessionId),
          eq(battleUpgradeOffers.level, level),
          eq(battleUpgradeOffers.upgradeId, upgradeId),
          eq(battleUpgradeOffers.selected, 0),
        ));
      await tx.update(battleSessions).set(normalizeTimestampFields(sessionUpdates))
        .where(eq(battleSessions.id, sessionId));
      return true;
    });
  },

  async createBattleResult(result: any) {
    const db = getDb();
    await db.insert(battleResults).values(normalizeTimestampFields(result));
  },
  async getBattleResult(sessionId: string) {
    const db = getDb();
    const rows = await db.select().from(battleResults).where(eq(battleResults.battleSessionId, sessionId)).limit(1);
    return rows[0] ? normalizeTimestampFields(rows[0]) : null;
  },

  async getWalletBalance(playerId: string) {
    const db = getDb();
    const rows = await db.select().from(walletBalances)
      .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)))
      .limit(1);
    return rows[0] ? normalizeTimestampFields(rows[0]) : null;
  },
  async updateWalletElectricity(playerId: string, amount: number) {
    const db = getDb();
    await db.update(walletBalances).set({ electricity: amount, updatedAt: new Date() })
      .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)));
  },
  async updateWalletScrap(playerId: string, amount: number) {
    const db = getDb();
    await db.update(walletBalances).set({ scrap: amount, updatedAt: new Date() })
      .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)));
  },
  async insertCurrencyLedger(entry: any) {
    const db = getDb();
    await db.insert(currencyLedger).values(normalizeTimestampFields(entry));
  },

  async getPlayerRecord(playerId: string, stageId: string) {
    const db = getDb();
    const rows = await db.select().from(playerRecords)
      .where(and(eq(playerRecords.playerId, playerId), eq(playerRecords.stageId, stageId))).limit(1);
    return rows[0] ? normalizeTimestampFields(rows[0]) : null;
  },
  async upsertPlayerRecord(record: any) {
    const db = getDb();
    const normalized = normalizeTimestampFields(record);
    const existing = await db.select().from(playerRecords)
      .where(and(eq(playerRecords.playerId, record.playerId), eq(playerRecords.stageId, record.stageId))).limit(1);
    if (existing.length > 0) {
      await db.update(playerRecords).set({
        totalClears: (existing[0].totalClears || 0) + 1,
        lastClearedAt: toPostgresDate(normalized.lastClearedAt),
        updatedAt: new Date(),
      }).where(eq(playerRecords.id, existing[0].id));
    } else {
      await db.insert(playerRecords).values(normalized);
    }
  },

  async getPlayerStageProgress(playerId: string, stageId: string) {
    const db = getDb();
    const rows = await db.select().from(playerStageProgress)
      .where(and(eq(playerStageProgress.playerId, playerId), eq(playerStageProgress.stageId, stageId))).limit(1);
    return rows[0] ? normalizeTimestampFields(rows[0]) : null;
  },
  async upsertPlayerStageProgress(progress: any) {
    const db = getDb();
    const normalized = normalizeTimestampFields(progress);
    const existing = await db.select().from(playerStageProgress)
      .where(and(eq(playerStageProgress.playerId, progress.playerId), eq(playerStageProgress.stageId, progress.stageId))).limit(1);
    if (existing.length > 0) {
      await db.update(playerStageProgress).set(normalized).where(eq(playerStageProgress.id, existing[0].id));
    } else {
      await db.insert(playerStageProgress).values(normalized);
    }
  },

  async createSecurityEvent(event: any) {
    try {
      const db = getDb();
      await db.insert(securityEvents).values(normalizeTimestampFields(event));
    } catch {}
  },
};

