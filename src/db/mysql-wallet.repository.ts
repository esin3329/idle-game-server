/**
 * MySQL 기반 Wallet 저장소
 *
 * wallet_balances + currency_ledger 를 MySQL 트랜잭션으로 처리.
 * adjustBalance는 원자적 잔액 증감 + 원장 기록을 트랜잭션으로 수행.
 */
import { eq } from 'drizzle-orm';
import { getDb } from './connection.js';
import { walletBalances, currencyLedger } from './schema.js';
import type { WalletRepository, BalanceResult, LedgerEntry, AdjustBalanceParams } from '../repository.js';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export const mysqlWalletRepo: WalletRepository = {
  async getBalance(playerId: string): Promise<BalanceResult | null> {
    const db = getDb();
    const rows = await db.select().from(walletBalances)
      .where(eq(walletBalances.playerId, playerId))
      .limit(1);
    if (rows.length === 0) return null;
    const w = rows[0];
    return {
      playerId: w.playerId,
      currency: w.currency,
      balance: w.balance,
      electricityPerSecond: w.electricityPerSecond,
      lastClaimedAt: w.lastClaimedAt.toISOString(),
    };
  },

  async adjustBalance(params: AdjustBalanceParams): Promise<{ balanceAfter: number; success: boolean }> {
    const db = getDb();
    const { playerId, amount, source, idempotencyKey, currency = 'electricity', reason = '', referenceType = '', referenceId = '' } = params;

    return db.transaction(async (tx) => {
      // 1. 멱등성 검사
      const existing = await tx.select().from(currencyLedger)
        .where(eq(currencyLedger.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing.length > 0) {
        return { balanceAfter: existing[0].balanceAfter, success: false };
      }

      // 2. 현재 잔액 조회
      const rows = await tx.select().from(walletBalances)
        .where(eq(walletBalances.playerId, playerId))
        .limit(1);
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
      }
      await tx.update(walletBalances)
        .set(setData)
        .where(eq(walletBalances.playerId, playerId));

      // 4. 원장 기록
      try {
        await tx.insert(currencyLedger).values({
          id: crypto.randomUUID(),
          playerId,
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
      } catch (err) {
        if ((err as { errno?: number }).errno === 1062) { // ER_DUP_ENTRY
          const dup = await tx.select().from(currencyLedger)
            .where(eq(currencyLedger.idempotencyKey, idempotencyKey))
            .limit(1);
          if (dup.length > 0) {
            return { balanceAfter: dup[0].balanceAfter, success: false };
          }
        }
        throw err;
      }

      logger.info({ playerId, amount, balanceAfter, source, event: 'balance_adjust' }, 'Balance adjusted');
      return { balanceAfter, success: true };
    });
  },

  async updateEps(playerId: string, newEps: number): Promise<void> {
    const db = getDb();
    await db.update(walletBalances)
      .set({ electricityPerSecond: newEps, updatedAt: new Date() })
      .where(eq(walletBalances.playerId, playerId));
  },

  async updateLastClaimedAt(playerId: string, claimedAt: string): Promise<void> {
    const db = getDb();
    await db.update(walletBalances)
      .set({ lastClaimedAt: new Date(claimedAt), updatedAt: new Date() })
      .where(eq(walletBalances.playerId, playerId));
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
      createdAt: r.createdAt.toISOString(),
    }));
  },
};
