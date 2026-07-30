/**
 * MySQL 기반 연구 저장소
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from './connection.js';
import { playerResearch } from './schema.js';
import type { PlayerResearch } from '../types.js';
import type { ResearchRepository } from '../repository.js';
import { getResearchNode } from '../data/research.js';

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

  async levelUp(playerId: string, code: string): Promise<PlayerResearch> {
    const db = getDb();
    const node = getResearchNode(code);
    if (!node) throw new Error(`Unknown research: ${code}`);

    const existing = await db.select().from(playerResearch)
      .where(and(eq(playerResearch.playerId, playerId), eq(playerResearch.code, code)))
      .limit(1);

    if (existing.length === 0) {
      // 새 연구 생성 (level=1)
      const now = new Date();
      const id = crypto.randomUUID();
      await db.insert(playerResearch).values({ id, playerId, code, level: 1, completed: node.maxLevel <= 1 ? 1 : 0, createdAt: now, updatedAt: now });
      return { id, playerId, code, level: 1, completed: node.maxLevel <= 1 ? 1 : 0, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    }

    const row = existing[0];
    if (row.level >= node.maxLevel) throw new Error('MAX_LEVEL');

    const newLevel = row.level + 1;
    await db.update(playerResearch)
      .set({ level: newLevel, completed: newLevel >= node.maxLevel ? 1 : 0, updatedAt: new Date() })
      .where(eq(playerResearch.id, row.id));

    return { ...rowToResearch(row), level: newLevel, completed: newLevel >= node.maxLevel ? 1 : 0 };
  },

  async reset(playerId: string): Promise<void> {
    const db = getDb();
    await db.delete(playerResearch).where(eq(playerResearch.playerId, playerId));
  },
};
