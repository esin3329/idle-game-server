import { createHash } from 'node:crypto';

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function craftingRequestKey(playerId: string, requestKey: string): string {
  return hash([playerId, requestKey]);
}

export function craftingCurrencyLedgerKey(queueKey: string, currency: string): string {
  return hash([queueKey, 'currency', currency]);
}

export function craftingItemLedgerKey(queueKey: string, partCode: string): string {
  return hash([queueKey, 'part', partCode]);
}

export function craftingRefundKey(ledgerKey: string): string {
  return hash(['refund', ledgerKey]);
}
