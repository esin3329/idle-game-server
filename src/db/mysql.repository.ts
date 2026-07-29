import { eq } from 'drizzle-orm';
import { getDb } from './connection.js';
import { players, walletBalances } from './schema.js';
import type { Player } from '../types.js';
import type { PlayerRepository } from '../repository.js';

/**
 * PlayerRepository 의 MySQL 구현체
 *
 * 동시성 전략:
 * - 잔액 변경: UPDATE ... SET balance = balance + ? (원자적)
 * - 원장 기록: INSERT + idempotency_key UNIQUE 제약
 * - 읽기 일관성: SELECT ... FOR UPDATE (트랜잭션 내)
 * - 사전 조회 후 판단 방식은 사용하지 않음
 */
export const mysqlPlayerRepo: PlayerRepository = {
  async createPlayer(player: Player): Promise<Player> {
    const db = getDb();
    await db.insert(players).values({
      id: player.id,
      nickname: player.nickname,
      apiKey: player.apiKey,
      electricity: player.electricity,
      electricityPerSecond: player.electricityPerSecond,
      lastClaimedAt: new Date(player.lastClaimedAt),
      createdAt: new Date(player.createdAt),
      updatedAt: new Date(player.updatedAt),
    });

    // 지갑 초기화
    await db.insert(walletBalances).values({
      id: crypto.randomUUID(),
      playerId: player.id,
      userId: player.id, // 초기: player.id = user.id (향후 users 연동)
      electricity: player.electricity,
      electricityPerSecond: player.electricityPerSecond,
      balance: player.electricity,
      lastClaimedAt: new Date(player.lastClaimedAt),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return player;
  },

  async getPlayer(id: string): Promise<Player | undefined> {
    const db = getDb();
    const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      id: row.id,
      nickname: row.nickname,
      apiKey: row.apiKey,
      electricity: row.electricity,
      electricityPerSecond: row.electricityPerSecond,
      lastClaimedAt: row.lastClaimedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  async getAllPlayers(): Promise<Player[]> {
    const db = getDb();
    const rows = await db.select().from(players);
    return rows.map((row) => ({
      id: row.id,
      nickname: row.nickname,
      apiKey: row.apiKey,
      electricity: row.electricity,
      electricityPerSecond: row.electricityPerSecond,
      lastClaimedAt: row.lastClaimedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },

  async updatePlayer(id: string, updates: Partial<Player>): Promise<Player | undefined> {
    const db = getDb();
    const { id: _id, apiKey: _apiKey, createdAt: _createdAt, ...safe } = updates as Record<string, unknown>;

    const setData: Record<string, unknown> = { updatedAt: new Date() };
    if (safe.electricity !== undefined) setData.electricity = safe.electricity;
    if (safe.electricityPerSecond !== undefined) setData.electricityPerSecond = safe.electricityPerSecond;
    if (safe.lastClaimedAt !== undefined) setData.lastClaimedAt = new Date(safe.lastClaimedAt as string);
    if (safe.nickname !== undefined) setData.nickname = safe.nickname;

    await db.update(players).set(setData).where(eq(players.id, id));
    return this.getPlayer(id);
  },

  async deletePlayer(id: string): Promise<boolean> {
    const db = getDb();
    const result = await db.delete(players).where(eq(players.id, id));
    return result[0].affectedRows > 0;
  },
};

// adjustBalance는 wallet.ts에서 MySQL 트랜잭션으로 구현됨
