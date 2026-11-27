/**
 * HTTP 통합 테스트 (Hono app.request + JSON 저장소 + 실제 JWT)
 *
 * 라우트 → 미들웨어(JWT/멱등성/레이트리밋) → 서비스 → 저장소까지 한 번에 통과시킨다.
 * 모든 데이터 파일은 임시 디렉터리로 격리하며, Date만 고정해 시간 의존 검증을 결정론적으로 만든다.
 */
process.env.DB_DRIVER = 'json';
process.env.JWT_ACCESS_SECRET ||= 'dev-secret-change-in-production';
process.env.JWT_REFRESH_SECRET ||= 'dev-secret-change-in-production';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';

// ─── 데이터 파일 격리 (store 모듈은 import 시점에 경로를 읽는다) ───────────
// 아래 동적 import는 위의 env 설정 이후에 모듈을 평가해야 하므로 정적 import로 대체할 수 없다.

const tmpDir = mkdtempSync(join(tmpdir(), 'idle-game-integration-'));
const STORE_ENV = [
  'USERS', 'SESSIONS', 'SANCTIONS', 'PROFILES', 'WALLETS', 'LEDGER', 'ITEM_LEDGER',
  'ADMIN_GRANTS', 'BATTLES', 'BEVENTS', 'RESULTS', 'PARTS', 'EQUIP', 'CONFIGS',
  'BLUEPRINTS', 'CRAFTS', 'RESEARCH',
] as const;
for (const name of STORE_ENV) {
  process.env[`DATA_FILE_${name}`] = join(tmpDir, `${name.toLowerCase()}.json`);
}

const { app } = await import('../app.js');
const { resetAllRepos } = await import('../provider.js');
const { jsonAuthRepo, resetAuthStores } = await import('../store-auth.js');
const { resetWalletStores } = await import('../store-wallet.js');
const { resetBattleStores } = await import('../store-battle.js');
const { resetCraftingStores } = await import('../store-crafting.js');
const { resetItemLedger } = await import('../store-item-ledger.js');
const { resetAdminStores } = await import('../store-admin.js');
const { resetPartsStores } = await import('../store-parts.js');
const { resetResearchStores } = await import('../store-research.js');
const { setDataFilePath, createPlayer } = await import('../store.js');
const { clearRateLimits } = await import('../shared/rate-limit.js');
const { clearIdempotencyCache } = await import('../shared/idempotency.js');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const PASSWORD = 'integration-pass-1';
const T0 = Date.now();

function resetFiles(): void {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const dataFile = join(tmpDir, `players-${crypto.randomUUID()}.json`);
  writeFileSync(dataFile, '[]', 'utf-8');
  setDataFilePath(dataFile);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  clearIdempotencyCache();
  clearRateLimits();
  resetFiles();
  resetAllRepos();
  resetAuthStores();
  resetWalletStores();
  resetBattleStores();
  resetCraftingStores();
  resetItemLedger();
  resetAdminStores();
  resetPartsStores();
  resetResearchStores();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  resetAllRepos();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── 헬퍼 ───────────────────────────────────────────

// 응답 본문은 라우트별로 형태가 다른 외부 JSON이다. 테스트는 필요한 필드만 단언하므로 느슨한 타입을 쓴다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = any;
interface Res { status: number; body: JsonBody }
interface CallOptions { token?: string; body?: unknown; key?: string | null }

/** 변경 요청에는 항상 고유 Idempotency-Key를 붙인다 (key: null이면 생략). */
async function call(method: string, path: string, opts: CallOptions = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (method !== 'GET' && opts.key !== null) headers['Idempotency-Key'] = opts.key ?? crypto.randomUUID();
  const res = await app.request(`/api${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

interface TestUser {
  email: string;
  nickname: string;
  userId: string;
  playerId: string;
  accessToken: string;
  refreshToken: string;
}

let userSeq = 0;
function uniqueIdentity(label: string): { email: string; nickname: string } {
  const suffix = `${++userSeq}${crypto.randomUUID().slice(0, 6)}`;
  return { email: `${label}-${suffix}@example.test`, nickname: `${label}${suffix}`.slice(0, 20) };
}

async function register(label = 'user'): Promise<TestUser> {
  const identity = uniqueIdentity(label);
  const res = await call('POST', '/auth/register', { body: { ...identity, password: PASSWORD } });
  expect(res.status).toBe(201);
  return {
    ...identity,
    userId: res.body.userId,
    playerId: res.body.playerId,
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
  };
}

async function registerAdmin(): Promise<string> {
  const now = new Date().toISOString();
  const id = `admin-${crypto.randomUUID()}`;
  await jsonAuthRepo.createUser({
    id, email: `${id}@example.test`, nickname: id.slice(0, 20), passwordHash: '',
    status: 'active', role: 'admin', createdAt: now, updatedAt: now,
  });
  return jwt.sign({ sub: id, type: 'access', role: 'admin' }, JWT_ACCESS_SECRET, { expiresIn: 3600 });
}

/** 로그인 사용자의 플레이어를 레거시 player 저장소에도 만들어 /players/:id/* 라우트가 동작하게 한다. */
function mirrorPlayer(user: TestUser): void {
  const now = new Date().toISOString();
  createPlayer({
    id: user.playerId, nickname: user.nickname, apiKey: crypto.randomUUID(),
    electricity: 0, electricityPerSecond: 1, lastClaimedAt: now, createdAt: now, updatedAt: now,
  });
}

function advance(seconds: number): void {
  vi.setSystemTime(T0 + seconds * 1000);
}

async function walletOf(user: TestUser): Promise<{ electricity: number; scrap: number; electricityPerSecond: number }> {
  const res = await call('GET', '/wallet', { token: user.accessToken });
  expect(res.status).toBe(200);
  return res.body;
}

// 진행/종료 라우트는 세션 경로 단위 레이트리밋이 있으므로 호출마다 비워 시간 의존을 제거한다.
async function progress(user: TestUser, sessionId: string, body: unknown, key?: string): Promise<Res> {
  clearRateLimits();
  return call('POST', `/battles/${sessionId}/progress`, { token: user.accessToken, body, key });
}

async function finish(user: TestUser, sessionId: string, body: unknown, key?: string): Promise<Res> {
  clearRateLimits();
  return call('POST', `/battles/${sessionId}/finish`, { token: user.accessToken, body, key });
}

async function startBattle(user: TestUser, stageCode: string, key?: string): Promise<Res> {
  return call('POST', '/battles/start', { token: user.accessToken, body: { stageCode }, key });
}

// ─── 인증 & 권한 ─────────────────────────────────────

describe('인증 라이프사이클', () => {
  it('가입은 토큰과 플레이어를 발급하고, 이메일/닉네임 중복은 409로 거부한다', async () => {
    const user = await register('dup');
    expect(user.userId).toBeTruthy();
    expect(user.playerId).toBeTruthy();

    const sameEmail = await call('POST', '/auth/register', {
      body: { email: user.email, password: PASSWORD, nickname: uniqueIdentity('other').nickname },
    });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.code).toBe('DUPLICATE_ACCOUNT');

    const sameNickname = await call('POST', '/auth/register', {
      body: { email: uniqueIdentity('other').email, password: PASSWORD, nickname: user.nickname },
    });
    expect(sameNickname.status).toBe(409);
    expect(sameNickname.body.code).toBe('DUPLICATE_ACCOUNT');

    const invalid = await call('POST', '/auth/register', {
      body: { email: 'not-an-email', password: 'short', nickname: 'x' },
    });
    expect(invalid.status).toBe(400);
  });

  it('로그인은 올바른 자격 증명에만 토큰을 주고 /wallet 접근을 허용한다', async () => {
    const user = await register('login');

    const wrongPassword = await call('POST', '/auth/login', { body: { email: user.email, password: 'wrong-password' } });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
    const unknown = await call('POST', '/auth/login', { body: { email: uniqueIdentity('ghost').email, password: PASSWORD } });
    expect(unknown.status).toBe(401);

    const login = await call('POST', '/auth/login', { body: { email: user.email, password: PASSWORD } });
    expect(login.status).toBe(200);
    expect(login.body.userId).toBe(user.userId);
    expect(login.body.playerId).toBe(user.playerId);

    const wallet = await call('GET', '/wallet', { token: login.body.tokens.accessToken });
    expect(wallet.status).toBe(200);
    expect(wallet.body).toMatchObject({ playerId: user.playerId, electricity: 0, electricityPerSecond: 1 });

    expect((await call('GET', '/wallet')).status).toBe(401);
    expect((await call('GET', '/wallet', { token: 'garbage' })).status).toBe(401);
    // refresh 토큰은 access 토큰으로 쓸 수 없다
    expect((await call('GET', '/wallet', { token: login.body.tokens.refreshToken })).status).toBe(401);
  });

  it('refresh는 토큰을 회전시키고 이전 refresh 재사용은 401이다', async () => {
    const user = await register('rotate');

    const rotated = await call('POST', '/auth/refresh', { body: { refreshToken: user.refreshToken } });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(user.refreshToken);
    expect(rotated.body.accessToken).toBeTruthy();

    const reused = await call('POST', '/auth/refresh', { body: { refreshToken: user.refreshToken } });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('TOKEN_EXPIRED');

    const next = await call('POST', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken } });
    expect(next.status).toBe(200);
    expect((await call('GET', '/wallet', { token: next.body.accessToken })).status).toBe(200);

    const forged = await call('POST', '/auth/refresh', { body: { refreshToken: 'not-a-jwt' } });
    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe('INVALID_TOKEN');
  });

  it('logout은 refresh 토큰을 폐기한다', async () => {
    const user = await register('logout');

    const out = await call('POST', '/auth/logout', { body: { refreshToken: user.refreshToken } });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ status: 'ok' });

    const afterLogout = await call('POST', '/auth/refresh', { body: { refreshToken: user.refreshToken } });
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.code).toBe('TOKEN_EXPIRED');
  });

  it('제재(정지)된 사용자는 로그인, refresh, 기존 access 토큰 모두 차단되고 해제 후 복구된다', async () => {
    const user = await register('suspend');
    const adminToken = await registerAdmin();

    const suspended = await call('PUT', `/admin/users/${user.userId}/suspend`, {
      token: adminToken, body: { reason: '통합 테스트 정지 사유' },
    });
    expect(suspended.status).toBe(200);

    const login = await call('POST', '/auth/login', { body: { email: user.email, password: PASSWORD } });
    expect(login.status).toBe(403);
    const refresh = await call('POST', '/auth/refresh', { body: { refreshToken: user.refreshToken } });
    expect(refresh.status).toBe(403);
    const wallet = await call('GET', '/wallet', { token: user.accessToken });
    expect(wallet.status).toBe(403);
    expect((await startBattle(user, 'stage_01_ruins')).status).toBe(403);

    const restored = await call('PUT', `/admin/users/${user.userId}/unsuspend`, {
      token: adminToken, body: { reason: '통합 테스트 해제 사유' },
    });
    expect(restored.status).toBe(200);
    expect((await call('GET', '/wallet', { token: user.accessToken })).status).toBe(200);
    expect((await call('POST', '/auth/login', { body: { email: user.email, password: PASSWORD } })).status).toBe(200);
  });

  it('다른 사용자의 플레이어는 claim할 수 없고(403) 일반 사용자는 운영 API에 접근할 수 없다', async () => {
    const owner = await register('owner');
    const attacker = await register('attacker');
    mirrorPlayer(owner);
    advance(100);

    const stolen = await call('POST', `/players/${owner.playerId}/claim`, { token: attacker.accessToken });
    expect(stolen.status).toBe(403);
    expect(stolen.body.code).toBe('FORBIDDEN');
    expect((await walletOf(owner)).electricity).toBe(0);

    expect((await call('POST', `/players/${owner.playerId}/claim`)).status).toBe(401);
    expect((await call('POST', '/players/not-a-uuid/claim', { token: owner.accessToken })).status).toBe(400);
    expect((await call('PUT', `/admin/users/${owner.userId}/suspend`, {
      token: attacker.accessToken, body: { reason: '권한 없는 정지 시도' },
    })).status).toBe(403);
  });
});

// ─── 멱등성 & 지갑 ──────────────────────────────────

describe('지갑 멱등성 & 동시성', () => {
  async function playerWithIdle(seconds = 100): Promise<TestUser> {
    const user = await register('wallet');
    mirrorPlayer(user);
    advance(seconds);
    return user;
  }

  it('Idempotency-Key 헤더가 없는 변경 요청은 400이다', async () => {
    const user = await playerWithIdle();
    const res = await call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken, key: null });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect((await walletOf(user)).electricity).toBe(0);
  });

  it('같은 키 재요청은 동일 응답을 재생하고 잔액은 한 번만 반영된다', async () => {
    const user = await playerWithIdle(100);
    const key = `claim-${crypto.randomUUID()}`;

    const first = await call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken, key });
    expect(first.status).toBe(200);
    expect(first.body.claimed).toBe(100);

    const replay = await call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken, key });
    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect((await walletOf(user)).electricity).toBe(100);
  });

  it('같은 키에 다른 본문을 보내면 409 IDEMPOTENCY_CONFLICT이고 잔액은 변하지 않는다', async () => {
    const user = await playerWithIdle(100);
    const key = `claim-${crypto.randomUUID()}`;

    expect((await call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken, key, body: { n: 1 } })).status).toBe(200);
    const conflict = await call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken, key, body: { n: 2 } });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await walletOf(user)).electricity).toBe(100);
  });

  it('같은 키의 동시 요청은 모두 같은 응답을 받고 한 번만 적립된다', async () => {
    const user = await playerWithIdle(100);
    const key = `claim-${crypto.randomUUID()}`;

    const results = await Promise.all(Array.from({ length: 5 }, () =>
      call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken, key })));
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual(results[0].body);
    }
    expect((await walletOf(user)).electricity).toBe(100);
  });

  it('서로 다른 키의 동시 claim은 레이트리밋으로 한 번만 적립된다', async () => {
    const user = await playerWithIdle(100);

    const results = await Promise.all(Array.from({ length: 4 }, () =>
      call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
    expect((await walletOf(user)).electricity).toBe(100);
  });

  it('잔액 부족 업그레이드는 400이며 음수 잔액을 만들지 않고, 충분하면 정확히 차감된다', async () => {
    const user = await playerWithIdle(100);
    const upgrade = (key?: string) => {
      clearRateLimits();
      return call('POST', `/players/${user.playerId}/upgrade`, { token: user.accessToken, key });
    };

    // 잔액 0: 거부
    const broke = await upgrade();
    expect(broke.status).toBe(400);
    expect(broke.body.code).toBe('INSUFFICIENT_RESOURCE');
    expect((await walletOf(user)).electricity).toBe(0);

    // 100 적립 후 비용 50 업그레이드 → 잔액 50, EPS 2
    clearRateLimits();
    expect((await call('POST', `/players/${user.playerId}/claim`, { token: user.accessToken })).status).toBe(200);
    const key = `upgrade-${crypto.randomUUID()}`;
    const ok = await upgrade(key);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ cost: 50, newElectricityPerSecond: 2 });
    expect(await walletOf(user)).toMatchObject({ electricity: 50, electricityPerSecond: 2 });

    // 같은 키 재전송은 재생(차감 없음)
    const replay = await upgrade(key);
    expect(replay.body).toEqual(ok.body);
    expect(await walletOf(user)).toMatchObject({ electricity: 50, electricityPerSecond: 2 });

    // 다음 비용 100 > 잔액 50: 거부, 잔액 유지
    const tooExpensive = await upgrade();
    expect(tooExpensive.status).toBe(400);
    expect(tooExpensive.body.code).toBe('INSUFFICIENT_RESOURCE');
    expect(await walletOf(user)).toMatchObject({ electricity: 50, electricityPerSecond: 2 });
  });
});

// ─── 전투 라이프사이클 ──────────────────────────────

describe('전투 세션 시작', () => {
  it('인증/멱등성 키/스테이지 입력을 검증한다', async () => {
    const user = await register('start');
    expect((await call('POST', '/battles/start', { body: { stageCode: 'stage_01_ruins' } })).status).toBe(401);
    const noKey = await call('POST', '/battles/start', { token: user.accessToken, body: { stageCode: 'stage_01_ruins' }, key: null });
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    const noStage = await call('POST', '/battles/start', { token: user.accessToken, body: {} });
    expect(noStage.status).toBe(400);
    expect(noStage.body.code).toBe('BAD_REQUEST');
    const unknown = await startBattle(user, 'stage_999_missing');
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('STAGE_NOT_FOUND');
  });

  it('선행 스테이지 미클리어면 STAGE_LOCKED(400)이다', async () => {
    const user = await register('locked');
    for (const stage of ['stage_02_factory', 'stage_03_lab', 'stage_04_core']) {
      const res = await startBattle(user, stage);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('STAGE_LOCKED');
    }
  });

  it('세션은 시드/스탯 스냅샷과 만료 시각을 서버가 확정하고 GET으로 동일하게 조회된다', async () => {
    const user = await register('snap');
    const started = await startBattle(user, 'stage_01_ruins');
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      stageId: 'stage_01_ruins', status: 'active', playerId: user.playerId, userId: user.userId,
      coreEnergy: 0, battleLevel: 1, killsReported: 0, contentVersion: '1.0.0',
      statSnapshot: { attackPower: 10, attackSpeed: 100, moveSpeed: 100, maxHp: 100 },
    });
    expect(started.body.sessionSeed).toMatch(/^\d+$/);
    // stage_01: 180초 + 유예 120초
    expect(Date.parse(started.body.expiresAt) - Date.parse(started.body.startTime)).toBe(300_000);

    const fetched = await call('GET', `/battles/${started.body.id}`, { token: user.accessToken });
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(started.body);

    const stranger = await register('stranger');
    expect((await call('GET', `/battles/${started.body.id}`, { token: stranger.accessToken })).status).toBe(404);
    expect((await call('GET', `/battles/${started.body.id}`)).status).toBe(401);
  });

  it('같은 키 재시작은 같은 세션을 재사용하고, 새 키로 시작하면 이전 active 세션을 포기 처리한다', async () => {
    const user = await register('reuse');
    const key = `start-${crypto.randomUUID()}`;
    const first = await startBattle(user, 'stage_01_ruins', key);
    const replay = await startBattle(user, 'stage_01_ruins', key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect((await call('GET', `/battles/${first.body.id}`, { token: user.accessToken })).body.status).toBe('active');

    const second = await startBattle(user, 'stage_01_ruins');
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect((await call('GET', `/battles/${first.body.id}`, { token: user.accessToken })).body.status).toBe('abandoned');
    expect((await call('GET', `/battles/${second.body.id}`, { token: user.accessToken })).body.status).toBe('active');
  });
});

describe('전투 진행 이벤트', () => {
  async function activeSession(label = 'prog'): Promise<{ user: TestUser; sessionId: string }> {
    const user = await register(label);
    const started = await startBattle(user, 'stage_01_ruins');
    expect(started.status).toBe(201);
    return { user, sessionId: started.body.id };
  }

  it('유효한 이벤트는 수락되고, 중복/건너뛴 시퀀스는 409이며 잘못된 시퀀스/타입은 400이다', async () => {
    const { user, sessionId } = await activeSession();
    advance(30);

    const ok = await progress(user, sessionId, { sequence: 1, killsDelta: 3, coreEnergyDelta: 15, elapsedSeconds: 20 });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ accepted: true, battleLevel: 1, upgradesAvailable: false });

    for (const sequence of [1, 3]) {
      const bad = await progress(user, sessionId, { sequence, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 21 });
      expect(bad.status).toBe(409);
      expect(bad.body.code).toBe('INVALID_EVENT_SEQUENCE');
    }
    for (const sequence of [0, -1, undefined]) {
      const bad = await progress(user, sessionId, { sequence, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 21 });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('BAD_REQUEST');
    }
    const badType = await progress(user, sessionId, { sequence: 2, killsDelta: '1', coreEnergyDelta: 5, elapsedSeconds: 21 });
    expect(badType.status).toBe(400);

    // 거부된 요청은 시퀀스를 소모하지 않고 누적치도 바꾸지 않는다
    const state = await call('GET', `/battles/${sessionId}`, { token: user.accessToken });
    expect(state.body).toMatchObject({ killsReported: 3, coreEnergy: 15, scrapAccumulated: 3 });
    expect((await progress(user, sessionId, { sequence: 2, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 21 })).status).toBe(200);
  });

  it('처치 수·Core Energy·시간·보스 타이밍 위반은 400이고 상태를 바꾸지 않는다', async () => {
    const { user, sessionId } = await activeSession();
    advance(100);

    const violations: Array<[string, Record<string, unknown>]> = [
      ['KILLS_OUT_OF_RANGE', { killsDelta: 301, coreEnergyDelta: 0, elapsedSeconds: 100 }],
      ['KILLS_OUT_OF_RANGE', { killsDelta: -1, coreEnergyDelta: 0, elapsedSeconds: 100 }],
      ['CORE_ENERGY_OUT_OF_RANGE', { killsDelta: 2, coreEnergyDelta: 11, elapsedSeconds: 100 }],
      ['CORE_ENERGY_OUT_OF_RANGE', { killsDelta: 2, coreEnergyDelta: -5, elapsedSeconds: 100 }],
      ['TIME_OUT_OF_RANGE', { killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 200 }],
      ['BOSS_TIMING_MISMATCH', { killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 50, bossId: 'boss_ruins_guardian' }],
      ['BOSS_TIMING_MISMATCH', { killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 100, bossId: 'boss_unknown' }],
      ['BOSS_TIMING_MISMATCH', { killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 100, bossId: 'boss_factory_foreman' }],
    ];
    for (const [code, event] of violations) {
      const res = await progress(user, sessionId, { sequence: 1, ...event });
      expect(res.status, `${code} ${JSON.stringify(event)}`).toBe(400);
      expect(res.body.code).toBe(code);
    }
    const state = await call('GET', `/battles/${sessionId}`, { token: user.accessToken });
    expect(state.body).toMatchObject({ killsReported: 0, coreEnergy: 0, bossDefeated: [], status: 'active' });

    // 경과 시간은 이전 이벤트보다 되돌릴 수 없다
    expect((await progress(user, sessionId, { sequence: 1, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 90 })).status).toBe(200);
    const backwards = await progress(user, sessionId, { sequence: 2, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 80 });
    expect(backwards.status).toBe(400);
    expect(backwards.body.code).toBe('TIME_OUT_OF_RANGE');
  });

  it('다른 사용자는 이벤트 제출(403)·종료(403)·포기(404)를 할 수 없다', async () => {
    const { sessionId } = await activeSession('victim');
    const attacker = await register('attacker');
    advance(30);

    const forgedEvent = await progress(attacker, sessionId, { sequence: 1, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 20 });
    expect(forgedEvent.status).toBe(403);
    const forgedFinish = await finish(attacker, sessionId, { totalKills: 0, totalCoreEnergy: 0, bossDefeated: [], elapsedSeconds: 20 });
    expect(forgedFinish.status).toBe(403);
    const forgedAbandon = await call('POST', `/battles/${sessionId}/abandon`, { token: attacker.accessToken });
    expect(forgedAbandon.status).toBe(404);
  });
});

describe('전투 종료 & 보상', () => {
  /** stage_01 전 구간 진행: 2개 이벤트(마지막에 보스 처치, 레벨업 가능) 후 180초 시점 */
  async function playToBossKill(user: TestUser, sessionId: string): Promise<void> {
    advance(30);
    expect((await progress(user, sessionId, { sequence: 1, killsDelta: 4, coreEnergyDelta: 20, elapsedSeconds: 30 })).status).toBe(200);
    advance(120);
    const boss = await progress(user, sessionId, {
      sequence: 2, killsDelta: 6, coreEnergyDelta: 30, bossId: 'boss_ruins_guardian', elapsedSeconds: 120,
    });
    expect(boss).toMatchObject({ status: 200, body: { accepted: true, upgradesAvailable: true } });
    advance(180);
  }

  const cleanReport = { totalKills: 10, totalCoreEnergy: 50, bossDefeated: ['boss_ruins_guardian'], elapsedSeconds: 180 };

  it('전체 라이프사이클: 진행 → 레벨업 강화 선택 → 종료 → 첫 클리어 보상 → 다음 스테이지 해금', async () => {
    const user = await register('full');
    const started = await startBattle(user, 'stage_01_ruins');
    const sessionId: string = started.body.id;
    await playToBossKill(user, sessionId);

    // 강화 선택지가 서버에서 생성되고, 미선택 상태에서는 종료할 수 없다
    const generate = await call('POST', `/battles/${sessionId}/upgrades/select`, {
      token: user.accessToken, body: { selectedUpgradeCode: 'any' },
    });
    expect(generate.status).toBe(400);
    expect(generate.body.code).toBe('CHOICES_GENERATED');
    const offered = await call('GET', `/battles/${sessionId}`, { token: user.accessToken });
    expect(offered.body.battleLevel).toBe(2);
    expect(offered.body.offeredChoices).toHaveLength(1);
    const options: Array<{ slot: number; upgradeId: string }> = offered.body.offeredChoices[0].options;
    expect(options).toHaveLength(3);
    expect(new Set(options.map((o) => o.upgradeId)).size).toBe(3);

    const blocked = await finish(user, sessionId, cleanReport);
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('PENDING_UPGRADES');
    expect((await call('GET', `/battles/${sessionId}`, { token: user.accessToken })).body.status).toBe('active');

    // 제시되지 않은 강화는 거부, 제시된 강화는 한 번만 적용
    const invalidChoice = await call('POST', `/battles/${sessionId}/upgrades/select`, {
      token: user.accessToken, body: { selectedUpgradeCode: 'upgrade_not_offered' },
    });
    expect(invalidChoice.status).toBe(400);
    expect(invalidChoice.body.code).toBe('INVALID_CHOICE');
    const missingCode = await call('POST', `/battles/${sessionId}/upgrades/select`, { token: user.accessToken, body: {} });
    expect(missingCode.status).toBe(400);

    const selected = await call('POST', `/battles/${sessionId}/upgrades/select`, {
      token: user.accessToken, body: { selectedUpgradeCode: options[0].upgradeId },
    });
    expect(selected.status).toBe(200);
    expect(selected.body.applied).toEqual([options[0].upgradeId]);

    // 클라이언트가 보낸 보상 필드는 무시되고 서버 계산값(처치 수 × scrapPerKill)만 지급된다
    const done = await finish(user, sessionId, {
      ...cleanReport, reward: { scrap: 999_999 }, scrap: 999_999, rewardScrap: 999_999, isFirstClear: false,
    });
    expect(done.status).toBe(200);
    expect(done.body.reward.scrap).toBe(10);
    expect(done.body.scrap).toBe(10);
    expect(typeof done.body.reward.blueprint).toBe('string'); // 첫 클리어 확정 설계도

    expect((await walletOf(user)).scrap).toBe(10);
    const blueprints = await call('GET', '/crafting/my-blueprints', { token: user.accessToken });
    expect(blueprints.status).toBe(200);
    expect(blueprints.body.map((b: { blueprintCode: string }) => b.blueprintCode)).toContain(done.body.reward.blueprint);

    const finalState = await call('GET', `/battles/${sessionId}`, { token: user.accessToken });
    expect(finalState.body.status).toBe('completed');

    // 중복 종료 방지: 새 키로 다시 종료해도 409, 보상은 한 번만
    const duplicate = await finish(user, sessionId, cleanReport);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('SESSION_NOT_ACTIVE');
    expect((await walletOf(user)).scrap).toBe(10);

    // 다음 스테이지 해금
    const stages = await call('GET', '/stages', { token: user.accessToken });
    expect(stages.status).toBe(200);
    expect(stages.body.find((s: { id: string }) => s.id === 'stage_01_ruins')).toMatchObject({ unlocked: true, canEnter: true });
    expect(stages.body.find((s: { id: string }) => s.id === 'stage_02_factory')).toMatchObject({ unlocked: true, canEnter: true });
    expect(stages.body.find((s: { id: string }) => s.id === 'stage_03_lab')).toMatchObject({ unlocked: false, canEnter: false });
    const next = await startBattle(user, 'stage_02_factory');
    expect(next.status).toBe(201);
    expect(next.body.stageId).toBe('stage_02_factory');
    expect((await startBattle(user, 'stage_03_lab')).body.code).toBe('STAGE_LOCKED');
  });

  it('최종 수치·보스·시간이 서버 기록과 다르면 거부하고 세션을 active로 복구한다', async () => {
    const user = await register('tamper');
    const sessionId: string = (await startBattle(user, 'stage_01_ruins')).body.id;
    await playToBossKill(user, sessionId);

    const attempts: Array<[string, Record<string, unknown>]> = [
      ['FINAL_KILLS_MISMATCH', { totalKills: 11 }],
      ['FINAL_KILLS_MISMATCH', { totalKills: 300 }],
      ['CORE_ENERGY_MISMATCH', { totalCoreEnergy: 51 }],
      ['BOSS_MISMATCH', { bossDefeated: [] }],
      ['BOSS_MISMATCH', { bossDefeated: ['boss_factory_foreman'] }],
      ['TIME_OUT_OF_RANGE', { elapsedSeconds: 5 }],
      ['TIME_OUT_OF_RANGE', { elapsedSeconds: 181 + 3 }],
      ['TIME_OUT_OF_RANGE', { elapsedSeconds: 100 }],
    ];
    for (const [code, patch] of attempts) {
      const res = await finish(user, sessionId, { ...cleanReport, ...patch });
      expect(res.status, `${code} ${JSON.stringify(patch)}`).toBe(400);
      expect(res.body.code).toBe(code);
    }
    expect((await call('GET', `/battles/${sessionId}`, { token: user.accessToken })).body.status).toBe('active');
    expect((await walletOf(user)).scrap).toBe(0);
    expect((await startBattle(user, 'stage_02_factory')).body.code).toBe('STAGE_LOCKED');
  });

  it('즉시 종료는 거부되고, 이후 정상 종료는 같은 키 재전송 시 동일 응답을 재생한다', async () => {
    const user = await register('instant');
    const sessionId: string = (await startBattle(user, 'stage_01_ruins')).body.id;
    const immediate = await finish(user, sessionId, { totalKills: 0, totalCoreEnergy: 0, bossDefeated: [], elapsedSeconds: 10 });
    expect(immediate.status).toBe(400);
    expect(immediate.body.code).toBe('TIME_OUT_OF_RANGE');

    await playToBossKill(user, sessionId);
    await call('POST', `/battles/${sessionId}/upgrades/select`, { token: user.accessToken, body: { selectedUpgradeCode: 'any' } });
    const offered = (await call('GET', `/battles/${sessionId}`, { token: user.accessToken })).body.offeredChoices[0].options[0].upgradeId;
    await call('POST', `/battles/${sessionId}/upgrades/select`, { token: user.accessToken, body: { selectedUpgradeCode: offered } });

    const key = `finish-${crypto.randomUUID()}`;
    const first = await finish(user, sessionId, cleanReport, key);
    expect(first.status).toBe(200);
    const replay = await finish(user, sessionId, cleanReport, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect((await walletOf(user)).scrap).toBe(10);
  });

  it('포기한 세션은 보상 0이며 이후 진행/종료가 거부되고 다음 스테이지도 해금되지 않는다', async () => {
    const user = await register('abandon');
    const sessionId: string = (await startBattle(user, 'stage_01_ruins')).body.id;
    advance(30);
    expect((await progress(user, sessionId, { sequence: 1, killsDelta: 5, coreEnergyDelta: 25, elapsedSeconds: 30 })).status).toBe(200);

    const abandoned = await call('POST', `/battles/${sessionId}/abandon`, { token: user.accessToken });
    expect(abandoned.status).toBe(200);
    expect(abandoned.body).toEqual({ status: 'abandoned' });
    expect((await call('GET', `/battles/${sessionId}`, { token: user.accessToken })).body.status).toBe('abandoned');

    const lateProgress = await progress(user, sessionId, { sequence: 2, killsDelta: 1, coreEnergyDelta: 5, elapsedSeconds: 31 });
    expect(lateProgress.status).toBe(400);
    expect(lateProgress.body.code).toBe('SESSION_NOT_ACTIVE');
    advance(120);
    const lateFinish = await finish(user, sessionId, { totalKills: 5, totalCoreEnergy: 25, bossDefeated: [], elapsedSeconds: 120 });
    expect(lateFinish.status).toBe(409);
    expect(lateFinish.body.code).toBe('SESSION_NOT_ACTIVE');

    expect(await walletOf(user)).toMatchObject({ scrap: 0, electricity: 0 });
    expect((await call('GET', '/crafting/my-blueprints', { token: user.accessToken })).body).toEqual([]);
    expect((await startBattle(user, 'stage_02_factory')).body.code).toBe('STAGE_LOCKED');
  });
});

// ─── 메타 시스템 API 계약 ───────────────────────────

describe('메타 시스템 API 계약', () => {
  it('GET /parts 는 공개 카탈로그를, GET /parts/my 는 JWT가 필요한 인벤토리를 반환한다', async () => {
    const catalog = await call('GET', '/parts');
    expect(catalog.status).toBe(200);
    for (const group of ['frames', 'weapons', 'cores', 'modules']) {
      expect(Array.isArray(catalog.body[group])).toBe(true);
      expect(catalog.body[group].length).toBeGreaterThan(0);
    }

    expect((await call('GET', '/parts/my')).status).toBe(401);
    const user = await register('parts');
    const mine = await call('GET', '/parts/my', { token: user.accessToken });
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveProperty('inventory');
    expect(mine.body).toHaveProperty('equipped');
    expect(Array.isArray(mine.body.inventory)).toBe(true);
  });

  it('GET /mecha/configs 는 JWT가 필요하고 신규 사용자는 설정이 비어 있다', async () => {
    expect((await call('GET', '/mecha/configs')).status).toBe(401);
    const user = await register('mecha');
    const res = await call('GET', '/mecha/configs', { token: user.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.configs).toEqual([]);
    expect(res.body.active ?? null).toBeNull();
  });

  it('GET /research 는 공개 트리를, GET /research/my 는 사용자 진행도를 매핑해 반환한다', async () => {
    const tree = await call('GET', '/research');
    expect(tree.status).toBe(200);
    expect(tree.body.nodes.length).toBeGreaterThan(0);
    expect(tree.body.nodes[0]).toEqual(expect.objectContaining({
      code: expect.any(String), maxLevel: expect.any(Number), prerequisites: expect.any(Array),
    }));

    expect((await call('GET', '/research/my')).status).toBe(401);
    const user = await register('research');
    const mine = await call('GET', '/research/my', { token: user.accessToken });
    expect(mine.status).toBe(200);
    expect(mine.body.tree).toHaveLength(tree.body.nodes.length);
    for (const node of mine.body.tree) {
      expect(node.currentLevel).toBe(0);
      expect(node.canResearch).toBe(node.prereqs.every((p: { met: boolean }) => p.met));
    }
    expect(mine.body.tree.some((n: { canResearch: boolean }) => n.canResearch)).toBe(true);
  });

  it('GET /crafting/* 는 카탈로그 공개, 내 설계도/대기열은 JWT 필요', async () => {
    const catalog = await call('GET', '/crafting/blueprints');
    expect(catalog.status).toBe(200);
    expect(catalog.body.blueprints.length).toBeGreaterThan(0);
    expect(catalog.body.blueprints[0]).toHaveProperty('code');

    expect((await call('GET', '/crafting/my-blueprints')).status).toBe(401);
    expect((await call('GET', '/crafting/queue')).status).toBe(401);

    const user = await register('craft');
    const mine = await call('GET', '/crafting/my-blueprints', { token: user.accessToken });
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual([]);
    const queue = await call('GET', '/crafting/queue', { token: user.accessToken });
    expect(queue.status).toBe(200);
    expect(queue.body).toEqual({ queue: [], completable: 0 });
  });
});
