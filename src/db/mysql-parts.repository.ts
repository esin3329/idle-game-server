/**
 * MySQL 기반 파츠 저장소
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from './connection.js';
import { partsInventory, equipSlots, mechaConfigs, itemLedger } from './schema.js';
import type { PlayerPart, EquipSlot, MechaConfig } from '../types.js';
import type { PartsRepository, MechaConfigRepository } from '../repository.js';

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
    // 아이템 원장 기록
    await db.insert(itemLedger as any).values({
      id: crypto.randomUUID(), playerId, userId: playerId,
      itemType: 'part', itemId: partCode, quantity: 1,
      source: 'grant', referenceType: 'part', referenceId: id,
      idempotencyKey: '', createdAt: now,
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

// ─── MechaConfigRepository ─────────────────────────

function rowToConfig(row: typeof mechaConfigs.$inferSelect): MechaConfig {
  return {
    id: row.id, playerId: row.playerId, name: row.name,
    frame: row.frame, weapon: row.weapon, core: row.core, module: row.module,
    isActive: row.isActive as 0 | 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const mysqlMechaConfigRepo: MechaConfigRepository = {
  async getConfigs(playerId: string): Promise<MechaConfig[]> {
    const db = getDb();
    const rows = await db.select().from(mechaConfigs).where(eq(mechaConfigs.playerId, playerId));
    return rows.map(rowToConfig);
  },

  async createConfig(playerId: string, name: string, frame: string, weapon: string, core: string, module: string): Promise<MechaConfig> {
    const db = getDb();
    const now = new Date();
    const id = crypto.randomUUID();
    await db.insert(mechaConfigs).values({ id, playerId, name, frame, weapon, core, module, isActive: 0, createdAt: now, updatedAt: now });
    return { id, playerId, name, frame, weapon, core, module, isActive: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  },

  async updateConfig(id: string, updates: Partial<Omit<MechaConfig, 'id' | 'playerId' | 'createdAt'>>): Promise<MechaConfig | null> {
    const db = getDb();
    const existing = await db.select().from(mechaConfigs).where(eq(mechaConfigs.id, id)).limit(1);
    if (existing.length === 0) return null;
    const setData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) setData.name = updates.name;
    if (updates.frame !== undefined) setData.frame = updates.frame;
    if (updates.weapon !== undefined) setData.weapon = updates.weapon;
    if (updates.core !== undefined) setData.core = updates.core;
    if (updates.module !== undefined) setData.module = updates.module;
    if (updates.isActive !== undefined) setData.isActive = updates.isActive;
    await db.update(mechaConfigs).set(setData).where(eq(mechaConfigs.id, id));
    const updated = await db.select().from(mechaConfigs).where(eq(mechaConfigs.id, id)).limit(1);
    return updated.length > 0 ? rowToConfig(updated[0]) : null;
  },

  async activateConfig(id: string, playerId: string): Promise<MechaConfig | null> {
    const db = getDb();
    const target = await db.select().from(mechaConfigs).where(eq(mechaConfigs.id, id)).limit(1);
    if (target.length === 0 || target[0].playerId !== playerId) return null;
    const now = new Date();
    // 전체 비활성화
    await db.update(mechaConfigs).set({ isActive: 0, updatedAt: now }).where(eq(mechaConfigs.playerId, playerId));
    // 대상 활성화
    await db.update(mechaConfigs).set({ isActive: 1, updatedAt: now }).where(eq(mechaConfigs.id, id));
    const updated = await db.select().from(mechaConfigs).where(eq(mechaConfigs.id, id)).limit(1);
    return updated.length > 0 ? rowToConfig(updated[0]) : null;
  },

  async deleteConfig(id: string, _playerId: string): Promise<boolean> {
    const db = getDb();
    const target = await db.select({ id: mechaConfigs.id }).from(mechaConfigs)
      .where(eq(mechaConfigs.id, id)).limit(1);
    if (target.length === 0) return false;
    await db.delete(mechaConfigs).where(eq(mechaConfigs.id, id));
    return true;
  },

  async getActiveConfig(playerId: string): Promise<MechaConfig | null> {
    const db = getDb();
    const rows = await db.select().from(mechaConfigs)
      .where(eq(mechaConfigs.playerId, playerId)).limit(1);
    return rows.length > 0 ? rowToConfig(rows[0]) : null;
  },
};
