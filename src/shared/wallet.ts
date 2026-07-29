import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { walletBalances, currencyLedger } from '../db/schema.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export interface BalanceResult {
  playerId: string;
  currency: string;
  balance: number;
  electricityPerSecond: number;
  lastClaimedAt: string;
}

export interface LedgerEntry {
  id: string;
  playerId: string;
  currency: string;
  amount: number;
  balanceAfter: number;
  source: string;
  createdAt: string;
}

// ─── 잔액 조회 ──────────────────────────────────────

export async function getBalance(playerId: string): Promise<BalanceResult | null> {
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
}

// ─── 원자적 잔액 증감 + 원장 기록 ──────────────────

export async function adjustBalance(
  playerId: string,
  amount: number,
  source: string,
  idempotencyKey: string,
  currency = 'electricity',
  reason = '',
  referenceType = '',
  referenceId = '',
): Promise<{ balanceAfter: number; success: boolean }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // 1. 멱등성 검사 (애플리케이션 레벨)
    const existing = await tx.select().from(currencyLedger)
      .where(eq(currencyLedger.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing.length > 0) {
      return { balanceAfter: existing[0].balanceAfter, success: false };
    }

    // 2. 현재 잔액 조회 (트랜잭션 내부 → UPDATE 시 implicit row lock)
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

    // 4. 원장 기록 (DB UNIQUE 제약이 2차 방어)
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
}

// ─── EPS 갱신 (업그레이드) ──────────────────────────

export async function updateEps(playerId: string, newEps: number): Promise<void> {
  const db = getDb();
  await db.update(walletBalances)
    .set({ electricityPerSecond: newEps, updatedAt: new Date() })
    .where(eq(walletBalances.playerId, playerId));
}

// ─── lastClaimedAt 갱신 ─────────────────────────────

export async function updateLastClaimedAt(playerId: string, claimedAt: Date): Promise<void> {
  const db = getDb();
  await db.update(walletBalances)
    .set({ lastClaimedAt: claimedAt, updatedAt: new Date() })
    .where(eq(walletBalances.playerId, playerId));
}

// ─── 원장 조회 ──────────────────────────────────────

export async function getLedger(playerId: string, limit = 50): Promise<LedgerEntry[]> {
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
}
