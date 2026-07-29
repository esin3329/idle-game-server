/**
 * JSON 파일 기반 Wallet 저장소 (개발/테스트용)
 *
 * wallet_balances + currency_ledger 를 JSON 파일에 저장.
 * MySQL 미연결 시 provider.ts에서 자동 로드됨.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
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
    logger.error({ operation: 'load', file: filePath, name, err: msg }, `Failed to load ${name}, starting empty`);
    return new Map();
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
    logger.error({ operation: 'load', file: filePath, name, err: msg }, `Failed to load ${name}, starting empty`);
    return [];
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
    renameSync(tmpFile, filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'save', file: filePath, name, err: msg }, `Failed to save ${name}`);
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* best effort */ }
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
    renameSync(tmpFile, filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'save', file: filePath, name, err: msg }, `Failed to save ${name}`);
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* best effort */ }
  }
}

function ensureLoaded(): void {
  if (!_initialized) {
    _initialized = true;
    wallets = loadMap<WalletBalance>(walletsFile, 'wallets');
    ledgerEntries = loadArray<CurrencyLedger>(ledgerFile, 'ledger');
  }
}

// ─── WalletRepository ────────────────────────────────

export const jsonWalletRepo: WalletRepository = {
  async getBalance(playerId: string): Promise<BalanceResult | null> {
    ensureLoaded();
    const wallet = Array.from(wallets.values()).find((w) => w.playerId === playerId);
    if (!wallet) return null;
    return {
      playerId: wallet.playerId,
      currency: 'electricity',
      balance: wallet.electricity,
      electricityPerSecond: wallet.electricityPerSecond,
      lastClaimedAt: wallet.lastClaimedAt,
    };
  },

  async adjustBalance(params: AdjustBalanceParams): Promise<{ balanceAfter: number; success: boolean }> {
    ensureLoaded();
    const { playerId, amount, source, idempotencyKey, currency = 'electricity', reason = '', referenceType = '', referenceId = '' } = params;

    // 멱등성 검사
    const existing = ledgerEntries.find((e) => e.idempotencyKey === idempotencyKey);
    if (existing) {
      return { balanceAfter: existing.balanceAfter, success: false };
    }

    let wallet = Array.from(wallets.values()).find((w) => w.playerId === playerId);
    if (!wallet) {
      // wallet 없으면 자동 생성 후 재시도 (개발/테스트 편의)
      // store.ts에서 player 정보 조회하여 electricity 동기화
      let initialElectricity = 0;
      let initialEps = 1;
      let initialLastClaimed = new Date().toISOString();
      try {
        const { getPlayer } = await import('./store.js');
        const player = getPlayer(playerId);
        if (player) {
          initialElectricity = player.electricity;
          initialEps = player.electricityPerSecond;
          initialLastClaimed = player.lastClaimedAt;
        }
      } catch { /* best effort */ }

      const newWallet: WalletBalance = {
        id: crypto.randomUUID(),
        playerId,
        userId: playerId,
        currency: 'electricity',
        electricity: initialElectricity,
        electricityPerSecond: initialEps,
        scrap: 0,
        balance: initialElectricity,
        lastClaimedAt: initialLastClaimed,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      wallets.set(newWallet.id, newWallet);
      saveMap(wallets, walletsFile, 'wallets');
      return this.adjustBalance(params);
    }

    const currentBalance = currency === 'scrap' ? wallet.scrap : wallet.electricity;
    const balanceAfter = currentBalance + amount;

    if (balanceAfter < 0) {
      throw new AppError('잔액이 부족합니다.', 400, 'INSUFFICIENT_BALANCE');
    }

    // 잔액 갱신
    if (currency === 'scrap') {
      wallet.scrap = balanceAfter;
    } else {
      wallet.electricity = balanceAfter;
    }
    wallet.updatedAt = new Date().toISOString();
    wallets.set(wallet.id, wallet);
    saveMap(wallets, walletsFile, 'wallets');

    // 원장 기록
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
    saveArray(ledgerEntries, ledgerFile, 'ledger');

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
