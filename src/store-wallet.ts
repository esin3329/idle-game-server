/**
 * JSON 파일 기반 Wallet 저장소 (개발/테스트 전용)
 *
 * wallet_balances + currency_ledger 를 JSON 파일에 저장.
 * 프로덕션 저장소 대체 용도로 사용하지 않는다.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { promoteJsonTempFile } from './shared/json-file.js';
import { join } from 'node:path';
import type { WalletBalance, CurrencyLedger } from './types.js';
import type { WalletRepository, BalanceResult, LedgerEntry, AdjustBalanceParams } from './repository.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';

// ─── 데이터 파일 경로 ────────────────────────────────

const walletsFile = process.env.DATA_FILE_WALLETS || join(process.cwd(), 'data-wallets.json');
const ledgerFile = process.env.DATA_FILE_LEDGER || join(process.cwd(), 'data-ledger.json');

// ─── 인메모리 저장소 ─────────────────────────────────

let wallets = new Map<string, WalletBalance>();
let ledgerEntries: CurrencyLedger[] = [];
let _initialized = false;

// ─── 파일 I/O 헬퍼 ───────────────────────────────────

function loadMap<T extends { id: string }>(filePath: string, name: string): Map<string, T> {
  if (!existsSync(filePath)) return new Map();
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const arr: T[] = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('not an array');
    return new Map(arr.map((item) => [item.id, item]));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'load', file: filePath, name, err: msg }, `Failed to load ${name}`);
    throw new Error(`Failed to load ${name} from ${filePath}`, { cause: err });
  }
}

function loadArray<T>(filePath: string, name: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const arr: T[] = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('not an array');
    return arr;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'load', file: filePath, name, err: msg }, `Failed to load ${name}`);
    throw new Error(`Failed to load ${name} from ${filePath}`, { cause: err });
  }
}

function saveMap<T extends { id: string }>(map: Map<string, T>, filePath: string, name: string): void {
  const tmpFile = filePath + '.tmp';
  try {
    const json = JSON.stringify(Array.from(map.values()), null, 2);
    writeFileSync(tmpFile, json, 'utf-8');
    const raw = readFileSync(tmpFile, 'utf-8');
    JSON.parse(raw);
    const bakFile = filePath + '.bak';
    if (existsSync(filePath)) copyFileSync(filePath, bakFile);
    promoteJsonTempFile(tmpFile, filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'save', file: filePath, name, err: msg }, `Failed to save ${name}`);
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* best effort */ }
    throw err;
  }
}

function saveArray<T>(arr: T[], filePath: string, name: string): void {
  const tmpFile = filePath + '.tmp';
  try {
    const json = JSON.stringify(arr, null, 2);
    writeFileSync(tmpFile, json, 'utf-8');
    const raw = readFileSync(tmpFile, 'utf-8');
    JSON.parse(raw);
    const bakFile = filePath + '.bak';
    if (existsSync(filePath)) copyFileSync(filePath, bakFile);
    promoteJsonTempFile(tmpFile, filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'save', file: filePath, name, err: msg }, `Failed to save ${name}`);
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* best effort */ }
    throw err;
  }
}

function ensureLoaded(): void {
  if (!_initialized) {
    const loadedWallets = loadMap<WalletBalance>(walletsFile, 'wallets');
    const loadedLedger = loadArray<CurrencyLedger>(ledgerFile, 'ledger');
    wallets = loadedWallets;
    ledgerEntries = loadedLedger;
    _initialized = true;
  }
}

// ─── WalletRepository ────────────────────────────────

export const jsonWalletRepo: WalletRepository = {
  async getBalance(playerId: string): Promise<BalanceResult | null> {
    ensureLoaded();
    let wallet = Array.from(wallets.values()).find((w) => w.playerId === playerId);
    if (!wallet) {
      const { getPlayer } = await import('./store.js');
      const player = getPlayer(playerId);
      if (!player) return null;
      wallet = {
        id: crypto.randomUUID(),
        playerId,
        userId: playerId,
        currency: 'electricity',
        electricity: player.electricity,
        electricityPerSecond: player.electricityPerSecond,
        scrap: 0,
        balance: player.electricity,
        lastClaimedAt: player.lastClaimedAt,
        createdAt: player.createdAt,
        updatedAt: player.updatedAt,
      };
      wallets.set(wallet.id, wallet);
      saveMap(wallets, walletsFile, 'wallets');
    }
    return {
      playerId: wallet.playerId,
      currency: 'electricity',
      balance: wallet.electricity,
      scrap: wallet.scrap,
      electricityPerSecond: wallet.electricityPerSecond,
      lastClaimedAt: wallet.lastClaimedAt,
    };
  },

  async getBalances(playerIds: string[]): Promise<BalanceResult[]> {
    ensureLoaded();
    const requestedIds = new Set(playerIds);
    const existingPlayerIds = new Set(Array.from(wallets.values()).map((wallet) => wallet.playerId));
    for (const playerId of requestedIds) {
      if (!existingPlayerIds.has(playerId)) {
        await jsonWalletRepo.getBalance(playerId);
      }
    }
    return Array.from(wallets.values())
      .filter((wallet) => requestedIds.has(wallet.playerId))
      .map((wallet) => ({
        playerId: wallet.playerId,
        currency: 'electricity',
        balance: wallet.electricity,
        scrap: wallet.scrap,
        electricityPerSecond: wallet.electricityPerSecond,
        lastClaimedAt: wallet.lastClaimedAt,
      }));
  },

  async adjustBalance(params: AdjustBalanceParams): Promise<{ balanceAfter: number; success: boolean }> {
    ensureLoaded();
    const { playerId, amount, source, idempotencyKey, currency = 'electricity', reason = '', referenceType = '', referenceId = '' } = params;
    if (!idempotencyKey) throw new AppError('멱등성 키가 필요합니다.', 400, 'MISSING_IDEMPOTENCY_KEY');

    const existing = ledgerEntries.find((entry) => entry.idempotencyKey === idempotencyKey);
    if (existing) {
      const sameRequest = existing.playerId === playerId && existing.amount === amount
        && existing.currency === currency && existing.source === source && existing.reason === reason
        && existing.referenceType === referenceType && existing.referenceId === referenceId;
      if (!sameRequest) throw new AppError('동일한 키가 다른 잔액 변경에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
      return { balanceAfter: existing.balanceAfter, success: false };
    }

    const wallet = Array.from(wallets.values()).find((entry) => entry.playerId === playerId);
    if (!wallet) throw new AppError('지갑을 찾을 수 없습니다.', 404, 'WALLET_NOT_FOUND');

    const currentBalance = currency === 'scrap' ? wallet.scrap : wallet.electricity;
    const balanceAfter = currentBalance + amount;
    if (balanceAfter < 0) throw new AppError('잔액이 부족합니다.', 400, 'INSUFFICIENT_BALANCE');

    const entry: CurrencyLedger = {
      id: crypto.randomUUID(),
      playerId,
      userId: wallet.userId,
      currency,
      amount,
      balanceAfter,
      source,
      reason,
      referenceType,
      referenceId,
      idempotencyKey,
      requestHash: '',
      createdAt: new Date().toISOString(),
    };
    ledgerEntries.push(entry);
    try {
      saveArray(ledgerEntries, ledgerFile, 'ledger');
    } catch (err) {
      ledgerEntries.pop();
      throw err;
    }

    const previousWallet = { ...wallet };
    if (currency === 'scrap') {
      wallet.scrap = balanceAfter;
    } else {
      wallet.electricity = balanceAfter;
      wallet.balance = balanceAfter;
    }
    wallet.updatedAt = new Date().toISOString();
    wallets.set(wallet.id, wallet);
    try {
      saveMap(wallets, walletsFile, 'wallets');
    } catch (err) {
      wallets.set(previousWallet.id, previousWallet);
      ledgerEntries.pop();
      try {
        saveArray(ledgerEntries, ledgerFile, 'ledger');
      } catch (rollbackError) {
        logger.error({ operation: 'rollback', playerId, rollbackError }, 'Failed to roll back wallet ledger after persistence error');
      }
      throw err;
    }

    logger.info({ playerId, amount, balanceAfter, source, event: 'balance_adjust' }, 'Balance adjusted');
    return { balanceAfter, success: true };
  },

  async updateEps(playerId: string, newEps: number): Promise<void> {
    ensureLoaded();
    const wallet = Array.from(wallets.values()).find((w) => w.playerId === playerId);
    if (wallet) {
      wallet.electricityPerSecond = newEps;
      wallet.updatedAt = new Date().toISOString();
      wallets.set(wallet.id, wallet);
      saveMap(wallets, walletsFile, 'wallets');
    }
  },

  async updateLastClaimedAt(playerId: string, claimedAt: string): Promise<void> {
    ensureLoaded();
    const wallet = Array.from(wallets.values()).find((w) => w.playerId === playerId);
    if (wallet) {
      wallet.lastClaimedAt = claimedAt;
      wallet.updatedAt = new Date().toISOString();
      wallets.set(wallet.id, wallet);
      saveMap(wallets, walletsFile, 'wallets');
    }
  },

  async getLedger(playerId: string, limit = 50): Promise<LedgerEntry[]> {
    ensureLoaded();
    return ledgerEntries
      .filter((e) => e.playerId === playerId)
      .slice(-limit)
      .reverse()
      .map((r) => ({
        id: r.id,
        playerId: r.playerId,
        currency: r.currency,
        amount: r.amount,
        balanceAfter: r.balanceAfter,
        source: r.source,
        createdAt: r.createdAt,
      }));
  },
};

/** 테스트 전용: 저장소 초기화 */
export function resetWalletStores(): void {
  wallets = new Map();
  ledgerEntries = [];
  _initialized = false;
}
/** Keep the balance repository cache consistent when the auth repository creates a wallet. */
export function syncAuthWallet(wallet: WalletBalance): void {
  if (_initialized) wallets.set(wallet.id, wallet);
}
