/**
 * JSON 파일 기반 제작(Crafting) 저장소
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { promoteJsonTempFile } from './shared/json-file.js';
import { join } from 'node:path';
import type { PlayerBlueprint, PartCrafting } from './types.js';
import type { CraftingRepository } from './repository.js';
import { BLUEPRINTS, getBlueprint } from './data/crafting.js';
import { logItemEvent } from './store-item-ledger.js';
import { logger } from './shared/logger.js';
import { AppError } from './shared/errors.js';
import { jsonWalletRepo } from './store-wallet.js';
import { consumeJsonParts, grantCraftedJsonPart, jsonPartsRepo } from './store-parts.js';
import { craftingCurrencyLedgerKey, craftingRefundKey, craftingRequestKey } from './shared/crafting-ledger.js';

const bpFile = process.env.DATA_FILE_BLUEPRINTS || join(process.cwd(), 'data-blueprints.json');
const craftFile = process.env.DATA_FILE_CRAFTS || join(process.cwd(), 'data-crafts.json');

type StoredPartCrafting = PartCrafting & { idempotencyKey?: string; blueprintCode?: string };

let blueprints = new Map<string, PlayerBlueprint>();
let crafts = new Map<string, StoredPartCrafting>();

const craftLocks = new Map<string, Promise<void>>();

async function withCraftLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = craftLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  craftLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (craftLocks.get(key) === current) craftLocks.delete(key);
  }
}

function toCraft(craft: StoredPartCrafting): PartCrafting {
  return {
    id: craft.id,
    playerId: craft.playerId,
    resultCode: craft.resultCode,
    materials: craft.materials,
    startedAt: craft.startedAt,
    completesAt: craft.completesAt,
    completed: craft.completed,
    createdAt: craft.createdAt,
  };
}
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
    blueprints = loadMap<PlayerBlueprint>(bpFile, 'blueprints');
    crafts = loadMap<StoredPartCrafting>(craftFile, 'crafts');
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
    return Array.from(crafts.values()).filter((craft) => craft.playerId === playerId).map(toCraft);
  },

  async startCraft(playerId: string, blueprintCode: string, requestKey: string): Promise<PartCrafting> {
    ensure();
    const bpData = getBlueprint(blueprintCode);
    if (!bpData) throw new AppError('존재하지 않는 설계도입니다.', 404, 'BLUEPRINT_NOT_FOUND');

    return withCraftLock(`player:${playerId}`, async () => {
      const idempotencyKey = craftingRequestKey(playerId, requestKey);
      const existing = Array.from(crafts.values()).find((craft) => craft.idempotencyKey === idempotencyKey);
      if (existing) {
        if (existing.resultCode !== bpData.partCode) {
          throw new AppError('동일한 키가 다른 제작 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
        }
        return toCraft(existing);
      }

      if (!Array.from(blueprints.values()).some((blueprint) => blueprint.playerId === playerId && blueprint.blueprintCode === blueprintCode)) {
        throw new AppError('설계도를 보유하지 않았습니다.', 400, 'BLUEPRINT_NOT_OWNED');
      }
      if (await jsonPartsRepo.hasPart(playerId, bpData.partCode)) {
        throw new AppError('이미 보유한 파츠는 제작할 수 없습니다.', 409, 'PART_ALREADY_OWNED');
      }

      const scrapCost = bpData.materials.scrap || 0;
      const wallet = await jsonWalletRepo.getBalance(playerId);
      if (!wallet) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');
      if (wallet.scrap < scrapCost) throw new AppError('스크랩이 부족합니다.', 400, 'INSUFFICIENT_BALANCE');

      const id = crypto.randomUUID();
      let scrapLedgerKey: string | undefined;
      if (scrapCost > 0) {
        scrapLedgerKey = craftingCurrencyLedgerKey(idempotencyKey, 'scrap');
        const adjusted = await jsonWalletRepo.adjustBalance({
          playerId,
          amount: -scrapCost,
          source: 'craft',
          idempotencyKey: scrapLedgerKey,
          currency: 'scrap',
          reason: `${blueprintCode} 제작 비용`,
          referenceType: 'craft',
          referenceId: id,
        });
        if (!adjusted.success) throw new AppError('이미 처리된 제작 요청입니다.', 409, 'IDEMPOTENCY_CONFLICT');
      }

      try {
        consumeJsonParts(playerId, bpData.materials, id);
      } catch (error) {
        if (scrapLedgerKey) {
          await jsonWalletRepo.adjustBalance({
            playerId,
            amount: scrapCost,
            source: 'craft_refund',
            idempotencyKey: craftingRefundKey(scrapLedgerKey),
            currency: 'scrap',
            reason: `${blueprintCode} 제작 취소`,
            referenceType: 'craft',
            referenceId: id,
          });
        }
        throw error;
      }

      const now = Date.now();
      const craft: StoredPartCrafting = {
        id, playerId,
        resultCode: bpData.partCode,
        materials: JSON.stringify(bpData.materials),
        startedAt: new Date(now).toISOString(),
        completesAt: new Date(now + bpData.craftSeconds * 1000).toISOString(),
        completed: 0,
        createdAt: new Date(now).toISOString(),
        idempotencyKey,
        blueprintCode,
      };
      crafts.set(craft.id, craft);
      saveMap(crafts, craftFile, 'crafts');
      return toCraft(craft);
    });
  },

  async completeCraft(playerId: string, craftId: string): Promise<{ partId: string; partCode: string }> {
    return withCraftLock(`craft:${craftId}`, async () => {
      ensure();
      const craft = crafts.get(craftId);
      if (!craft || craft.playerId !== playerId) throw new AppError('제작 내역을 찾을 수 없습니다.', 404, 'CRAFT_NOT_FOUND');
      if (new Date(craft.completesAt).getTime() > Date.now()) throw new AppError('아직 제작이 완료되지 않았습니다.', 400, 'CRAFT_NOT_READY');
      if (craft.completed) throw new AppError('이미 완료된 제작입니다.', 409, 'ALREADY_COMPLETED');

      const blueprint = Array.from(BLUEPRINTS).find((entry) => entry.partCode === craft.resultCode);
      if (!blueprint) throw new AppError('제작 결과 파츠를 찾을 수 없습니다.', 500, 'UNKNOWN_CRAFT_RESULT');
      if (await jsonPartsRepo.hasPart(playerId, craft.resultCode)) {
        throw new AppError('이미 보유한 파츠는 제작할 수 없습니다.', 409, 'PART_ALREADY_OWNED');
      }
      const part = await grantCraftedJsonPart(playerId, craft.resultCode, blueprint.partType, craftId);
      craft.completed = 1;
      crafts.set(craftId, craft);
      saveMap(crafts, craftFile, 'crafts');
      return { partId: part.id, partCode: craft.resultCode };
    });
  },

  async getCompletable(playerId: string): Promise<PartCrafting[]> {
    ensure();
    const now = Date.now();
    return Array.from(crafts.values())
      .filter((craft) => craft.playerId === playerId && !craft.completed && new Date(craft.completesAt).getTime() <= now)
      .map(toCraft);
  },
};

export function resetCraftingStores(): void {
  blueprints = new Map();
  crafts = new Map();
  _initialized = false;
}
