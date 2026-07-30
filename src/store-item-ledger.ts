/**
 * JSON 파일 기반 아이템 원장 (item_ledger)
 *
 * 파츠/설계도 등의 획득/소비를 기록. MySQL 모드에서는 DB item_ledger 테이블 사용.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CurrencyLedger } from './types.js';
import { logger } from './shared/logger.js';

const ledgerFile = process.env.DATA_FILE_ITEM_LEDGER || join(process.cwd(), 'data-item-ledger.json');
let entries: CurrencyLedger[] = [];
let _initialized = false;

function load(): CurrencyLedger[] {
  if (!existsSync(ledgerFile)) return [];
  try {
    const raw = readFileSync(ledgerFile, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    logger.error({ operation: 'load', file: ledgerFile, err: (err as Error).message }, 'Failed to load item ledger');
    return [];
  }
}

function save(): void {
  const tmp = ledgerFile + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
    JSON.parse(readFileSync(tmp, 'utf-8'));
    if (existsSync(ledgerFile)) copyFileSync(ledgerFile, ledgerFile + '.bak');
    renameSync(tmp, ledgerFile);
  } catch (err) {
    logger.error({ operation: 'save', file: ledgerFile, err: (err as Error).message }, 'Failed to save item ledger');
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* skip */ }
  }
}

function ensure(): void {
  if (!_initialized) { _initialized = true; entries = load(); }
}

/** 아이템 원장에 이벤트 기록 */
export function logItemEvent(
  playerId: string,
  itemType: string,    // 'part' | 'blueprint'
  _itemId: string,     // partCode 또는 blueprintCode
  quantity: number,    // 양수=획득, 음수=소비
  source: string,      // 'grant' | 'drop' | 'craft' | 'upgrade_cost' 등
  referenceType = '',
  referenceId = '',
): void {
  ensure();
  entries.push({
    id: crypto.randomUUID(),
    playerId,
    userId: playerId,
    currency: itemType,
    amount: quantity,
    balanceAfter: 0,
    source,
    reason: '',
    referenceType,
    referenceId,
    idempotencyKey: '',
    requestHash: '',
    createdAt: new Date().toISOString(),
  });
  save();
}

/** 아이템 원장 조회 */
export function getItemLedger(playerId: string, limit = 50): CurrencyLedger[] {
  ensure();
  return entries.filter((e) => e.playerId === playerId).slice(-limit).reverse();
}

export function resetItemLedger(): void {
  entries = [];
  _initialized = false;
}
