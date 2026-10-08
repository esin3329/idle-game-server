/**
 * PostgreSQL 기반 Admin 저장소
 */
import { getDb, withPostgresTransaction } from './postgres-connection.js';
import {
  users, operatorRoles, operatorRolePermissions, operatorPermissions,
  playerProfiles, walletBalances, currencyLedger, battleSessions, battleResults, securityEvents, operatorGrants, accountSanctions, operatorAuditLogs,
} from './postgres-schema.js';
import { eq, and, or, inArray, desc, count, like, type SQL } from 'drizzle-orm';
import { AppError } from '../shared/errors.js';
import { postgresWalletRepo } from './postgres-wallet.repository.js';
import type { AdminRepository } from '../repository.js';
import { postgresTimestampToIso } from './postgres-timestamps.js';

export const postgresAdminRepo: AdminRepository = {
  async listUsers(limit, offset, search, status) {
    const db = getDb();
    const conditions: SQL[] = [];
    if (search) conditions.push(or(like(users.nickname, '%' + search + '%'), like(users.email, '%' + search + '%'))!);
    if (status) conditions.push(eq(users.status, status));
    const filter = and(...conditions);
    const rows = await db.select({ id: users.id, email: users.email, nickname: users.nickname, status: users.status, role: users.role, createdAt: users.createdAt })
      .from(users).where(filter).orderBy(desc(users.createdAt), desc(users.id)).limit(limit).offset(offset);
    const total = await db.select({ value: count() }).from(users).where(filter);
    return { users: rows.map((row) => ({ ...row, createdAt: postgresTimestampToIso(row.createdAt) })), total: total[0].value };
  },
  async getUserDetail(userId: string) {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!rows[0]) return null;
    const { passwordHash: _passwordHash, refreshToken: _refreshToken, ...safe } = rows[0];
    return safe;
  },
  async getUserWallet(userId: string) {
    const db = getDb();
    const rows = await db.select({
      playerId: walletBalances.playerId,
      electricity: walletBalances.electricity,
      scrap: walletBalances.scrap,
      electricityPerSecond: walletBalances.electricityPerSecond,
      lastClaimedAt: walletBalances.lastClaimedAt,
    }).from(walletBalances).where(eq(walletBalances.userId, userId)).limit(1);
    const wallet = rows[0];
    return wallet ? { ...wallet, lastClaimedAt: postgresTimestampToIso(wallet.lastClaimedAt) } : null;
  },
  async getUserLedger(userId: string, limit = 50) {
    const db = getDb();
    return db.select({
      id: currencyLedger.id,
      playerId: currencyLedger.playerId,
      currency: currencyLedger.currency,
      amount: currencyLedger.amount,
      balanceAfter: currencyLedger.balanceAfter,
      source: currencyLedger.source,
      reason: currencyLedger.reason,
      referenceType: currencyLedger.referenceType,
      referenceId: currencyLedger.referenceId,
      createdAt: currencyLedger.createdAt,
    }).from(currencyLedger)
      .where(eq(currencyLedger.userId, userId))
      .orderBy(desc(currencyLedger.createdAt), desc(currencyLedger.id))
      .limit(Math.max(1, Math.min(limit, 50)));
  },
  async getUserSecurityEvents(userId: string, limit = 50) {
    const db = getDb();
    const profiles = await db.select({ playerId: playerProfiles.playerId })
      .from(playerProfiles).where(eq(playerProfiles.userId, userId));
    const playerIds = profiles.map((profile) => profile.playerId);
    const conditions = [eq(securityEvents.userId, userId)];
    if (playerIds.length > 0) conditions.push(inArray(securityEvents.playerId, playerIds));
    return db.select({
      id: securityEvents.id,
      eventType: securityEvents.eventType,
      code: securityEvents.code,
      severity: securityEvents.severity,
      source: securityEvents.source,
      safeDetails: securityEvents.safeDetails,
      occurredAt: securityEvents.occurredAt,
    }).from(securityEvents)
      .where(or(...conditions))
      .orderBy(desc(securityEvents.occurredAt), desc(securityEvents.id))
      .limit(Math.max(1, Math.min(limit, 50)));
  },
  async getUserBattles(userId: string, limit = 50) {
    const db = getDb();
    const profiles = await db.select({ playerId: playerProfiles.playerId })
      .from(playerProfiles).where(eq(playerProfiles.userId, userId));
    const playerIds = profiles.map((profile) => profile.playerId);
    const conditions = [eq(battleSessions.userId, userId)];
    if (playerIds.length > 0) conditions.push(inArray(battleSessions.playerId, playerIds));
    return db.select({
      id: battleSessions.id,
      stageId: battleSessions.stageId,
      status: battleSessions.status,
      resultCode: battleSessions.resultCode,
      totalKills: battleSessions.totalKills,
      rewardScrap: battleSessions.rewardScrap,
      createdAt: battleSessions.createdAt,
      result: battleResults.result,
      scrapReward: battleResults.scrapReward,
    }).from(battleSessions)
      .leftJoin(battleResults, eq(battleResults.battleSessionId, battleSessions.id))
      .where(or(...conditions))
      .orderBy(desc(battleSessions.createdAt), desc(battleSessions.id))
      .limit(Math.max(1, Math.min(limit, 50)));
  },
  async createSanction(data: typeof accountSanctions.$inferInsert) {
    await getDb().insert(accountSanctions).values(data);
    return data;
  },
  async revokeSanction(sanctionId, operatorId, reason) {
    const rows = await getDb().update(accountSanctions).set({
      status: 'revoked', revokedAt: new Date(), revokedByOperatorId: operatorId, revokeReason: reason,
    }).where(eq(accountSanctions.id, sanctionId)).returning({ id: accountSanctions.id });
    if (!rows.length) throw new AppError('제재를 찾을 수 없습니다.', 404, 'NOT_FOUND');
  },
  async createGrant(data: Omit<typeof operatorGrants.$inferInsert, 'id' | 'createdAt'>) {
    if (data.grantType !== 'currency' || !['electricity', 'scrap'].includes(data.resourceCode)) {
      throw new AppError('지원하지 않는 지급 유형입니다.', 400, 'INVALID_GRANT');
    }
    if (!Number.isSafeInteger(data.amount) || !data.idempotencyKey) {
      throw new AppError('유효한 지급 요청이 필요합니다.', 400, 'INVALID_GRANT');
    }
    return withPostgresTransaction(async () => {
      const db = getDb();
      const wallets = await db.select().from(walletBalances).where(eq(walletBalances.userId, data.targetUserId)).limit(1).for('update');
      if (!wallets[0]) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
      const existing = await db.select().from(operatorGrants).where(eq(operatorGrants.idempotencyKey, data.idempotencyKey!)).limit(1);
      if (existing[0]) {
        if (existing[0].targetUserId !== data.targetUserId || existing[0].amount !== data.amount || existing[0].resourceCode !== data.resourceCode) {
          throw new AppError('동일한 키가 다른 지급에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
        }
        return existing[0];
      }
      const id = crypto.randomUUID();
      const now = new Date();
      const result = await postgresWalletRepo.adjustBalance({
        playerId: wallets[0].playerId, amount: data.amount, currency: data.resourceCode,
        source: 'operator_grant', idempotencyKey: data.idempotencyKey!,
        reason: data.reasonText.slice(0, 100), referenceType: 'operator_grant', referenceId: id,
      });
      if (data.resourceCode === 'electricity') {
        const { players } = await import('./postgres-schema.js');
        await db.update(players).set({ electricity: result.balanceAfter, updatedAt: now }).where(eq(players.id, wallets[0].playerId));
      }
      await db.insert(operatorGrants).values({ ...data, id, createdAt: now });
      await db.insert(operatorAuditLogs).values({
        id: crypto.randomUUID(), operatorId: data.operatorId, action: 'operator_grant',
        targetType: 'user', targetId: data.targetUserId, reasonText: data.reasonText,
        afterSummary: JSON.stringify({ currency: data.resourceCode, amount: data.amount }),
        createdAt: now,
      });
      return { ...data, id };
    });
  },
  async getUserItems(userId: string, limit = 50) {
    const db = getDb(); const { itemLedger } = await import("./postgres-schema.js"); const { eq } = await import("drizzle-orm");
    return db.select().from(itemLedger).where(eq(itemLedger.userId, userId)).limit(limit);
  },
  async getIdleRewardLogs(userId: string, limit = 50) {
    const db = getDb(); const { currencyLedger } = await import("./postgres-schema.js"); const { eq } = await import("drizzle-orm");
    return db.select().from(currencyLedger).where(eq(currencyLedger.userId, userId)).limit(limit);
  },
  async listGrants(limit: number, offset: number, targetUserId?: string) {
    const db = getDb(); const { operatorGrants } = await import('./postgres-schema.js'); const { eq } = await import('drizzle-orm');
    let query = db.select().from(operatorGrants).$dynamic();
    if (targetUserId) query = query.where(eq(operatorGrants.targetUserId, targetUserId));
    const rows = await query.limit(limit || 50).offset(offset || 0);
    return rows;
  },
  async listAuditLogs(limit = 50, action) { return getDb().select().from(operatorAuditLogs).where(action ? eq(operatorAuditLogs.action, action) : undefined).orderBy(desc(operatorAuditLogs.createdAt)).limit(limit); },
  async getUserSanctions(userId: string) {
    const db = getDb(); const { accountSanctions } = await import("./postgres-schema.js"); const { eq } = await import("drizzle-orm"); return db.select().from(accountSanctions).where(eq(accountSanctions.userId, userId));
  },
  async suspendUser(userId: string, operatorId: string, reason: string) {
    const db = getDb(); const now = new Date(); const { users, accountSanctions } = await import("./postgres-schema.js"); const { eq } = await import("drizzle-orm");
    await db.update(users).set({ status: "suspended", suspendedAt: now, suspendedReason: reason, updatedAt: now }).where(eq(users.id, userId));
    await db.insert(accountSanctions).values({ id: crypto.randomUUID(), userId, operatorId, type: "suspension", reasonCode: "operator_action", reasonText: reason, startsAt: now, status: "active", createdAt: now });
  },
  async unsuspendUser(userId: string, operatorId: string, reason: string) {
    const db = getDb(); const now = new Date(); const { users, accountSanctions } = await import("./postgres-schema.js"); const { eq, and } = await import("drizzle-orm");
    await db.update(users).set({ status: "active", suspendedAt: null, suspendedReason: null, updatedAt: now }).where(eq(users.id, userId));
    await db.update(accountSanctions).set({ status: "revoked", revokedAt: now, revokedByOperatorId: operatorId, revokeReason: reason }).where(and(eq(accountSanctions.userId, userId), eq(accountSanctions.status, "active"), eq(accountSanctions.type, "suspension")));
  },
  async checkPermission(roleCode: string, permissionCode: string) {
    const db = getDb();
    const roleRows = await db.select().from(operatorRoles).where(eq(operatorRoles.code, roleCode)).limit(1);
    if (roleRows.length === 0) return false;
    const permRows = await db.select().from(operatorPermissions).where(eq(operatorPermissions.code, permissionCode)).limit(1);
    if (permRows.length === 0) return false;
    const mapping = await db.select().from(operatorRolePermissions)
      .where(and(eq(operatorRolePermissions.roleId, roleRows[0].id), eq(operatorRolePermissions.permissionId, permRows[0].id))).limit(1);
    return mapping.length > 0;
  },
};

