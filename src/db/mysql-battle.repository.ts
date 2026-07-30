/**
 * MySQL 기반 전투 세션 저장소
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from './connection.js';
import { stages, stageRewards, battleSessions, playerRecords, mechaStats, walletBalances, currencyLedger, battleUpgradeOffers, battleEvents, battleResults, playerStageProgress, accountSanctions, securityEvents } from './schema.js';
import type { BattleRepository } from '../repository.js';

export const mysqlBattleRepo: BattleRepository = {
  async getStage(stageId: string) {
    const db = getDb(); const rows = await db.select().from(stages).where(eq(stages.id, stageId)).limit(1); return rows[0] || null;
  },
  async getStages() {
    const db = getDb(); return db.select().from(stages);
  },
  async getStageRewards(stageId: string) {
    const db = getDb(); return db.select().from(stageRewards).where(eq(stageRewards.stageId, stageId));
  },

  async getMechStats(playerId: string) {
    const db = getDb(); const rows = await db.select().from(mechaStats).where(eq(mechaStats.playerId, playerId)).limit(1); return rows[0] || null;
  },
  async createMechStats(playerId: string, stats: any) {
    const db = getDb(); await db.insert(mechaStats).values({ id: crypto.randomUUID(), playerId, ...stats, createdAt: new Date(), updatedAt: new Date() });
  },

  async getActiveSanctions(playerId: string) {
    const db = getDb(); return db.select().from(accountSanctions).where(and(eq(accountSanctions.userId, playerId), eq(accountSanctions.type, 'suspension'), eq(accountSanctions.status, 'active'))).limit(1);
  },
  async getActiveSessions(playerId: string) {
    const db = getDb(); return db.select().from(battleSessions).where(and(eq(battleSessions.playerId, playerId), eq(battleSessions.status, 'active')));
  },
  async abandonSession(sessionId: string) {
    const db = getDb(); await db.update(battleSessions).set({ status: 'abandoned', endTime: new Date(), completedAt: new Date() }).where(eq(battleSessions.id, sessionId));
  },

  async createSession(session: any) {
    const db = getDb(); await db.insert(battleSessions).values(session);
  },
  async getSession(sessionId: string) {
    const db = getDb(); const rows = await db.select().from(battleSessions).where(eq(battleSessions.id, sessionId)).limit(1); return rows[0] || null;
  },
  async updateSession(sessionId: string, data: Record<string, unknown>) {
    const db = getDb(); await db.update(battleSessions).set(data).where(eq(battleSessions.id, sessionId));
  },

  async saveBattleEvent(event: any) {
    const db = getDb(); await db.insert(battleEvents).values(event);
  },
  async getUpgradeOffers(sessionId: string) {
    const db = getDb(); return db.select().from(battleUpgradeOffers).where(eq(battleUpgradeOffers.battleSessionId, sessionId));
  },
  async saveUpgradeOffer(offer: any) {
    const db = getDb(); await db.insert(battleUpgradeOffers).values(offer);
  },

  async createBattleResult(result: any) {
    const db = getDb(); await db.insert(battleResults).values(result);
  },
  async getBattleResult(sessionId: string) {
    const db = getDb(); const rows = await db.select().from(battleResults).where(eq(battleResults.battleSessionId, sessionId)).limit(1); return rows[0] || null;
  },

  async getWalletBalance(playerId: string) {
    const db = getDb(); const rows = await db.select().from(walletBalances).where(eq(walletBalances.playerId, playerId)).limit(1); return rows[0] || null;
  },
  async updateWalletElectricity(playerId: string, amount: number) {
    const db = getDb(); await db.update(walletBalances).set({ electricity: amount, updatedAt: new Date() }).where(eq(walletBalances.playerId, playerId));
  },
  async updateWalletScrap(playerId: string, amount: number) {
    const db = getDb(); await db.update(walletBalances).set({ scrap: amount, updatedAt: new Date() }).where(eq(walletBalances.playerId, playerId));
  },
  async insertCurrencyLedger(entry: any) {
    const db = getDb(); await db.insert(currencyLedger).values(entry);
  },

  async getPlayerRecord(playerId: string, stageId: string) {
    const db = getDb(); const rows = await db.select().from(playerRecords).where(and(eq(playerRecords.playerId, playerId), eq(playerRecords.stageId, stageId))).limit(1); return rows[0] || null;
  },
  async upsertPlayerRecord(record: any) {
    const db = getDb(); const existing = await db.select().from(playerRecords).where(and(eq(playerRecords.playerId, record.playerId), eq(playerRecords.stageId, record.stageId))).limit(1);
    if (existing.length > 0) {
      await db.update(playerRecords).set({ totalClears: (existing[0].totalClears || 0) + 1, lastClearedAt: record.lastClearedAt, updatedAt: new Date() }).where(eq(playerRecords.id, existing[0].id));
    } else {
      await db.insert(playerRecords).values(record);
    }
  },

  async getPlayerStageProgress(playerId: string, stageId: string) {
    const db = getDb(); const rows = await db.select().from(playerStageProgress).where(and(eq(playerStageProgress.playerId, playerId), eq(playerStageProgress.stageId, stageId))).limit(1); return rows[0] || null;
  },
  async upsertPlayerStageProgress(progress: any) {
    const db = getDb(); const existing = await db.select().from(playerStageProgress).where(and(eq(playerStageProgress.playerId, progress.playerId), eq(playerStageProgress.stageId, progress.stageId))).limit(1);
    if (existing.length > 0) { await db.update(playerStageProgress).set(progress).where(eq(playerStageProgress.id, existing[0].id)); }
    else { await db.insert(playerStageProgress).values(progress); }
  },

  async createSecurityEvent(event: any) {
    try { const db = getDb(); await db.insert(securityEvents).values(event); } catch {}
  },
};
