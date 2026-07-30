/**
 * JSON 파일 기반 제작(Crafting) 저장소
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerBlueprint, PartCrafting } from './types.js';
import type { CraftingRepository } from './repository.js';
import { getBlueprint } from './data/crafting.js';
import { logItemEvent } from './store-item-ledger.js';
import { logger } from './shared/logger.js';

const bpFile = process.env.DATA_FILE_BLUEPRINTS || join(process.cwd(), 'data-blueprints.json');
const craftFile = process.env.DATA_FILE_CRAFTS || join(process.cwd(), 'data-crafts.json');

let blueprints = new Map<string, PlayerBlueprint>();
let crafts = new Map<string, PartCrafting>();
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
    blueprints = loadMap<PlayerBlueprint>(bpFile, 'blueprints');
    crafts = loadMap<PartCrafting>(craftFile, 'crafts');
  }
}

export const jsonCraftingRepo: CraftingRepository = {
  async getBlueprints(playerId: string): Promise<PlayerBlueprint[]> {
    ensure();
    return Array.from(blueprints.values()).filter((b) => b.playerId === playerId);
  },

  async hasBlueprint(playerId: string, blueprintCode: string): Promise<boolean> {
    ensure();
    return Array.from(blueprints.values()).some(
      (b) => b.playerId === playerId && b.blueprintCode === blueprintCode,
    );
  },

  async grantBlueprint(playerId: string, blueprintCode: string): Promise<PlayerBlueprint> {
    ensure();
    const bp: PlayerBlueprint = {
      id: crypto.randomUUID(), playerId, blueprintCode,
      acquiredAt: new Date().toISOString(),
    };
    blueprints.set(bp.id, bp);
    saveMap(blueprints, bpFile, 'blueprints');
    logItemEvent(playerId, 'blueprint', blueprintCode, 1, 'drop', 'blueprint', bp.id);
    return bp;
  },

  async getQueue(playerId: string): Promise<PartCrafting[]> {
    ensure();
    return Array.from(crafts.values()).filter((c) => c.playerId === playerId);
  },

  async startCraft(playerId: string, blueprintCode: string): Promise<PartCrafting> {
    ensure();
    const bpData = getBlueprint(blueprintCode);
    if (!bpData) throw new Error('UNKNOWN_BLUEPRINT');

    const now = Date.now();
    const craft: PartCrafting = {
      id: crypto.randomUUID(), playerId,
      resultCode: bpData.partCode,
      materials: JSON.stringify(bpData.materials),
      startedAt: new Date(now).toISOString(),
      completesAt: new Date(now + bpData.craftSeconds * 1000).toISOString(),
      completed: 0,
      createdAt: new Date(now).toISOString(),
    };
    crafts.set(craft.id, craft);
    saveMap(crafts, craftFile, 'crafts');
    return craft;
  },

  async completeCraft(playerId: string, craftId: string): Promise<{ partId: string; partCode: string }> {
    ensure();
    const craft = crafts.get(craftId);
    if (!craft || craft.playerId !== playerId) throw new Error('CRAFT_NOT_FOUND');
    if (new Date(craft.completesAt).getTime() > Date.now()) throw new Error('CRAFT_NOT_READY');
    if (craft.completed) throw new Error('ALREADY_COMPLETED');

    craft.completed = 1;
    crafts.set(craftId, craft);
    saveMap(crafts, craftFile, 'crafts');
    return { partId: crypto.randomUUID(), partCode: craft.resultCode };
  },

  async getCompletable(playerId: string): Promise<PartCrafting[]> {
    ensure();
    const now = Date.now();
    return Array.from(crafts.values()).filter(
      (c) => c.playerId === playerId && !c.completed && new Date(c.completesAt).getTime() <= now,
    );
  },
};

export function resetCraftingStores(): void {
  blueprints = new Map();
  crafts = new Map();
  _initialized = false;
}
