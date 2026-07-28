/**
 * 권한·실패 조건 단위 테스트
 *
 * TDD: 실패 조건을 먼저 검증
 */
import { describe, it, expect } from 'vitest';

// ─── 운영자 권한 검증 ───────────────────────────────

function hasAdminAccess(role: string): boolean {
  return role === 'operator' || role === 'admin';
}

function canAccessAdminApi(role: string, _path: string): { allowed: boolean; reason?: string } {
  if (!hasAdminAccess(role)) {
    return { allowed: false, reason: '운영자 권한이 필요합니다.' };
  }
  return { allowed: true };
}

describe('Admin API Access Control', () => {
  it('user role cannot access /admin', () => {
    expect(canAccessAdminApi('user', '/admin/users').allowed).toBe(false);
  });

  it('operator role can access /admin', () => {
    expect(canAccessAdminApi('operator', '/admin/users').allowed).toBe(true);
  });

  it('admin role can access /admin', () => {
    expect(canAccessAdminApi('admin', '/admin/users').allowed).toBe(true);
  });

  it('undefined role cannot access', () => {
    expect(canAccessAdminApi('', '/admin/users').allowed).toBe(false);
  });

  it('null role cannot access', () => {
    expect(canAccessAdminApi(null as unknown as string, '/admin/users').allowed).toBe(false);
  });
});

// ─── 고액 지급 권한 ─────────────────────────────────

const HIGH_VALUE = 10000;

function canGrantAmount(role: string, amount: number): { allowed: boolean; reason?: string } {
  if (role !== 'operator' && role !== 'admin') {
    return { allowed: false, reason: '운영자 권한이 필요합니다.' };
  }
  if (Math.abs(amount) >= HIGH_VALUE && role !== 'admin') {
    return { allowed: false, reason: '고액 지급은 admin 권한이 필요합니다.' };
  }
  return { allowed: true };
}

describe('High-Value Grant Permission', () => {
  it('operator: 9999 allowed', () => {
    expect(canGrantAmount('operator', 9999).allowed).toBe(true);
  });

  it('operator: 10000 denied (threshold)', () => {
    const result = canGrantAmount('operator', 10000);
    expect(result.allowed).toBe(false);
  });

  it('operator: -10000 denied (negative threshold)', () => {
    const result = canGrantAmount('operator', -10000);
    expect(result.allowed).toBe(false);
  });

  it('admin: 100000 allowed', () => {
    expect(canGrantAmount('admin', 100000).allowed).toBe(true);
  });

  it('user: 100 denied', () => {
    expect(canGrantAmount('user', 100).allowed).toBe(false);
  });
});

// ─── 승인 범위 검증 ─────────────────────────────────

function validateGrantScope(resourceType: string, resourceCode: string): { valid: boolean; reason?: string } {
  if (resourceType !== 'currency' && resourceType !== 'item') {
    return { valid: false, reason: 'resourceType은 currency 또는 item이어야 합니다.' };
  }
  if (resourceType === 'currency') {
    const allowed = ['electricity', 'scrap'];
    if (!allowed.includes(resourceCode)) {
      return { valid: false, reason: '지원하지 않는 재화입니다.' };
    }
  }
  return { valid: true };
}

describe('Grant Scope Validation', () => {
  it('currency + electricity is valid', () => {
    expect(validateGrantScope('currency', 'electricity').valid).toBe(true);
  });

  it('currency + scrap is valid', () => {
    expect(validateGrantScope('currency', 'scrap').valid).toBe(true);
  });

  it('currency + blueprint is invalid', () => {
    const result = validateGrantScope('currency', 'blueprint');
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('item type always valid', () => {
    expect(validateGrantScope('item', 'anything').valid).toBe(true);
  });

  it('invalid resourceType', () => {
    expect(validateGrantScope('unknown', 'scrap').valid).toBe(false);
  });
});

// ─── 제재 타입 검증 ─────────────────────────────────

const ALLOWED_SANCTIONS = ['suspension', 'battle_restriction', 'reward_restriction'];

function validateSanctionType(type: string): { valid: boolean; reason?: string } {
  if (!ALLOWED_SANCTIONS.includes(type)) {
    return { valid: false, reason: '지원하지 않는 제재 유형입니다.' };
  }
  return { valid: true };
}

describe('Sanction Type Validation', () => {
  it('suspension is valid', () => expect(validateSanctionType('suspension').valid).toBe(true));
  it('battle_restriction is valid', () => expect(validateSanctionType('battle_restriction').valid).toBe(true));
  it('reward_restriction is valid', () => expect(validateSanctionType('reward_restriction').valid).toBe(true));
  it('chat_mute is invalid (no chat)', () => expect(validateSanctionType('chat_mute').valid).toBe(false));
  it('empty string invalid', () => expect(validateSanctionType('').valid).toBe(false));
});

// ─── 사유 필수 검증 ─────────────────────────────────

function validateRequiredReason(text: string | undefined): { valid: boolean; reason?: string } {
  if (!text || text.length < 5) {
    return { valid: false, reason: '충분한 사유가 필요합니다 (5자 이상).' };
  }
  return { valid: true };
}

describe('Reason Validation', () => {
  it('sufficient reason is valid', () => {
    expect(validateRequiredReason('부정행위로 인한 제재').valid).toBe(true);
  });

  it('too short reason is invalid', () => {
    expect(validateRequiredReason('ab').valid).toBe(false);
  });

  it('empty reason is invalid', () => {
    expect(validateRequiredReason('').valid).toBe(false);
  });

  it('undefined reason is invalid', () => {
    expect(validateRequiredReason(undefined).valid).toBe(false);
  });
});

// ─── 만료일 검증 ────────────────────────────────────

function validateExpiryDate(expStr: string | undefined, now: Date): { valid: boolean; reason?: string } {
  if (!expStr) return { valid: true, reason: '영구 제재' };
  const expDate = new Date(expStr);
  if (isNaN(expDate.getTime())) return { valid: false, reason: '유효하지 않은 만료일입니다.' };
  if (expDate <= now) return { valid: false, reason: '만료일은 현재 이후여야 합니다.' };
  const maxExpiry = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  if (expDate > maxExpiry) return { valid: false, reason: '최대 제재 기간은 365일입니다.' };
  return { valid: true };
}

describe('Expiry Date Validation', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  it('valid future date', () => {
    expect(validateExpiryDate('2026-08-28T12:00:00Z', now).valid).toBe(true);
  });

  it('past date is invalid', () => {
    expect(validateExpiryDate('2026-07-27T12:00:00Z', now).valid).toBe(false);
  });

  it('undefined = permanent (valid)', () => {
    const result = validateExpiryDate(undefined, now);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('영구 제재');
  });

  it('exceeds 365 days', () => {
    expect(validateExpiryDate('2027-08-01T12:00:00Z', now).valid).toBe(false);
  });

  it('invalid date string', () => {
    expect(validateExpiryDate('not-a-date', now).valid).toBe(false);
  });
});

// ─── 중복 제재 검증 ─────────────────────────────────

function hasActiveSanctionSameType(
  existing: { type: string; status: string }[],
  newType: string,
): { allowed: boolean; reason?: string } {
  const active = existing.filter((s) => s.status === 'active' && s.type === newType);
  if (active.length > 0) {
    return { allowed: false, reason: '동일한 유형의 활성 제재가 이미 존재합니다.' };
  }
  return { allowed: true };
}

describe('Duplicate Sanction Prevention', () => {
  it('no existing sanctions → allowed', () => {
    expect(hasActiveSanctionSameType([], 'suspension').allowed).toBe(true);
  });

  it('different type active → allowed', () => {
    expect(hasActiveSanctionSameType(
      [{ type: 'battle_restriction', status: 'active' }],
      'suspension',
    ).allowed).toBe(true);
  });

  it('same type active → denied', () => {
    expect(hasActiveSanctionSameType(
      [{ type: 'suspension', status: 'active' }],
      'suspension',
    ).allowed).toBe(false);
  });

  it('same type revoked → allowed', () => {
    expect(hasActiveSanctionSameType(
      [{ type: 'suspension', status: 'revoked' }],
      'suspension',
    ).allowed).toBe(true);
  });
});
