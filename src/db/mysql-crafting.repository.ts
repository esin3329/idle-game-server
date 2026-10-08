/**
 * MySQL 기반 제작(Crafting) 저장소
 */
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from './connection.js';
import { playerBlueprints, craftingQueue, itemLedger, partsInventory, walletBalances, currencyLedger } from './schema.js';
import type { PlayerBlueprint, PartCrafting } from '../types.js';
import type { CraftingRepository } from '../repository.js';
import { getBlueprint, BLUEPRINTS } from '../data/crafting.js';
import { AppError } from '../shared/errors.js';
import { craftingCurrencyLedgerKey, craftingItemLedgerKey, craftingRequestKey } from '../shared/crafting-ledger.js';
function rowToBp(row: typeof playerBlueprints.$inferSelect): PlayerBlueprint {
  return { id: row.id, playerId: row.playerId, blueprintCode: row.blueprintCode, acquiredAt: row.acquiredAt.toISOString() };
}

function rowToCraft(row: typeof craftingQueue.$inferSelect): PartCrafting {
  return {
    id: row.id, playerId: row.playerId, resultCode: row.resultCode,
    materials: row.materials, startedAt: row.startedAt.toISOString(),
    completesAt: row.completesAt.toISOString(),
    completed: row.completed as 0 | 1, createdAt: row.createdAt.toISOString(),
  };
}

export const mysqlCraftingRepo: CraftingRepository = {
  async getBlueprints(playerId: string): Promise<PlayerBlueprint[]> {
    const db = getDb();
    const rows = await db.select().from(playerBlueprints).where(eq(playerBlueprints.playerId, playerId));
    return rows.map(rowToBp);
  },

  async hasBlueprint(playerId: string, blueprintCode: string): Promise<boolean> {
    const db = getDb();
    const rows = await db.select({ id: playerBlueprints.id }).from(playerBlueprints)
      .where(and(eq(playerBlueprints.playerId, playerId), eq(playerBlueprints.blueprintCode, blueprintCode)))
      .limit(1);
    return rows.length > 0;
  },

  async grantBlueprint(playerId: string, blueprintCode: string): Promise<PlayerBlueprint> {
    const db = getDb();
    const now = new Date();
    const id = crypto.randomUUID();
    await db.insert(playerBlueprints).values({ id, playerId, blueprintCode, acquiredAt: now });
    // 아이템 원장 기록
    await db.insert(itemLedger as any).values({
      id: crypto.randomUUID(), playerId, userId: playerId,
      itemType: 'blueprint', itemId: blueprintCode, quantity: 1,
      source: 'drop', referenceType: 'blueprint', referenceId: id,
      idempotencyKey: '', createdAt: now,
    });
    return { id, playerId, blueprintCode, acquiredAt: now.toISOString() };
  },

  async getQueue(playerId: string): Promise<PartCrafting[]> {
    const db = getDb();
    const rows = await db.select().from(craftingQueue).where(eq(craftingQueue.playerId, playerId));
    return rows.map(rowToCraft);
  },

  async startCraft(playerId: string, blueprintCode: string, requestKey: string): Promise<PartCrafting> {
    const db = getDb();
    const bpData = getBlueprint(blueprintCode);
    if (!bpData) throw new AppError('존재하지 않는 설계도입니다.', 404, 'BLUEPRINT_NOT_FOUND');
    const idempotencyKey = craftingRequestKey(playerId, requestKey);

    return db.transaction(async (tx) => {
      const wallets = await tx.select().from(walletBalances)
        .where(eq(walletBalances.playerId, playerId))
        .limit(1)
        .for('update');
      if (wallets.length === 0) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
      const wallet = wallets[0];

      const existing = await tx.select().from(craftingQueue)
        .where(eq(craftingQueue.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing.length > 0) {
        if (existing[0].playerId !== playerId || existing[0].resultCode !== bpData.partCode) {
          throw new AppError('동일한 키가 다른 제작 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
        }
        return rowToCraft(existing[0]);
      }

      const blueprints = await tx.select().from(playerBlueprints)
        .where(and(eq(playerBlueprints.playerId, playerId), eq(playerBlueprints.blueprintCode, blueprintCode)))
        .limit(1)
        .for('update');
      if (blueprints.length === 0) throw new AppError('설계도를 보유하지 않았습니다.', 400, 'BLUEPRINT_NOT_OWNED');

      const outputPart = await tx.select({ id: partsInventory.id }).from(partsInventory)
        .where(and(eq(partsInventory.playerId, playerId), eq(partsInventory.partCode, bpData.partCode)))
        .limit(1)
        .for('update');
      if (outputPart.length > 0) throw new AppError('이미 보유한 파츠는 제작할 수 없습니다.', 409, 'PART_ALREADY_OWNED');

      const partMaterials = Object.entries(bpData.materials).filter(([code]) => code !== 'scrap');
      const partCodes = partMaterials.map(([code]) => code);
      const partRows = partCodes.length > 0
        ? await tx.select().from(partsInventory)
            .where(and(eq(partsInventory.playerId, playerId), inArray(partsInventory.partCode, partCodes)))
            .for('update')
        : [];
      const partsByCode = new Map(partRows.map((part) => [part.partCode, part]));
      for (const [partCode, quantity] of partMaterials) {
        const part = partsByCode.get(partCode);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1 || !part || part.equipped) {
          throw new AppError(`제작 재료가 부족합니다: ${partCode}`, 400, 'INSUFFICIENT_MATERIALS');
        }
      }

      const scrapCost = bpData.materials.scrap || 0;
      if (!Number.isSafeInteger(scrapCost) || scrapCost < 0 || wallet.scrap < scrapCost) {
        throw new AppError('스크랩이 부족합니다.', 400, 'INSUFFICIENT_BALANCE');
      }

      const now = new Date();
      const id = crypto.randomUUID();
      const completesAt = new Date(now.getTime() + bpData.craftSeconds * 1000);
      const scrapAfter = wallet.scrap - scrapCost;
      if (scrapCost > 0) {
        await tx.update(walletBalances)
          .set({ scrap: scrapAfter, updatedAt: now })
          .where(eq(walletBalances.playerId, playerId));
        await tx.insert(currencyLedger).values({
          id: crypto.randomUUID(),
          playerId,
          userId: wallet.userId,
          currency: 'scrap',
          amount: -scrapCost,
          balanceAfter: scrapAfter,
          source: 'craft',
          reason: `${blueprintCode} 제작 비용`,
          referenceType: 'craft',
          referenceId: id,
          idempotencyKey: craftingCurrencyLedgerKey(idempotencyKey, 'scrap'),
          requestHash: '',
          createdAt: now,
        });
      }

      for (const [partCode] of partMaterials) {
        const part = partsByCode.get(partCode)!;
        await tx.delete(partsInventory).where(eq(partsInventory.id, part.id));
        await tx.insert(itemLedger).values({
          id: crypto.randomUUID(),
          playerId,
          userId: wallet.userId,
          itemType: 'part',
          itemId: partCode,
          quantity: -1,
          source: 'craft_consume',
          referenceType: 'craft',
          referenceId: id,
          idempotencyKey: craftingItemLedgerKey(idempotencyKey, partCode),
          createdAt: now,
        });
      }

      await tx.insert(craftingQueue).values({
        id, playerId, resultCode: bpData.partCode,
        materials: JSON.stringify(bpData.materials),
        startedAt: now, completesAt, completed: 0, createdAt: now, idempotencyKey,
      });
      return {
        id, playerId, resultCode: bpData.partCode,
        materials: JSON.stringify(bpData.materials),
        startedAt: now.toISOString(), completesAt: completesAt.toISOString(),
        completed: 0, createdAt: now.toISOString(),
      };
    });
  },

  async completeCraft(playerId: string, craftId: string): Promise<{ partId: string; partCode: string }> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(craftingQueue)
        .where(eq(craftingQueue.id, craftId))
        .limit(1)
        .for('update');
      if (rows.length === 0 || rows[0].playerId !== playerId) {
        throw new AppError('제작 내역을 찾을 수 없습니다.', 404, 'CRAFT_NOT_FOUND');
      }
      const craft = rows[0];
      if (craft.completesAt.getTime() > Date.now()) {
        throw new AppError('아직 제작이 완료되지 않았습니다.', 400, 'CRAFT_NOT_READY');
      }
      if (craft.completed) throw new AppError('이미 완료된 제작입니다.', 409, 'ALREADY_COMPLETED');

      const blueprint = BLUEPRINTS.find((entry) => entry.partCode === craft.resultCode);
      if (!blueprint) throw new AppError('제작 결과 파츠를 찾을 수 없습니다.', 500, 'UNKNOWN_CRAFT_RESULT');
      const existingPart = await tx.select({ id: partsInventory.id }).from(partsInventory)
        .where(and(eq(partsInventory.playerId, playerId), eq(partsInventory.partCode, craft.resultCode)))
        .limit(1)
        .for('update');
      if (existingPart.length > 0) throw new AppError('이미 보유한 파츠는 제작할 수 없습니다.', 409, 'PART_ALREADY_OWNED');
      const wallets = await tx.select({ userId: walletBalances.userId }).from(walletBalances)
        .where(eq(walletBalances.playerId, playerId))
        .limit(1);
      if (wallets.length === 0) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');

      const now = new Date();
      const partId = crypto.randomUUID();
      await tx.insert(partsInventory).values({
        id: partId, playerId, partCode: craft.resultCode, partType: blueprint.partType,
        level: 1, equipped: 0, createdAt: now,
      });
      await tx.insert(itemLedger).values({
        id: crypto.randomUUID(), playerId, userId: wallets[0].userId,
        itemType: 'part', itemId: craft.resultCode, quantity: 1,
        source: 'craft', referenceType: 'craft', referenceId: craftId,
        idempotencyKey: craftingItemLedgerKey(craftId, craft.resultCode), createdAt: now,
      });
      await tx.update(craftingQueue)
        .set({ completed: 1 })
        .where(and(eq(craftingQueue.id, craftId), eq(craftingQueue.playerId, playerId), eq(craftingQueue.completed, 0)));

      return { partId, partCode: craft.resultCode };
    });
  },

  async getCompletable(playerId: string): Promise<PartCrafting[]> {
    const db = getDb();
    const now = new Date();
    const rows = await db.select().from(craftingQueue)
      .where(and(eq(craftingQueue.playerId, playerId), eq(craftingQueue.completed, 0)))
      .then((all) => all.filter((r) => r.completesAt <= now));
    return rows.map(rowToCraft);
  },
};
