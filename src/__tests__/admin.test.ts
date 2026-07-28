/**
 * 운영 API 단위 테스트
 *
 * 순수 함수와 입력 검증 단위 테스트 (DB 의존성 없음)
 */
import { describe, it, expect } from 'vitest';

// ─── 제재 유형 검증 ─────────────────────────────────

const ALLOWED_SANCTION_TYPES = ['suspension', 'battle_restriction', 'reward_restriction'];

function validateSanctionType(type: string): boolean {
  return ALLOWED_SANCTION_TYPES.includes(type);
}

describe('Sanction Validation', () => {
  it('suspension type is valid', () => {
    expect(validateSanctionType('suspension')).toBe(true);
  });

  it('battle_restriction is valid', () => {
    expect(validateSanctionType('battle_restriction')).toBe(true);
  });

  it('reward_restriction is valid', () => {
    expect(validateSanctionType('reward_restriction')).toBe(true);
  });

  it('unknown type is invalid', () => {
    expect(validateSanctionType('chat_mute')).toBe(false);
  });

  it('empty string is invalid', () => {
    expect(validateSanctionType('')).toBe(false);
  });
});

// ─── 지급 유형 검증 ─────────────────────────────────

const ALLOWED_GRANT_RESOURCES = ['electricity', 'scrap'];

function validateGrantResource(resourceType: string, resourceCode: string): boolean {
  if (resourceType !== 'currency' && resourceType !== 'item') return false;
  if (resourceType === 'currency') return ALLOWED_GRANT_RESOURCES.includes(resourceCode);
  return true; // item type: 모든 resourceCode 허용 (MVP)
}

describe('Grant Validation', () => {
  it('currency + electricity is valid', () => {
    expect(validateGrantResource('currency', 'electricity')).toBe(true);
  });

  it('currency + scrap is valid', () => {
    expect(validateGrantResource('currency', 'scrap')).toBe(true);
  });

  it('currency + blueprint is invalid', () => {
    expect(validateGrantResource('currency', 'blueprint')).toBe(false);
  });

  it('item + blueprint is valid', () => {
    expect(validateGrantResource('item', 'blueprint')).toBe(true);
  });

  it('unknown type is invalid', () => {
    expect(validateGrantResource('unknown', 'scrap')).toBe(false);
  });
});

// ─── 금액 제한 검증 ─────────────────────────────────

const MAX_GRANT_AMOUNT = 100000;
const MIN_GRANT_AMOUNT = -100000;

function validateGrantAmount(amount: number): { valid: boolean; reason?: string } {
  if (typeof amount !== 'number' || amount === 0) return { valid: false, reason: 'amount must be non-zero' };
  if (amount > MAX_GRANT_AMOUNT) return { valid: false, reason: 'exceeds max' };
  if (amount < MIN_GRANT_AMOUNT) return { valid: false, reason: 'exceeds min' };
  return { valid: true };
}

describe('Grant Amount Validation', () => {
  it('positive amount is valid', () => {
    expect(validateGrantAmount(5000).valid).toBe(true);
  });

  it('negative amount is valid (correction)', () => {
    expect(validateGrantAmount(-5000).valid).toBe(true);
  });

  it('zero is invalid', () => {
    expect(validateGrantAmount(0).valid).toBe(false);
  });

  it('exceeds max is invalid', () => {
    expect(validateGrantAmount(999999).valid).toBe(false);
  });

  it('exceeds min is invalid', () => {
    expect(validateGrantAmount(-999999).valid).toBe(false);
  });

  it('boundary max is valid', () => {
    expect(validateGrantAmount(100000).valid).toBe(true);
  });

  it('boundary min is valid', () => {
    expect(validateGrantAmount(-100000).valid).toBe(true);
  });
});

// ─── 정렬 필드 검증 ─────────────────────────────────

const ALLOWED_USER_SORT = ['created_at', 'email', 'nickname', 'status'];

function validateSortField(field: string): boolean {
  return ALLOWED_USER_SORT.includes(field);
}

describe('User List Sort Validation', () => {
  it('created_at is valid', () => expect(validateSortField('created_at')).toBe(true));
  it('email is valid', () => expect(validateSortField('email')).toBe(true));
  it('nickname is valid', () => expect(validateSortField('nickname')).toBe(true));
  it('status is valid', () => expect(validateSortField('status')).toBe(true));
  it('password_hash is invalid', () => expect(validateSortField('password_hash')).toBe(false));
  it('id is invalid', () => expect(validateSortField('id')).toBe(false));
});

// ─── 사유 텍스트 검증 ───────────────────────────────

function validateReasonText(text: string, minLength: number = 5): boolean {
  return typeof text === 'string' && text.length >= minLength;
}

describe('Reason Text Validation', () => {
  it('sufficient length is valid', () => {
    expect(validateReasonText('부정행위로 인한 제재')).toBe(true);
  });

  it('too short is invalid', () => {
    expect(validateReasonText('ab')).toBe(false);
  });

  it('empty is invalid', () => {
    expect(validateReasonText('')).toBe(false);
  });

  it('exactly 5 chars is valid', () => {
    expect(validateReasonText('abcde')).toBe(true);
  });
});

// ─── 권한 판정 ─────────────────────────────────────

const HIGH_VALUE_THRESHOLD = 10000;

function canGrantAmount(role: string, amount: number): boolean {
  if (Math.abs(amount) >= HIGH_VALUE_THRESHOLD && role !== 'admin') return false;
  return role === 'operator' || role === 'admin';
}

describe('Permission Checks', () => {
  it('admin can grant high amount', () => {
    expect(canGrantAmount('admin', 50000)).toBe(true);
  });

  it('operator cannot grant high amount', () => {
    expect(canGrantAmount('operator', 50000)).toBe(false);
  });

  it('operator can grant low amount', () => {
    expect(canGrantAmount('operator', 5000)).toBe(true);
  });

  it('user cannot grant', () => {
    expect(canGrantAmount('user', 100)).toBe(false);
  });

  it('boundary: operator at threshold', () => {
    expect(canGrantAmount('operator', 9999)).toBe(true);
  });

  it('boundary: operator at threshold+1', () => {
    expect(canGrantAmount('operator', 10000)).toBe(false);
  });
});

// ─── 제재 만료 판정 ────────────────────────────────

function isSanctionActive(startsAt: Date, expiresAt: Date | null, revokedAt: Date | null): boolean {
  const now = new Date();
  if (revokedAt && revokedAt <= now) return false;
  if (expiresAt && expiresAt <= now) return false;
  if (startsAt > now) return false;
  return true;
}

describe('Sanction Expiry', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 3600000);
  const future = new Date(now.getTime() + 3600000);

  it('active sanction with future expiry', () => {
    expect(isSanctionActive(past, future, null)).toBe(true);
  });

  it('expired sanction', () => {
    expect(isSanctionActive(past, past, null)).toBe(false);
  });

  it('revoked sanction', () => {
    expect(isSanctionActive(past, future, past)).toBe(false);
  });

  it('permanent sanction (no expiry)', () => {
    expect(isSanctionActive(past, null, null)).toBe(true);
  });

  it('future start is not active yet', () => {
    expect(isSanctionActive(future, null, null)).toBe(false);
  });
});
