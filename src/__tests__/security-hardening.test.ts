import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import EmbeddedPostgres from 'embedded-postgres';

// Isolated data directory: stores read these paths at import time, so set them before importing the app.
const dataDir = mkdtempSync(join(tmpdir(), 'idle-sec-test-'));
const ENV_KEYS = [
  'DB_DRIVER', 'AUTH_PROVIDER', 'TRUST_PROXY', 'DATABASE_URL',
  'DATA_FILE', 'DATA_FILE_USERS', 'DATA_FILE_SESSIONS', 'DATA_FILE_SANCTIONS', 'DATA_FILE_PROFILES',
  'DATA_FILE_WALLETS', 'DATA_FILE_LEDGER', 'DATA_FILE_ADMIN_GRANTS', 'DATA_FILE_ITEM_LEDGER',
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
process.env.DB_DRIVER = 'json';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_FILE = join(dataDir, 'data.json');
process.env.DATA_FILE_USERS = join(dataDir, 'users.json');
process.env.DATA_FILE_SESSIONS = join(dataDir, 'sessions.json');
process.env.DATA_FILE_SANCTIONS = join(dataDir, 'sanctions.json');
process.env.DATA_FILE_PROFILES = join(dataDir, 'profiles.json');
process.env.DATA_FILE_WALLETS = join(dataDir, 'wallets.json');
process.env.DATA_FILE_LEDGER = join(dataDir, 'ledger.json');
process.env.DATA_FILE_ADMIN_GRANTS = join(dataDir, 'admin-grants.json');
process.env.DATA_FILE_ITEM_LEDGER = join(dataDir, 'item-ledger.json');
delete process.env.TRUST_PROXY;
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');
const { resetAllRepos } = await import('../provider.js');
const { jsonAuthRepo, resetAuthStores } = await import('../store-auth.js');
const { clearRateLimits } = await import('../shared/rate-limit.js');
const { clearIdempotencyCache } = await import('../shared/idempotency.js');
const { withPostgresConnection, closePostgresPool } = await import('../db/postgres-connection.js');
const { migratePostgres } = await import('../db/postgres-migrate.js');

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production';
const LOGIN_BODY = { email: 'nobody@example.test', password: 'wrong-password' };

type Env = { incoming: { socket: { remoteAddress?: string } } };
const peer = (remoteAddress?: string): Env => ({ incoming: { socket: { remoteAddress } } });

function post(path: string, body: unknown, headers: Record<string, string> = {}, env?: Env) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, env);
}

const login = (headers: Record<string, string> = {}, env?: Env) => post('/api/auth/login', LOGIN_BODY, headers, env);
const fromIp = (ip: string) => ({ 'X-Forwarded-For': ip });

let registerSeq = 0;
function register(headers: Record<string, string> = {}) {
  const n = ++registerSeq;
  return post(
    '/api/auth/register',
    { email: `hardening-${n}@example.test`, password: 'password123!', nickname: `Hardening${n}` },
    { 'Idempotency-Key': randomUUID(), ...headers },
  );
}
const refresh = (headers: Record<string, string> = {}) => post('/api/auth/refresh', { refreshToken: 'not-a-real-token' }, headers);

async function exhaust(send: () => Promise<Response>, times: number, expected: number) {
  for (let i = 0; i < times; i++) expect((await send()).status).toBe(expected);
}

beforeEach(() => {
  process.env.DB_DRIVER = 'json';
  clearRateLimits();
  clearIdempotencyCache();
  resetAllRepos();
  resetAuthStores();
});

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

afterAll(() => {
  clearRateLimits();
  clearIdempotencyCache();
  resetAllRepos();
  resetAuthStores();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe('인증 라우트 IP 단위 rate limit (신뢰 프록시 뒤)', () => {
  beforeEach(() => { process.env.TRUST_PROXY = 'true'; });

  it('login: IP A는 10회 후 429 RATE_LIMITED, IP B는 영향 없음', async () => {
    await exhaust(() => login(fromIp('203.0.113.1')), 10, 401);
    const blocked = await login(fromIp('203.0.113.1'));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await login(fromIp('203.0.113.2'))).status).toBe(401);
  });

  it('register: IP A는 5회 후 429, IP B는 가입 가능', async () => {
    await exhaust(() => register(fromIp('203.0.113.1')), 5, 201);
    const blocked = await register(fromIp('203.0.113.1'));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await register(fromIp('203.0.113.2'))).status).toBe(201);
  });

  it('refresh: IP A는 20회 후 429, IP B는 영향 없음', async () => {
    await exhaust(() => refresh(fromIp('203.0.113.1')), 20, 401);
    const blocked = await refresh(fromIp('203.0.113.1'));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await refresh(fromIp('203.0.113.2'))).status).toBe(401);
  });

  it('IPv4-mapped IPv6(::ffff:a.b.c.d)는 IPv4와 같은 버킷으로 정규화된다', async () => {
    await exhaust(() => login(fromIp('::ffff:203.0.113.5')), 10, 401);
    expect((await login(fromIp('203.0.113.5'))).status).toBe(429);
  });

  it('IPv6는 대소문자와 무관하게 같은 버킷이다', async () => {
    await exhaust(() => login(fromIp('2001:DB8::1')), 10, 401);
    expect((await login(fromIp('2001:db8::1'))).status).toBe(429);
    expect((await login(fromIp('2001:db8::2'))).status).toBe(401);
  });

  it('X-Forwarded-For는 첫 번째 유효 IP를 사용하고 잘못된 값은 건너뛴다', async () => {
    await exhaust(() => login(fromIp('evil-spoofed, 198.51.100.1, 10.0.0.1')), 10, 401);
    expect((await login(fromIp('198.51.100.1, 10.0.0.2'))).status).toBe(429);
  });

  it('CF-Connecting-IP가 X-Forwarded-For보다 우선하고, 잘못된 값이면 다음 헤더로 넘어간다', async () => {
    await exhaust(() => login({ 'CF-Connecting-IP': '198.51.100.9', ...fromIp('198.51.100.1') }), 10, 401);
    expect((await login({ 'CF-Connecting-IP': '198.51.100.9', ...fromIp('198.51.100.2') })).status).toBe(429);
    expect((await login(fromIp('198.51.100.1'))).status).toBe(401);
    await exhaust(() => login({ 'CF-Connecting-IP': 'not-an-ip', 'X-Real-IP': '198.51.100.30' }), 10, 401);
    expect((await login({ 'X-Real-IP': '198.51.100.30' })).status).toBe(429);
  });

  it('유효한 IP가 하나도 없으면 임의 문자열을 키로 쓰지 않고 공용(anonymous) 버킷을 쓴다', async () => {
    await exhaust(() => login(fromIp('spoof-1')), 10, 401);
    expect((await login(fromIp('spoof-2'))).status).toBe(429);
    expect((await login(fromIp('203.0.113.77'))).status).toBe(401);
  });

  it('TRUST_PROXY=cloudflare: CF-Connecting-IP만 신뢰하고 X-Forwarded-For는 무시한다', async () => {
    process.env.TRUST_PROXY = 'cloudflare';
    await exhaust(() => login({ 'CF-Connecting-IP': '203.0.113.10', ...fromIp('198.51.100.1') }), 10, 401);
    expect((await login({ 'CF-Connecting-IP': '203.0.113.10', ...fromIp('198.51.100.2') })).status).toBe(429);
    expect((await login({ 'CF-Connecting-IP': '203.0.113.11', ...fromIp('198.51.100.1') })).status).toBe(401);
    // CF 헤더가 없거나 잘못되면 anonymous 버킷 (XFF 무시)
    await exhaust(() => login(fromIp('198.51.100.50')), 10, 401);
    expect((await login(fromIp('198.51.100.51'))).status).toBe(429);
    expect((await login({ 'CF-Connecting-IP': '203.0.113.12' })).status).toBe(401);
  });
});

describe('신뢰 프록시 없음: 헤더 스푸핑 방어', () => {
  it('CF-Connecting-IP / X-Forwarded-For / X-Real-IP를 바꿔도 같은 peer 버킷이라 11번째에 429', async () => {
    const env = peer('192.0.2.1');
    for (let i = 0; i < 10; i++) {
      const res = await login({
        'CF-Connecting-IP': `203.0.113.${i + 1}`,
        'X-Forwarded-For': `198.51.100.${i + 1}`,
        'X-Real-IP': `192.0.2.${100 + i}`,
      }, env);
      expect(res.status).toBe(401);
    }
    const blocked = await login({ 'CF-Connecting-IP': '203.0.113.200', 'X-Forwarded-For': '198.51.100.200' }, env);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('서로 다른 peer 주소(::ffff: 매핑 포함)는 정규화되어 분리/통합된다', async () => {
    await exhaust(() => login({}, peer('::ffff:192.0.2.1')), 10, 401);
    expect((await login({}, peer('192.0.2.1'))).status).toBe(429);
    expect((await login({}, peer('192.0.2.2'))).status).toBe(401);
  });

  it('peer 주소가 없으면 anonymous 버킷을 공유하고 스푸핑 헤더는 무시한다', async () => {
    await exhaust(() => login(fromIp('203.0.113.1')), 10, 401);
    expect((await login({ 'CF-Connecting-IP': '203.0.113.2' })).status).toBe(429);
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
  const bearerFor = (userId: string) => `Bearer ${jwt.sign({ sub: userId, type: 'access' }, JWT_SECRET, { expiresIn: '1h' })}`;

  it('토큰 없음 → 401', async () => {
    expect((await app.request('/metrics')).status).toBe(401);
  });

  it('일반 사용자 토큰 → 403', async () => {
    expect((await app.request('/metrics', { headers: { Authorization: bearerFor('metrics-user') } })).status).toBe(403);
  });

  it('운영자/관리자 토큰 → 200', async () => {
    const res = await app.request('/metrics', { headers: { Authorization: bearerFor('metrics-admin') } });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('requests');
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('PostgreSQL: 요청 트랜잭션 롤백에도 rate limit 카운터 유지', () => {
  let postgres: EmbeddedPostgres | undefined;
  let pgStarted = false;
  let pgDir: string | undefined;
  let connectionString = '';

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), 'idle-sec-pg-'));
    const password = randomUUID();
    const port = await freePort();
    postgres = new EmbeddedPostgres({
      databaseDir: pgDir, user: 'postgres', password, port,
      persistent: true, createPostgresUser: false,
      initdbFlags: ['--locale=C', '--encoding=UTF8'],
      onLog: () => {}, onError: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    pgStarted = true;
    connectionString = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
    await migratePostgres(connectionString);
  }, 180_000);

  afterAll(async () => {
    await closePostgresPool();
    if (pgStarted) await postgres?.stop();
    if (pgDir) rmSync(pgDir, { recursive: true, force: true });
  }, 60_000);

  beforeEach(() => {
    process.env.DB_DRIVER = 'postgres';
    process.env.TRUST_PROXY = 'true';
    process.env.DATABASE_URL = connectionString;
    resetAllRepos();
  });

  afterEach(() => {
    process.env.DB_DRIVER = 'json';
    delete process.env.DATABASE_URL;
    resetAllRepos();
  });

  const viaWorkerConnection = (ip: string) => withPostgresConnection(connectionString, () => login(fromIp(ip)));

  it('Workers 방식(withPostgresConnection): 401로 롤백되는 실패 로그인 10회 후 11번째는 429', async () => {
    await exhaust(() => viaWorkerConnection('203.0.113.1'), 10, 401);
    const blocked = await viaWorkerConnection('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await viaWorkerConnection('203.0.113.2')).status).toBe(401);
  }, 60_000);

  it('Workers 방식: Promise.all 동시 버스트에서도 정확히 10건만 통과한다', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => viaWorkerConnection('203.0.113.3')));
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
  }, 60_000);

  it('Node 서버 방식(DATABASE_URL 풀): 롤백 후에도 카운트가 유지되고 동시 버스트가 정확하다', async () => {
    await exhaust(() => login(fromIp('203.0.113.4')), 10, 401);
    expect((await login(fromIp('203.0.113.4'))).status).toBe(429);
    const results = await Promise.all(Array.from({ length: 25 }, () => login(fromIp('203.0.113.5'))));
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
  }, 60_000);
});
