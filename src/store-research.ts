/**
 * JSON 파일 기반 연구 저장소
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { promoteJsonTempFile } from './shared/json-file.js';
import { join } from 'node:path';
import type { PlayerResearch } from './types.js';
import type { ResearchRepository } from './repository.js';
import { getResearchNode } from './data/research.js';
import { logger } from './shared/logger.js';
import { AppError } from './shared/errors.js';
import { jsonWalletRepo } from './store-wallet.js';
import { researchLedgerKey, researchRefundKey } from './shared/research-ledger.js';

const levelUpLocks = new Map<string, Promise<void>>();

async function withLevelUpLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = levelUpLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  levelUpLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (levelUpLocks.get(key) === current) levelUpLocks.delete(key);
  }
}
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
    promoteJsonTempFile(tmp, fp);
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

  async levelUp(playerId: string, code: string, requestKey: string) {
    return withLevelUpLock(`${playerId}\0${code}`, async () => {
      ensure();
      const node = getResearchNode(code);
      if (!node) throw new AppError('존재하지 않는 연구입니다.', 404, 'RESEARCH_NOT_FOUND');

      const allResearch = Array.from(research.values()).filter((record) => record.playerId === playerId);
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
      const charged: { currency: 'electricity' | 'scrap'; amount: number; key: string }[] = [];

      try {
        for (const currency of ['electricity', 'scrap'] as const) {
          const amount = cost[currency] || 0;
          if (amount <= 0) continue;
          const key = researchLedgerKey(playerId, requestKey, code, currency);
          const adjusted = await jsonWalletRepo.adjustBalance({
            playerId, amount: -amount, source: 'research', idempotencyKey: key, currency,
            reason: `${node.name} Lv.${nextLevel}`, referenceType: 'research', referenceId: code,
          });
          if (!adjusted.success) throw new AppError('연구 비용 요청이 이미 처리되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
          charged.push({ currency, amount, key });
        }
      } catch (error) {
        for (const debit of charged.reverse()) {
          await jsonWalletRepo.adjustBalance({
            playerId,
            amount: debit.amount,
            source: 'research_refund',
            idempotencyKey: researchRefundKey(debit.key),
            currency: debit.currency,
            reason: `${node.name} Lv.${nextLevel} rollback`,
            referenceType: 'research',
            referenceId: code,
          });
        }
        throw error;
      }

      const now = new Date().toISOString();
      const updated: PlayerResearch = record
        ? {
            ...record,
            level: nextLevel,
            completed: nextLevel >= node.maxLevel ? 1 : 0,
            updatedAt: now,
          }
        : {
            id: crypto.randomUUID(), playerId, code,
            level: nextLevel, completed: nextLevel >= node.maxLevel ? 1 : 0,
            createdAt: now, updatedAt: now,
          };
      research.set(updated.id, updated);
      saveMap(research, researchFile, 'research');
      return { research: updated, cost };
    });
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
