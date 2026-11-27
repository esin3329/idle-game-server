process.env.DB_DRIVER = 'json';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { resetAllRepos } from '../provider.js';
import { jsonAuthRepo, resetAuthStores } from '../store-auth.js';
import { clearRateLimits } from '../shared/rate-limit.js';
import { clearIdempotencyCache } from '../shared/idempotency.js';

const { app } = await import('../app.js');

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production';
const DATA_FILES = ['data-users.json', 'data-sessions.json', 'data-sanctions.json', 'data-profiles.json', 'data-wallets.json'];

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

function bearerFor(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId, type: 'access' }, JWT_SECRET, { expiresIn: '1h' })}`;
}

function post(path: string, ip: string, body: unknown, extra: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...extra },
    body: JSON.stringify(body),
  });
}

function login(ip: string) {
  return post('/api/auth/login', ip, { email: 'nobody@example.test', password: 'wrong-password' });
}

let registerSeq = 0;
function register(ip: string) {
  const n = ++registerSeq;
  return post(
    '/api/auth/register', ip,
    { email: `hardening-${n}@example.test`, password: 'password123!', nickname: `Hardening${n}` },
    { 'Idempotency-Key': crypto.randomUUID() },
  );
}

function refresh(ip: string) {
  return post('/api/auth/refresh', ip, { refreshToken: 'not-a-real-token' });
}

beforeEach(() => {
  cleanupDataFiles();
  clearRateLimits();
  clearIdempotencyCache();
  resetAllRepos();
  resetAuthStores();
});

afterAll(() => {
  clearRateLimits();
  clearIdempotencyCache();
  cleanupDataFiles();
  resetAllRepos();
  resetAuthStores();
});

describe('인증 라우트 IP 단위 rate limit', () => {
  it('login: IP A는 10회 후 429, IP B는 영향 없음', async () => {
    for (let i = 0; i < 10; i++) expect((await login('203.0.113.1')).status).toBe(401);
    const blocked = await login('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await login('203.0.113.2')).status).toBe(401);
  });

  it('register: IP A는 5회 후 429, IP B는 가입 가능', async () => {
    for (let i = 0; i < 5; i++) expect((await register('203.0.113.1')).status).toBe(201);
    const blocked = await register('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await register('203.0.113.2')).status).toBe(201);
  });

  it('refresh: IP A는 20회 후 429, IP B는 영향 없음', async () => {
    for (let i = 0; i < 20; i++) expect((await refresh('203.0.113.1')).status).toBe(401);
    const blocked = await refresh('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await refresh('203.0.113.2')).status).toBe(401);
  });

  it('X-Forwarded-For는 첫 번째 IP만 키로 사용하고 CF-Connecting-IP가 우선한다', async () => {
    for (let i = 0; i < 10; i++) await login('198.51.100.1, 10.0.0.1');
    expect((await login('198.51.100.1, 10.0.0.2')).status).toBe(429);
    const viaCf = await post('/api/auth/login', '198.51.100.1', { email: 'nobody@example.test', password: 'x' }, { 'CF-Connecting-IP': '198.51.100.9' });
    expect(viaCf.status).toBe(401);
  });
});

describe('GET /metrics 운영자 인증', () => {
  beforeEach(async () => {
    const now = new Date().toISOString();
    for (const [id, role] of [['metrics-admin', 'admin'], ['metrics-user', 'user']] as const) {
      await jsonAuthRepo.createUser({
        id, email: `${id}@example.test`, nickname: id,
        passwordHash: 'secret-hash', status: 'active', role, createdAt: now, updatedAt: now,
      });
    }
  });

  it('토큰 없음 → 401', async () => {
    expect((await app.request('/metrics')).status).toBe(401);
  });

  it('일반 사용자 토큰 → 403', async () => {
    const res = await app.request('/metrics', { headers: { Authorization: bearerFor('metrics-user') } });
    expect(res.status).toBe(403);
  });

  it('운영자/관리자 토큰 → 200', async () => {
    const res = await app.request('/metrics', { headers: { Authorization: bearerFor('metrics-admin') } });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('requests');
  });
});
