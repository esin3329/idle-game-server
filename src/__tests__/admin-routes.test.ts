process.env.DB_DRIVER = 'json';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { resetAllRepos } from '../provider.js';
import { jsonAuthRepo, resetAuthStores } from '../store-auth.js';
import { jsonWalletRepo, resetWalletStores } from '../store-wallet.js';
import { resetAdminStores, seedJsonSecurityEvent } from '../store-admin.js';
import { resetItemLedger } from '../store-item-ledger.js';
import { clearRateLimits } from '../shared/rate-limit.js';
import { clearIdempotencyCache } from '../shared/idempotency.js';

const { app } = await import('../app.js');

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production';
const ADMIN_ID = 'admin-op-1';
const OPERATOR_ID = 'operator-op-1';
const TARGET_USER_ID = 'target-user-1';
const TARGET_PLAYER_ID = 'target-player-1';

const DATA_FILES = [
  'data-users.json',
  'data-sessions.json',
  'data-sanctions.json',
  'data-profiles.json',
  'data-wallets.json',
  'data-ledger.json',
  'data-admin-grants.json',
  'data-item-ledger.json',
];

function cleanupDataFiles() {
  for (const file of DATA_FILES) {
    for (const suffix of ['', '.bak']) {
      const path = join(process.cwd(), file + suffix);
      if (existsSync(path)) {
        try { unlinkSync(path); } catch {}
      }
    }
  }
}

function bearerFor(userId: string, role: string) {
  const token = jwt.sign({ sub: userId, type: 'access', role }, JWT_SECRET, { expiresIn: '1h' });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  };
}

beforeEach(async () => {
  process.env.DB_DRIVER = 'json';
  cleanupDataFiles();
  clearRateLimits();
  clearIdempotencyCache();
  resetAllRepos();
  resetAuthStores();
  resetWalletStores();
  resetAdminStores();
  resetItemLedger();

  const now = new Date().toISOString();
  await jsonAuthRepo.createUser({
    id: ADMIN_ID, email: 'admin@example.test', nickname: '관리자',
    passwordHash: 'secret-hash', status: 'active', role: 'admin', createdAt: now, updatedAt: now,
  });
  await jsonAuthRepo.createUser({
    id: OPERATOR_ID, email: 'operator@example.test', nickname: '운영자',
    passwordHash: 'secret-hash', status: 'active', role: 'operator', createdAt: now, updatedAt: now,
  });
  await jsonAuthRepo.createUser({
    id: TARGET_USER_ID, email: 'target@example.test', nickname: '대상유저',
    passwordHash: 'secret-hash', status: 'active', role: 'user', createdAt: now, updatedAt: now,
  });
  await jsonAuthRepo.createProfile({
    id: crypto.randomUUID(), playerId: TARGET_PLAYER_ID, userId: TARGET_USER_ID,
    nickname: '대상유저', highestStage: 1, createdAt: now, updatedAt: now,
  });
  await jsonAuthRepo.createWallet({
    id: crypto.randomUUID(), playerId: TARGET_PLAYER_ID, userId: TARGET_USER_ID,
    currency: 'electricity', electricity: 100, electricityPerSecond: 1, scrap: 0, balance: 100,
    lastClaimedAt: now, createdAt: now, updatedAt: now,
  });
});

afterAll(() => {
  cleanupDataFiles();
  resetAllRepos();
  resetAuthStores();
  resetWalletStores();
  resetAdminStores();
  resetItemLedger();
});

describe('Admin API 권한, 정책 및 저장소 통합 (JSON)', () => {
  it('지급 입력 검증: 0, 상한/하한 초과, 미지원 재화, 짧은 사유는 400을 반환한다', async () => {
    const cases = [
      { resourceType: 'currency', resourceCode: 'electricity', amount: 0, reasonText: '사유 다섯자 이상' },
      { resourceType: 'currency', resourceCode: 'electricity', amount: 100001, reasonText: '상한 초과 테스트' },
      { resourceType: 'currency', resourceCode: 'electricity', amount: -100001, reasonText: '하한 초과 테스트' },
      { resourceType: 'currency', resourceCode: 'blueprint', amount: 10, reasonText: '미지원 재화 테스트' },
      { resourceType: 'currency', resourceCode: 'scrap', amount: 10, reasonText: '짧음' },
    ];
    for (const body of cases) {
      const res = await app.request(`/api/admin/users/${TARGET_USER_ID}/grants`, {
        method: 'POST',
        headers: bearerFor(ADMIN_ID, 'admin'),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it('고액 지급(>=10000)은 admin만 가능하고 operator는 403으로 차단되며, 성공 시 지갑과 감사 로그에 기록된다', async () => {
    const lowRes = await app.request(`/api/admin/users/${TARGET_USER_ID}/grants`, {
      method: 'POST',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({
        resourceType: 'currency', resourceCode: 'electricity', amount: 5000, reasonText: '일반 보상 지급 테스트',
      }),
    });
    expect(lowRes.status).toBe(201);

    for (const highAmount of [10000, -10000]) {
      const highDenied = await app.request(`/api/admin/users/${TARGET_USER_ID}/grants`, {
        method: 'POST',
        headers: bearerFor(OPERATOR_ID, 'operator'),
        body: JSON.stringify({
          resourceType: 'currency', resourceCode: 'electricity', amount: highAmount, reasonText: '고액 지급 시도 테스트',
        }),
      });
      expect(highDenied.status).toBe(403);
    }

    const adminHigh = await app.request(`/api/admin/users/${TARGET_USER_ID}/grants`, {
      method: 'POST',
      headers: bearerFor(ADMIN_ID, 'admin'),
      body: JSON.stringify({
        resourceType: 'currency', resourceCode: 'scrap', amount: 50000, reasonText: '관리자 고액 지급 테스트',
      }),
    });
    expect(adminHigh.status).toBe(201);

    const balance = await jsonWalletRepo.getBalance(TARGET_PLAYER_ID);
    expect(balance?.balance).toBe(5100);
    expect(balance?.scrap).toBe(50000);

    const auditRes = await app.request('/api/admin/audit-logs?action=operator_grant', {
      headers: bearerFor(ADMIN_ID, 'admin'),
    });
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json() as { logs: any[] };
    expect(auditBody.logs.length).toBeGreaterThanOrEqual(2);
    expect(auditBody.logs[0].action).toBe('operator_grant');
  });

  it('제재 생성·중복 방지·조회·철회가 동작하고 사용자 상세 조회 시 해시를 노출하지 않는다', async () => {
    const detailRes = await app.request(`/api/admin/users/${TARGET_USER_ID}`, {
      headers: bearerFor(OPERATOR_ID, 'operator'),
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as Record<string, unknown>;
    expect(detail.email).toBe('target@example.test');
    expect(detail).not.toHaveProperty('passwordHash');

    const createRes = await app.request(`/api/admin/users/${TARGET_USER_ID}/sanctions`, {
      method: 'POST',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({ type: 'battle_restriction', reasonText: '비정상 전투 패턴 확인' }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: string };

    const dupRes = await app.request(`/api/admin/users/${TARGET_USER_ID}/sanctions`, {
      method: 'POST',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({ type: 'battle_restriction', reasonText: '동일 유형 중복 제재 시도' }),
    });
    expect(dupRes.status).toBe(409);
    expect(await dupRes.json()).toMatchObject({ code: 'DUPLICATE_SANCTION' });

    const listRes = await app.request(`/api/admin/users/${TARGET_USER_ID}/sanctions`, {
      headers: bearerFor(OPERATOR_ID, 'operator'),
    });
    expect(listRes.status).toBe(200);
    expect((await listRes.json() as { sanctions: any[] }).sanctions).toHaveLength(1);

    const revokeRes = await app.request(`/api/admin/users/${TARGET_USER_ID}/sanctions/${created.id}/revoke`, {
      method: 'PUT',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({ reason: '소명 확인으로 철회' }),
    });
    expect(revokeRes.status).toBe(200);
    expect(await revokeRes.json()).toEqual({ status: 'revoked' });
  });

  it('운영자 생성·목록·역할 변경은 admin만 가능하며 passwordHash를 반환하지 않는다', async () => {
    const deniedCreate = await app.request('/api/admin/operators', {
      method: 'POST',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({
        email: 'newop@example.test', password: 'password1234', nickname: '신규운영자', role: 'operator',
      }),
    });
    expect(deniedCreate.status).toBe(403);

    const createdRes = await app.request('/api/admin/operators', {
      method: 'POST',
      headers: bearerFor(ADMIN_ID, 'admin'),
      body: JSON.stringify({
        email: 'newop@example.test', password: 'password1234', nickname: '신규운영자', role: 'operator',
      }),
    });
    expect(createdRes.status).toBe(201);
    const created = await createdRes.json() as { id: string; role: string };
    expect(created.role).toBe('operator');

    const roleUpdateDenied = await app.request(`/api/admin/operators/${created.id}/role`, {
      method: 'PUT',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({ role: 'admin', reason: '권한 승격' }),
    });
    expect(roleUpdateDenied.status).toBe(403);

    const roleUpdated = await app.request(`/api/admin/operators/${created.id}/role`, {
      method: 'PUT',
      headers: bearerFor(ADMIN_ID, 'admin'),
      body: JSON.stringify({ role: 'admin', reason: '관리자 위임' }),
    });
    expect(roleUpdated.status).toBe(200);
    expect(await roleUpdated.json()).toEqual({ id: created.id, role: 'admin' });

    const listRes = await app.request('/api/admin/operators', {
      headers: bearerFor(ADMIN_ID, 'admin'),
    });
    expect(listRes.status).toBe(200);
    const { operators } = await listRes.json() as { operators: Record<string, unknown>[] };
    expect(operators.some((op) => op.id === created.id && op.role === 'admin')).toBe(true);
    for (const op of operators) {
      expect(op).not.toHaveProperty('passwordHash');
    }
  });

  it('보안 이벤트 필터·잘못된 날짜 400 및 리뷰 정상/404를 처리한다', async () => {
    const eventId = crypto.randomUUID();
    seedJsonSecurityEvent({
      id: eventId,
      eventType: 'battle_rejected',
      userId: TARGET_USER_ID,
      playerId: TARGET_PLAYER_ID,
      code: 'KILLS_OUT_OF_RANGE',
      severity: 'warn',
      source: 'battle',
      safeDetails: JSON.stringify({ reported: 999 }),
    });

    const invalidDateRes = await app.request('/api/admin/security-events?start=not-a-date', {
      headers: bearerFor(OPERATOR_ID, 'operator'),
    });
    expect(invalidDateRes.status).toBe(400);

    const listRes = await app.request('/api/admin/security-events?eventType=battle_rejected', {
      headers: bearerFor(OPERATOR_ID, 'operator'),
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { events: any[] };
    expect(listBody.events).toHaveLength(1);
    expect(listBody.events[0].safeDetails).toEqual({ reported: 999 });

    const missingReview = await app.request(`/api/admin/security-events/${crypto.randomUUID()}/review`, {
      method: 'PUT',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({ resolution: 'false_positive' }),
    });
    expect(missingReview.status).toBe(404);

    const reviewRes = await app.request(`/api/admin/security-events/${eventId}/review`, {
      method: 'PUT',
      headers: bearerFor(OPERATOR_ID, 'operator'),
      body: JSON.stringify({ resolution: 'confirmed', resolutionNote: '제재 적용 완료' }),
    });
    expect(reviewRes.status).toBe(200);
    expect(await reviewRes.json()).toEqual({ status: 'reviewed' });
  });
});
