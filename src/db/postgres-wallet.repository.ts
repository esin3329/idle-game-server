/**
 * PostgreSQL 기반 Wallet 저장소
 *
 * wallet_balances + currency_ledger 를 PostgreSQL 트랜잭션으로 처리.
 * adjustBalance는 원자적 잔액 증감 + 원장 기록을 트랜잭션으로 수행.
 */
import { eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './postgres-connection.js';
import { walletBalances, currencyLedger } from './postgres-schema.js';
import type { WalletRepository, BalanceResult, LedgerEntry, AdjustBalanceParams } from '../repository.js';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { postgresTimestampToIso, toPostgresDate } from './postgres-timestamps.js';

export const postgresWalletRepo: WalletRepository = {
  async getBalance(playerId: string): Promise<BalanceResult | null> {
    const db = getDb();
    const rows = await db.select().from(walletBalances)
      .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)))
      .limit(1);
    if (rows.length === 0) return null;
    const w = rows[0];
    return {
      playerId: w.playerId,
      currency: w.currency,
      balance: w.electricity,
      scrap: w.scrap,
      electricityPerSecond: w.electricityPerSecond,
      lastClaimedAt: postgresTimestampToIso(w.lastClaimedAt),
    };
  },

  async getBalances(playerIds: string[]): Promise<BalanceResult[]> {
    if (playerIds.length === 0) return [];
    const db = getDb();
    const rows = await db.select().from(walletBalances)
      .where(inArray(walletBalances.playerId, playerIds));
    return rows.map((w) => ({
      playerId: w.playerId,
      currency: w.currency,
      balance: w.electricity,
      scrap: w.scrap,
      electricityPerSecond: w.electricityPerSecond,
      lastClaimedAt: postgresTimestampToIso(w.lastClaimedAt),
    }));
  },

  async adjustBalance(params: AdjustBalanceParams): Promise<{ balanceAfter: number; success: boolean }> {
    const db = getDb();
    const { playerId, amount, source, idempotencyKey, currency = 'electricity', reason = '', referenceType = '', referenceId = '' } = params;
    if (!idempotencyKey) throw new AppError('멱등성 키가 필요합니다.', 400, 'MISSING_IDEMPOTENCY_KEY');

    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`);
      // 1. 멱등성 검사
      const existing = await tx.select().from(currencyLedger)
        .where(eq(currencyLedger.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing.length > 0) {
        const entry = existing[0];
        if ((entry.playerId !== playerId && entry.userId !== playerId)
          || entry.amount !== amount || entry.currency !== currency || entry.source !== source
          || entry.reason !== reason || entry.referenceType !== referenceType || entry.referenceId !== referenceId) {
          throw new AppError('동일한 키가 다른 재화 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
        }
        return { balanceAfter: existing[0].balanceAfter, success: false };
      }

      // 2. 현재 잔액 조회
      const rows = await tx.select().from(walletBalances)
        .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)))
        .limit(1).for('update');
      if (rows.length === 0) {
        throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
      }

      const wallet = rows[0];
      const currentBalance = currency === 'scrap' ? wallet.scrap : wallet.electricity;
      const balanceAfter = currentBalance + amount;

      if (balanceAfter < 0) {
        throw new AppError('잔액이 부족합니다.', 400, 'INSUFFICIENT_BALANCE');
      }

      // 3. 잔액 갱신 (원자적)
      const setData: Record<string, unknown> = { updatedAt: new Date() };
      if (currency === 'scrap') {
        setData.scrap = balanceAfter;
      } else {
        setData.electricity = balanceAfter;
        setData.balance = balanceAfter;
      }
      await tx.update(walletBalances)
        .set(setData)
        .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)));

      // 4. 원장 기록
        await tx.insert(currencyLedger).values({
          id: crypto.randomUUID(),
          playerId: wallet.playerId,
          userId: wallet.userId,
          currency,
          amount,
          balanceAfter,
          source,
          reason,
          referenceType,
          referenceId,
          idempotencyKey,
          requestHash: '',
          createdAt: new Date(),
        });

      logger.info({ playerId, amount, balanceAfter, source, event: 'balance_adjust' }, 'Balance adjusted');
      return { balanceAfter, success: true };
    });
  },

  async updateEps(playerId: string, newEps: number): Promise<void> {
    const db = getDb();
    await db.update(walletBalances)
      .set({ electricityPerSecond: newEps, updatedAt: new Date() })
      .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)));
  },

  async updateLastClaimedAt(playerId: string, claimedAt: string): Promise<void> {
    const db = getDb();
    await db.update(walletBalances)
      .set({ lastClaimedAt: toPostgresDate(claimedAt), updatedAt: new Date() })
      .where(or(eq(walletBalances.playerId, playerId), eq(walletBalances.userId, playerId)));
  },

  async getLedger(playerId: string, limit = 50): Promise<LedgerEntry[]> {
    const db = getDb();
    const rows = await db.select().from(currencyLedger)
      .where(eq(currencyLedger.playerId, playerId))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      playerId: r.playerId,
      currency: r.currency,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      source: r.source,
      createdAt: postgresTimestampToIso(r.createdAt),
    }));
  },
};

