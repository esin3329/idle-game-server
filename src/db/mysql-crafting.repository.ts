/**
 * MySQL 기반 제작(Crafting) 저장소
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from './connection.js';
import { playerBlueprints, craftingQueue } from './schema.js';
import type { PlayerBlueprint, PartCrafting } from '../types.js';
import type { CraftingRepository } from '../repository.js';
import { getBlueprint } from '../data/crafting.js';

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
    return { id, playerId, blueprintCode, acquiredAt: now.toISOString() };
  },

  async getQueue(playerId: string): Promise<PartCrafting[]> {
    const db = getDb();
    const rows = await db.select().from(craftingQueue).where(eq(craftingQueue.playerId, playerId));
    return rows.map(rowToCraft);
  },

  async startCraft(playerId: string, blueprintCode: string): Promise<PartCrafting> {
    const db = getDb();
    const bpData = getBlueprint(blueprintCode);
    if (!bpData) throw new Error('UNKNOWN_BLUEPRINT');

    const now = new Date();
    const completesAt = new Date(now.getTime() + bpData.craftSeconds * 1000);
    const id = crypto.randomUUID();
    await db.insert(craftingQueue).values({
      id, playerId, resultCode: bpData.partCode,
      materials: JSON.stringify(bpData.materials),
      startedAt: now, completesAt, completed: 0, createdAt: now,
    });
    return {
      id, playerId, resultCode: bpData.partCode,
      materials: JSON.stringify(bpData.materials),
      startedAt: now.toISOString(), completesAt: completesAt.toISOString(),
      completed: 0, createdAt: now.toISOString(),
    };
  },

  async completeCraft(playerId: string, craftId: string): Promise<{ partId: string; partCode: string }> {
    const db = getDb();
    const rows = await db.select().from(craftingQueue).where(eq(craftingQueue.id, craftId)).limit(1);
    if (rows.length === 0 || rows[0].playerId !== playerId) throw new Error('CRAFT_NOT_FOUND');
    const craft = rows[0];
    if (new Date(craft.completesAt).getTime() > Date.now()) throw new Error('CRAFT_NOT_READY');
    if (craft.completed) throw new Error('ALREADY_COMPLETED');

    await db.update(craftingQueue).set({ completed: 1 }).where(eq(craftingQueue.id, craftId));

    // 파츠 지급
    const partId = crypto.randomUUID();
    const { mysqlPartsRepo } = await import('./mysql-parts.repository.js');
    await mysqlPartsRepo.grantPart(playerId, craft.resultCode, craft.resultCode.startsWith('bp_') ? 'module' : 'weapon');
    // partType 추론: data/crafting.ts의 BlueprintData 사용
    const bpData = getBlueprintByCodeFromDb(craft.resultCode);
    if (bpData) {
      await mysqlPartsRepo.grantPart(playerId, craft.resultCode, bpData.partType);
    }

    return { partId, partCode: craft.resultCode };
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

function getBlueprintByCodeFromDb(resultCode: string) {
  const { BLUEPRINTS } = require('../data/crafting.js');
  return BLUEPRINTS.find((b: { partCode: string }) => b.partCode === resultCode);
}
