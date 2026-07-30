/**
 * JSON 파일 기반 연구 저장소
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerResearch } from './types.js';
import type { ResearchRepository } from './repository.js';
import { getResearchNode } from './data/research.js';
import { logger } from './shared/logger.js';

const researchFile = process.env.DATA_FILE_RESEARCH || join(process.cwd(), 'data-research.json');

let research = new Map<string, PlayerResearch>();
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
    research = loadMap<PlayerResearch>(researchFile, 'research');
  }
}

export const jsonResearchRepo: ResearchRepository = {
  async getAll(playerId: string): Promise<PlayerResearch[]> {
    ensure();
    return Array.from(research.values()).filter((r) => r.playerId === playerId);
  },

  async get(playerId: string, code: string): Promise<PlayerResearch | null> {
    ensure();
    return Array.from(research.values()).find((r) => r.playerId === playerId && r.code === code) || null;
  },

  async levelUp(playerId: string, code: string): Promise<PlayerResearch> {
    ensure();
    const node = getResearchNode(code);
    if (!node) throw new Error(`Unknown research: ${code}`);

    let record = Array.from(research.values()).find((r) => r.playerId === playerId && r.code === code);
    if (!record) {
      // 첫 연구: level=0 생성
      record = {
        id: crypto.randomUUID(), playerId, code,
        level: 0, completed: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      research.set(record.id, record);
    }

    if (record.level >= node.maxLevel) {
      throw new Error('MAX_LEVEL');
    }

    record.level += 1;
    record.completed = record.level >= node.maxLevel ? 1 : 0;
    record.updatedAt = new Date().toISOString();
    research.set(record.id, record);
    saveMap(research, researchFile, 'research');
    return record;
  },

  async reset(playerId: string): Promise<void> {
    ensure();
    for (const [id, r] of research) {
      if (r.playerId === playerId) research.delete(id);
    }
    saveMap(research, researchFile, 'research');
  },
};

export function resetResearchStores(): void {
  research = new Map();
  _initialized = false;
}
