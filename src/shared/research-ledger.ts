import { createHash } from 'node:crypto';

export function researchLedgerKey(playerId: string, requestKey: string, code: string, currency: string): string {
  return createHash('sha256').update([playerId, requestKey, code, currency].join('\0')).digest('hex');
}

export function researchRefundKey(ledgerKey: string): string {
  return createHash('sha256').update(['refund', ledgerKey].join('\0')).digest('hex');
}
