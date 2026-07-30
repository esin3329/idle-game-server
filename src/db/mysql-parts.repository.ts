/**
 * MySQL 기반 파츠 저장소
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from './connection.js';
import { partsInventory, equipSlots } from './schema.js';
import type { PlayerPart, EquipSlot } from '../types.js';
import type { PartsRepository } from '../repository.js';

function rowToPart(row: typeof partsInventory.$inferSelect): PlayerPart {
  return {
    id: row.id, playerId: row.playerId,
    partCode: row.partCode, partType: row.partType as PlayerPart['partType'],
    level: row.level, equipped: row.equipped as 0 | 1,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToEquip(row: typeof equipSlots.$inferSelect): EquipSlot {
  return {
    id: row.id, playerId: row.playerId, frame: row.frame, weapon: row.weapon,
    core: row.core, module: row.module,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const mysqlPartsRepo: PartsRepository = {
  async getInventory(playerId: string): Promise<PlayerPart[]> {
    const db = getDb();
    const rows = await db.select().from(partsInventory)
      .where(eq(partsInventory.playerId, playerId));
    return rows.map(rowToPart);
  },

  async hasPart(playerId: string, partCode: string): Promise<boolean> {
    const db = getDb();
    const rows = await db.select({ id: partsInventory.id }).from(partsInventory)
      .where(and(eq(partsInventory.playerId, playerId), eq(partsInventory.partCode, partCode)))
      .limit(1);
    return rows.length > 0;
  },

  async grantPart(playerId: string, partCode: string, partType: string): Promise<PlayerPart> {
    const db = getDb();
    const now = new Date();
    const id = crypto.randomUUID();
    await db.insert(partsInventory).values({
      id, playerId, partCode,
      partType: partType,
      level: 1, equipped: 0,
      createdAt: now,
    });
    return { id, playerId, partCode, partType: partType as PlayerPart['partType'], level: 1, equipped: 0, createdAt: now.toISOString() };
  },

  async equipPart(playerId: string, partCode: string, partType: string): Promise<void> {
    const db = getDb();
    // 같은 타입 기존 장착 해제
    await db.update(partsInventory)
      .set({ equipped: 0 })
      .where(and(eq(partsInventory.playerId, playerId), eq(partsInventory.partType, partType)));

    // 새 파츠 장착
    await db.update(partsInventory)
      .set({ equipped: 1 })
      .where(and(eq(partsInventory.playerId, playerId), eq(partsInventory.partCode, partCode)));

    // equip_slots 갱신
    const now = new Date();
    const existing = await db.select({ playerId: equipSlots.playerId }).from(equipSlots)
      .where(eq(equipSlots.playerId, playerId)).limit(1);

    const updateData: Record<string, unknown> = { updatedAt: now };
    updateData[partType] = partCode;

    if (existing.length > 0) {
      await db.update(equipSlots).set(updateData).where(eq(equipSlots.playerId, playerId));
    } else {
      await db.insert(equipSlots).values({
        id: playerId, playerId, frame: 'medium_frame', weapon: 'machine_gun',
        core: 'assault_core', module: 'power_module',
        ...updateData, updatedAt: now,
      } as typeof equipSlots.$inferInsert);
    }
  },

  async getEquipped(playerId: string): Promise<EquipSlot | null> {
    const db = getDb();
    const rows = await db.select().from(equipSlots).where(eq(equipSlots.playerId, playerId)).limit(1);
    return rows.length > 0 ? rowToEquip(rows[0]) : null;
  },

  async upgradePart(playerId: string, partCode: string): Promise<PlayerPart> {
    const db = getDb();
    const rows = await db.select().from(partsInventory)
      .where(and(eq(partsInventory.playerId, playerId), eq(partsInventory.partCode, partCode)))
      .limit(1);
    if (rows.length === 0) throw new Error('Part not found');
    const newLevel = rows[0].level + 1;
    await db.update(partsInventory)
      .set({ level: newLevel })
      .where(eq(partsInventory.id, rows[0].id));
    return { ...rowToPart(rows[0]), level: newLevel };
  },
};
