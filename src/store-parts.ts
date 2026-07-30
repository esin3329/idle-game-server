/**
 * JSON 파일 기반 파츠 저장소 (개발/테스트용)
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerPart, EquipSlot, MechaConfig } from './types.js';
import type { PartsRepository, MechaConfigRepository } from './repository.js';
import { logger } from './shared/logger.js';

const partsFile = process.env.DATA_FILE_PARTS || join(process.cwd(), 'data-parts.json');
const equipFile = process.env.DATA_FILE_EQUIP || join(process.cwd(), 'data-equip.json');
const configsFile = process.env.DATA_FILE_CONFIGS || join(process.cwd(), 'data-configs.json');

let parts = new Map<string, PlayerPart>();
let equips = new Map<string, EquipSlot>();
let configs = new Map<string, MechaConfig>();
let _initialized = false;

function loadMap<T extends { id: string }>(fp: string, name: string): Map<string, T> {
  if (!existsSync(fp)) return new Map();
  try {
    const arr: T[] = JSON.parse(readFileSync(fp, 'utf-8'));
    return new Map(Array.isArray(arr) ? arr.map((i) => [i.id, i]) : []);
  } catch (err) {
    logger.error({ operation: 'load', file: fp, name, err: (err as Error).message }, `Failed to load ${name}`);
    return new Map();
  }
}

function saveMap<T extends { id: string }>(map: Map<string, T>, fp: string, name: string): void {
  const tmp = fp + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(Array.from(map.values()), null, 2), 'utf-8');
    JSON.parse(readFileSync(tmp, 'utf-8'));
    if (existsSync(fp)) copyFileSync(fp, fp + '.bak');
    renameSync(tmp, fp);
  } catch (err) {
    logger.error({ operation: 'save', file: fp, name, err: (err as Error).message }, `Failed to save ${name}`);
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* skip */ }
  }
}

function ensure(): void {
  if (!_initialized) {
    _initialized = true;
    parts = loadMap<PlayerPart>(partsFile, 'parts');
    equips = loadMap<EquipSlot>(equipFile, 'equips');
    configs = loadMap<MechaConfig>(configsFile, 'configs');
  }
}

function getDefaultEquip(playerId: string): EquipSlot {
  return { id: playerId, playerId, frame: 'medium_frame', weapon: 'machine_gun', core: 'assault_core', module: 'power_module', updatedAt: new Date().toISOString() };
}

export const jsonPartsRepo: PartsRepository = {
  async getInventory(playerId: string): Promise<PlayerPart[]> {
    ensure();
    return Array.from(parts.values()).filter((p) => p.playerId === playerId);
  },

  async hasPart(playerId: string, partCode: string): Promise<boolean> {
    ensure();
    return Array.from(parts.values()).some((p) => p.playerId === playerId && p.partCode === partCode);
  },

  async grantPart(playerId: string, partCode: string, partType: string): Promise<PlayerPart> {
    ensure();
    const part: PlayerPart = {
      id: crypto.randomUUID(), playerId, partCode,
      partType: partType as PlayerPart['partType'],
      level: 1, equipped: 0, createdAt: new Date().toISOString(),
    };
    parts.set(part.id, part);
    saveMap(parts, partsFile, 'parts');
    return part;
  },

  async equipPart(playerId: string, partCode: string, partType: string): Promise<void> {
    ensure();
    // 해당 타입의 기존 장착 해제
    for (const p of parts.values()) {
      if (p.playerId === playerId && p.partType === partType && p.equipped) {
        p.equipped = 0;
        parts.set(p.id, p);
      }
    }
    // 새 파츠 장착
    const target = Array.from(parts.values()).find((p) => p.playerId === playerId && p.partCode === partCode);
    if (target) {
      target.equipped = 1;
      parts.set(target.id, target);
    }
    saveMap(parts, partsFile, 'parts');

    // equip_slot 갱신
    const slot = equips.get(playerId) || getDefaultEquip(playerId);
    const slotObj = slot as unknown as Record<string, unknown>;
    slotObj[partType] = partCode;
    slot.updatedAt = new Date().toISOString();
    equips.set(playerId, slot);
    saveMap(equips, equipFile, 'equips');
  },

  async getEquipped(playerId: string): Promise<EquipSlot | null> {
    ensure();
    return equips.get(playerId) || null;
  },

  async upgradePart(playerId: string, partCode: string): Promise<PlayerPart> {
    ensure();
    const target = Array.from(parts.values()).find((p) => p.playerId === playerId && p.partCode === partCode);
    if (!target) throw new Error('Part not found');
    target.level += 1;
    parts.set(target.id, target);
    saveMap(parts, partsFile, 'parts');
    return target;
  },
};

// ─── MechaConfigRepository ─────────────────────────

export const jsonMechaConfigRepo: MechaConfigRepository = {
  async getConfigs(playerId: string): Promise<MechaConfig[]> {
    ensure();
    return Array.from(configs.values()).filter((c) => c.playerId === playerId);
  },

  async createConfig(playerId: string, name: string, frame: string, weapon: string, core: string, module: string): Promise<MechaConfig> {
    ensure();
    const now = new Date().toISOString();
    const config: MechaConfig = {
      id: crypto.randomUUID(), playerId, name,
      frame, weapon, core, module,
      isActive: 0, createdAt: now, updatedAt: now,
    };
    configs.set(config.id, config);
    saveMap(configs, configsFile, 'configs');
    return config;
  },

  async updateConfig(id: string, updates: Partial<Omit<MechaConfig, 'id' | 'playerId' | 'createdAt'>>): Promise<MechaConfig | null> {
    ensure();
    const config = configs.get(id);
    if (!config) return null;
    Object.assign(config, updates, { updatedAt: new Date().toISOString() });
    configs.set(id, config);
    saveMap(configs, configsFile, 'configs');
    return config;
  },

  async activateConfig(id: string, playerId: string): Promise<MechaConfig | null> {
    ensure();
    const target = configs.get(id);
    if (!target || target.playerId !== playerId) return null;
    // 모든 구성을 비활성화
    for (const c of configs.values()) {
      if (c.playerId === playerId && c.isActive) {
        c.isActive = 0;
        configs.set(c.id, c);
      }
    }
    target.isActive = 1;
    configs.set(id, target);
    saveMap(configs, configsFile, 'configs');
    return target;
  },

  async deleteConfig(id: string, playerId: string): Promise<boolean> {
    ensure();
    const config = configs.get(id);
    if (!config || config.playerId !== playerId) return false;
    configs.delete(id);
    saveMap(configs, configsFile, 'configs');
    return true;
  },

  async getActiveConfig(playerId: string): Promise<MechaConfig | null> {
    ensure();
    return Array.from(configs.values()).find((c) => c.playerId === playerId && c.isActive) || null;
  },
};

export function resetPartsStores(): void {
  parts = new Map();
  equips = new Map();
  configs = new Map();
  _initialized = false;
}
