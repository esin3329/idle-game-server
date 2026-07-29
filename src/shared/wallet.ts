/**
 * 재화(Wallet) 서비스
 *
 * getWalletRepo()를 통해 JSON/MySQL 저장소를 자동 선택.
 * 모든 함수는 provider에 위임하는 thin wrapper.
 */
import { getWalletRepo, getWalletRepoMode } from '../provider.js';
import type { BalanceResult, LedgerEntry } from '../repository.js';
import { logger } from './logger.js';

/** 잔액 조회 */
export async function getBalance(playerId: string): Promise<BalanceResult | null> {
  const repo = await getWalletRepo();
  return repo.getBalance(playerId);
}

/**
 * 원자적 잔액 증감 + 원장 기록
 *
 * MySQL 모드: 트랜잭션 (SELECT FOR UPDATE → UPDATE → INSERT)
 * JSON 모드: 순차 저장 (멱등성 키로 중복 방지)
 */
export async function adjustBalance(
  playerId: string,
  amount: number,
  source: string,
  idempotencyKey: string,
  currency = 'electricity',
  reason = '',
  referenceType = '',
  referenceId = '',
): Promise<{ balanceAfter: number; success: boolean }> {
  const repo = await getWalletRepo();
  return repo.adjustBalance({ playerId, amount, source, idempotencyKey, currency, reason, referenceType, referenceId });
}

/** EPS 갱신 (업그레이드) */
export async function updateEps(playerId: string, newEps: number): Promise<void> {
  const repo = await getWalletRepo();
  return repo.updateEps(playerId, newEps);
}

/** lastClaimedAt 갱신 */
export async function updateLastClaimedAt(playerId: string, claimedAt: Date): Promise<void> {
  const repo = await getWalletRepo();
  return repo.updateLastClaimedAt(playerId, claimedAt.toISOString());
}

/** 원장 조회 */
export async function getLedger(playerId: string, limit = 50): Promise<LedgerEntry[]> {
  const repo = await getWalletRepo();
  return repo.getLedger(playerId, limit);
}

/** 현재 저장소 모드 (디버깅용) */
export function getMode(): string {
  return getWalletRepoMode();
}
