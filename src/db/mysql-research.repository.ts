/**
 * MySQL 기반 연구 저장소
 */
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from './connection.js';
import { playerResearch, walletBalances, currencyLedger } from './schema.js';
import type { PlayerResearch } from '../types.js';
import type { ResearchRepository } from '../repository.js';
import { getResearchNode } from '../data/research.js';
import { AppError } from '../shared/errors.js';
import { researchLedgerKey } from '../shared/research-ledger.js';
function rowToResearch(row: typeof playerResearch.$inferSelect): PlayerResearch {
  return {
    id: row.id, playerId: row.playerId, code: row.code,
    level: row.level, completed: row.completed as 0 | 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const mysqlResearchRepo: ResearchRepository = {
  async getAll(playerId: string): Promise<PlayerResearch[]> {
    const db = getDb();
    const rows = await db.select().from(playerResearch).where(eq(playerResearch.playerId, playerId));
    return rows.map(rowToResearch);
  },

  async get(playerId: string, code: string): Promise<PlayerResearch | null> {
    const db = getDb();
    const rows = await db.select().from(playerResearch)
      .where(and(eq(playerResearch.playerId, playerId), eq(playerResearch.code, code)))
      .limit(1);
    return rows.length > 0 ? rowToResearch(rows[0]) : null;
  },

  async levelUp(playerId: string, code: string, requestKey: string) {
    const db = getDb();
    const node = getResearchNode(code);
    if (!node) throw new AppError('존재하지 않는 연구입니다.', 404, 'RESEARCH_NOT_FOUND');

    return db.transaction(async (tx) => {
      const wallets = await tx.select().from(walletBalances)
        .where(eq(walletBalances.playerId, playerId))
        .limit(1)
        .for('update');
      if (wallets.length === 0) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
      const wallet = wallets[0];

      const allResearch = await tx.select().from(playerResearch).where(eq(playerResearch.playerId, playerId));
      for (const prerequisite of node.prerequisites) {
        const parent = allResearch.find((record) => record.code === prerequisite.code);
        if (!parent || parent.level < prerequisite.level) {
          throw new AppError(`선행 연구가 필요합니다: ${prerequisite.code} Lv.${prerequisite.level}`, 400, 'PREREQUISITE_NOT_MET');
        }
      }

      const record = allResearch.find((item) => item.code === code);
      const nextLevel = (record?.level || 0) + 1;
      if (nextLevel > node.maxLevel) throw new AppError('이미 최대 레벨입니다.', 400, 'MAX_LEVEL');
      const cost = node.costPerLevel(nextLevel);
      const currencies = (['electricity', 'scrap'] as const).filter((currency) => (cost[currency] || 0) > 0);
      const ledgerKeys = currencies.map((currency) => researchLedgerKey(playerId, requestKey, code, currency));
      if (ledgerKeys.length > 0) {
        const previousEntries = await tx.select().from(currencyLedger)
          .where(inArray(currencyLedger.idempotencyKey, ledgerKeys));
        if (previousEntries.length > 0) throw new AppError('연구 비용 요청이 이미 처리되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
      }

      let electricity = wallet.electricity;
      let scrap = wallet.scrap;
      for (const currency of currencies) {
        const amount = cost[currency]!;
        const currentBalance = currency === 'electricity' ? electricity : scrap;
        if (currentBalance < amount) throw new AppError('잔액이 부족합니다.', 400, 'INSUFFICIENT_BALANCE');
        if (currency === 'electricity') electricity -= amount;
        else scrap -= amount;
      }

      const now = new Date();
      await tx.update(walletBalances)
        .set({ electricity, balance: electricity, scrap, updatedAt: now })
        .where(eq(walletBalances.playerId, playerId));

      for (let index = 0; index < currencies.length; index += 1) {
        const currency = currencies[index];
        const amount = cost[currency]!;
        const balanceAfter = currency === 'electricity' ? electricity : scrap;
        await tx.insert(currencyLedger).values({
          id: crypto.randomUUID(),
          playerId,
          userId: wallet.userId,
          currency,
          amount: -amount,
          balanceAfter,
          source: 'research',
          reason: `${node.name} Lv.${nextLevel}`,
          referenceType: 'research',
          referenceId: code,
          idempotencyKey: ledgerKeys[index],
          requestHash: '',
          createdAt: now,
        });
      }

      const updatedLevel = record
        ? { ...rowToResearch(record), level: nextLevel, completed: nextLevel >= node.maxLevel ? 1 as const : 0 as const, updatedAt: now.toISOString() }
        : {
            id: crypto.randomUUID(), playerId, code, level: nextLevel,
            completed: nextLevel >= node.maxLevel ? 1 as const : 0 as const,
            createdAt: now.toISOString(), updatedAt: now.toISOString(),
          };
      if (record) {
        await tx.update(playerResearch)
          .set({ level: nextLevel, completed: updatedLevel.completed, updatedAt: now })
          .where(eq(playerResearch.id, record.id));
      } else {
        await tx.insert(playerResearch).values({
          id: updatedLevel.id, playerId, code, level: nextLevel,
          completed: updatedLevel.completed, createdAt: now, updatedAt: now,
        });
      }

      return { research: updatedLevel, cost };
    });
  },

  async reset(playerId: string): Promise<void> {
    const db = getDb();
    await db.delete(playerResearch).where(eq(playerResearch.playerId, playerId));
  },
};
