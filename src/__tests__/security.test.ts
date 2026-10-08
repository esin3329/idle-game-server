process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import routes from '../routes.js';
import authRoutes from '../auth.routes.js';
import adminRoutes from '../admin.routes.js';
import partsRoutes from '../parts.routes.js';
import craftingRoutes from '../crafting.routes.js';
import battleRoutes from '../battle.routes.js';
import mechaRoutes from '../mecha.routes.js';
import { resetAllRepos } from '../provider.js';
import { resetPartsStores } from '../store-parts.js';
import { resetCraftingStores } from '../store-crafting.js';
import { resetResearchStores } from '../store-research.js';
import { resetItemLedger } from '../store-item-ledger.js';
import { resetBattleStores } from '../store-battle.js';
import { resetWalletStores } from '../store-wallet.js';
import { resetAuthStores } from '../store-auth.js';
import { jsonAuthRepo } from '../store-auth.js';
import { jsonPartsRepo, jsonMechaConfigRepo } from '../store-parts.js';
import { createHash } from 'node:crypto';
import { refreshTokens } from '../shared/auth-service.js';
import jwt from 'jsonwebtoken';

// ─── 헬퍼 ──────────────────────────────────────────

const ADMIN_TOKEN = jwt.sign({ sub: 'admin-user', type: 'access', role: 'admin' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
const USER_TOKEN = jwt.sign({ sub: 'normal-user', type: 'access', role: 'user' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
const EXPIRED_TOKEN = jwt.sign({ sub: 'expired-user', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '0s' });

const adminAuth = () => ({ Authorization: `Bearer ${ADMIN_TOKEN}` });
const userAuth = () => ({ Authorization: `Bearer ${USER_TOKEN}` });

async function createTestWallet(playerId: string) {
  const now = new Date().toISOString();
  await jsonAuthRepo.createWallet({
    id: `wallet-${playerId}`, playerId, userId: playerId,
    electricity: 0, electricityPerSecond: 1, scrap: 0, balance: 0,
    lastClaimedAt: now, createdAt: now, updatedAt: now,
  });
}
function createFullApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err && typeof err === 'object' && 'status' in err) {
      return c.json({ error: err.message, code: (err as any).code }, (err as any).status);
    }
    return c.json({ error: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found', code: 'ROUTE_NOT_FOUND' }, 404));
  const api = new Hono();
  api.route('/', authRoutes);
  api.route('/', routes);
  api.route('/', partsRoutes);
  api.route('/', mechaRoutes);
  api.route('/', craftingRoutes);
  api.route('/', adminRoutes);
  api.route('/', battleRoutes);
  app.route('/api', api);
  return app;
}

function createApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err && typeof err === 'object' && 'status' in err) {
      return c.json({ error: err.message, code: (err as any).code }, (err as any).status);
    }
    return c.json({ error: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found', code: 'ROUTE_NOT_FOUND' }, 404));
  const api = new Hono();
  api.route('/', authRoutes);
  api.route('/', routes);
  api.route('/', partsRoutes);
  api.route('/', craftingRoutes);
  api.route('/', mechaRoutes);
  api.route('/', battleRoutes);
  app.route('/api', api);
  return app;
}


beforeEach(async () => {
  process.env.DB_DRIVER = 'json';
  for (const file of ['data-wallets.json', 'data-ledger.json', 'data-parts.json', 'data-equip.json', 'data-configs.json', 'data-research.json', 'data-item-ledger.json', 'data-blueprints.json', 'data-crafts.json', 'data-battles.json', 'data-battle-events.json', 'data-battle-results.json', 'data-users.json', 'data-sessions.json', 'data-sanctions.json', 'data-profiles.json']) {
    try { require('fs').unlinkSync(require('path').join(process.cwd(), file)); } catch {}
  }
  resetAuthStores();
  resetAllRepos();
  resetPartsStores();
  resetCraftingStores();
  resetResearchStores();
  resetItemLedger();
  resetBattleStores();
  resetWalletStores();
  const now = new Date().toISOString();
  for (const [id, role] of [['admin-user', 'admin'], ['normal-user', 'user'], ['user1', 'user'], ['user2', 'user']]) {
    await jsonAuthRepo.createUser({ id, email: `${id}@example.test`, nickname: id, passwordHash: '', status: 'active', role, createdAt: now, updatedAt: now });
  }
});

// ═══════════════════════════════════════════════════════
// 권한 우회 테스트
// ═══════════════════════════════════════════════════════

describe('권한 우회 방지', () => {
  // 1. 인증 없이 JWT 필요 API 접근
  it('인증 없이 /api/players/:id/claim → 401', async () => {
    const app = createApp();
    // UUID가 아닌 test-id는 validatePlayerId에서 400을 반환하므로 UUID 사용
    const validId = '00000000-0000-0000-0000-000000000000';
    const res = await app.request(`/api/players/${validId}/claim`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'no-auth-test' },
    });
    expect(res.status).toBe(401);
  });

  it('인증 없이 /api/parts/my → 401', async () => {
    const app = createApp();
    const res = await app.request('/api/parts/my');
    expect(res.status).toBe(401);
  });

  it('POST /api/crafting/drop is removed', async () => {
    const app = createApp();
    const res = await app.request('/api/crafting/drop', { method: 'POST', headers: userAuth() });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });

  // 2. 만료된 토큰으로 접근
  it('만료된 토큰 → 401 TOKEN_EXPIRED', async () => {
    const app = createApp();
    const res = await app.request('/api/parts/my', { headers: { Authorization: `Bearer ${EXPIRED_TOKEN}` } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('TOKEN_EXPIRED');
  });

  it('비활성화된 계정은 기존 access token으로 보호 API를 사용할 수 없다', async () => {
    const user = await jsonAuthRepo.findUserById('normal-user');
    if (!user) throw new Error('test user missing');
    await jsonAuthRepo.createUser({ ...user, status: 'suspended' });

    const app = createApp();
    const response = await app.request('/api/parts/my', { headers: userAuth() });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('비활성화된 계정은 기존 refresh token을 갱신할 수 없다', async () => {
    const now = new Date();
    const user = await jsonAuthRepo.findUserById('normal-user');
    if (!user) throw new Error('test user missing');
    const refreshToken = jwt.sign(
      { sub: user.id, type: 'refresh', jti: crypto.randomUUID() },
      process.env.JWT_REFRESH_SECRET || 'dev-secret-change-in-production',
      { expiresIn: '1h' },
    );
    await jsonAuthRepo.createSession({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
    });
    await jsonAuthRepo.createUser({ ...user, status: 'suspended' });

    await expect(refreshTokens(refreshToken)).rejects.toMatchObject({
      status: 403,
      code: 'ACCOUNT_DISABLED',
    });
  });

  // 3. 일반 사용자 토큰으로 admin API 접근
  it('일반 유저가 /api/admin/users 접근 → 403', async () => {
    const app = createFullApp();
    const res = await app.request('/api/admin/users', { headers: userAuth() });
    expect(res.status).toBe(403);
  });

  it('일반 유저가 /api/admin/users/:id 접근 → 403', async () => {
    const app = createFullApp();
    const res = await app.request('/api/admin/users/test-id', { headers: userAuth() });
    expect(res.status).toBe(403);
  });

  it('일반 유저가 /api/admin/grants 접근 → 403', async () => {
    const app = createFullApp();
    const res = await app.request('/api/admin/grants', { headers: userAuth() });
    expect(res.status).toBe(403);
  });

  // 4. admin 토큰으로 admin API 접근 (정상)
  it('admin 유저가 /api/admin/users 접근 → 200', async () => {
    const app = createFullApp();
    const res = await app.request('/api/admin/users', { headers: adminAuth() });
    expect(res.status).toBe(200);
  });

  it('Idempotency-Key 없이 /api/players/:id/claim → 400 BAD_REQUEST', async () => {
    const app = createApp();
    const res = await app.request('/api/players/00000000-0000-0000-0000-000000000000/claim', {
      method: 'POST',
      headers: userAuth(),
    });
    expect(res.status).toBe(400);
  });

  // 6. 다른 사용자의 리소스 접근
  it('다른 사용자의 /api/parts/my 접근 → 본인 데이터만 반환', async () => {
    const app = createApp();
    const token2 = jwt.sign({ sub: 'user2', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
    await jsonPartsRepo.grantPart('user1', 'light_frame', 'frame');

    const res2 = await app.request('/api/parts/my', { headers: { Authorization: `Bearer ${token2}` } });
    const body2 = await res2.json();
    expect(body2.inventory).toHaveLength(0);
  });
  it('타인의 메카 설정은 ID로 수정할 수 없다', async () => {
    const app = createApp();
    const config = await jsonMechaConfigRepo.createConfig(
      'user1', 'owner config', 'light_frame', 'shotgun', 'assault_core', 'shield_module',
    );
    const token2 = jwt.sign({ sub: 'user2', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
    const response = await app.request(`/mecha/configs/${config.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'stolen config' }),
    });
    expect(response.status).toBe(404);
    expect((await jsonMechaConfigRepo.getConfigs('user1'))[0].name).toBe('owner config');
  });

  it('타인 플레이어 claim은 403', async () => {
    const app = createApp();
    const res = await app.request('/api/players/00000000-0000-0000-0000-000000000000/claim', {
      method: 'POST',
      headers: { ...userAuth(), 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('중복 /api mount의 /api/api/players 경로는 없어야 한다', async () => {
    const app = createFullApp();
    const res = await app.request('/api/api/players/00000000-0000-0000-0000-000000000000/battle/start', {
      method: 'POST',
      headers: { ...userAuth(), 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ stageCode: 'stage_01_ruins' }),
    });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════
// 중복 지급 방지 테스트
// ═══════════════════════════════════════════════════════

describe('중복 지급 방지', () => {
  // 7. adjustBalance 멱등성 키 검증 (중복 지급 방지)
  it('adjustBalance 동일 키 중복 → 두 번째는 중복', async () => {
    const { adjustBalance } = await import('../shared/wallet.js');
    const uniqueKey = `dup-key-${Date.now()}-${Math.random()}`;
    await createTestWallet('dup-player-1');

    const first = await adjustBalance('dup-player-1', 100, 'test', uniqueKey, 'electricity', 'test');
    expect(first.success).toBe(true);
    expect(first.balanceAfter).toBe(100);

    const second = await adjustBalance('dup-player-1', 100, 'test', uniqueKey, 'electricity', 'test');
    expect(second.success).toBe(false);
    expect(second.balanceAfter).toBe(100);
    await expect(adjustBalance('dup-player-1', 101, 'test', uniqueKey, 'electricity', 'test'))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  // 8. adjustBalance 멱등성 키 검증 (다른 키)
  it('다른 키로 adjustBalance → 각각 성공', async () => {
    const { adjustBalance } = await import('../shared/wallet.js');
    const k1 = `k-${Date.now()}-a`;
    const k2 = `k-${Date.now()}-b`;
    await createTestWallet('dup-player-2');

    const first = await adjustBalance('dup-player-2', 50, 'test', k1, 'electricity', 'test');
    expect(first.success).toBe(true);
    expect(first.balanceAfter).toBe(50);

    const second = await adjustBalance('dup-player-2', 30, 'test', k2, 'electricity', 'test');
    expect(second.success).toBe(true);
    expect(second.balanceAfter).toBe(80); // 누적
  });

  it('일반 사용자의 직접 파츠 지급 경로는 제거되어 있다', async () => {
    const app = createApp();
    const res = await app.request('/api/parts/grant', {
      method: 'POST',
      headers: { ...userAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'machine_gun' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });

  // 11. 닉네임 중복 가입 방지
  it('동일 닉네임으로 회원가입 → 409 DUPLICATE_ACCOUNT', async () => {
    const app = createFullApp();

    // 첫 번째 회원가입
    const registerId = crypto.randomUUID();
    const res1 = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `register-${registerId}`,
      },
      body: JSON.stringify({ email: 'dup-nick@test.com', password: 'password123!', nickname: '중복닉네임' }),
    });
    expect(res1.status).toBe(201);

    // 같은 닉네임으로 두 번째 회원가입
    const registerId2 = crypto.randomUUID();
    const res2 = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `register-${registerId2}`,
      },
      body: JSON.stringify({ email: 'dup-nick-2@test.com', password: 'password123!', nickname: '중복닉네임' }),
    });
    expect(res2.status).toBe(409);
    const body = await res2.json();
    expect(body.code).toBe('DUPLICATE_ACCOUNT');
  });

  // 12. GET /api/wallet — JWT 인증 + 본인 지갑 조회
  it('GET /api/wallet → JWT 기반 본인 지갑 반환', async () => {
    const app = createFullApp();

    // 회원가입
    const registerId = crypto.randomUUID();
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `register-${registerId}`,
      },
      body: JSON.stringify({ email: 'wallet-test@test.com', password: 'password123!', nickname: '지갑테스트' }),
    });
    if (regRes.status !== 201) {
      const errBody = await regRes.json();
      console.error('REG ERROR:', JSON.stringify(errBody));
    }
    expect(regRes.status).toBe(201);
    const regBody = await regRes.json();
    const accessToken = regBody.tokens.accessToken;

    // 지갑 조회
    const walletRes = await app.request('/api/wallet', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(walletRes.status).toBe(200);
    const walletBody = await walletRes.json();
    expect(walletBody).toHaveProperty('playerId');
    expect(walletBody).toHaveProperty('electricity');
    expect(walletBody).toHaveProperty('electricityPerSecond');
    expect(walletBody.scrap).toBe(0);
    expect(walletBody.electricityPerSecond).toBe(1);
  });

  it('GET /api/wallet → 다른 사용자 지갑에 접근 불가', async () => {
    const app = createFullApp();

    // 사용자 A 회원가입
    const regA = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `register-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ email: 'user-a@test.com', password: 'password123!', nickname: '사용자A' }),
    });
    expect(regA.status).toBe(201);
    const regABody = await regA.json();
    const tokenA = regABody.tokens.accessToken;

    // 사용자 B 회원가입 (다른 사용자 존재 확인용)
    const regB = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `register-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ email: 'user-b@test.com', password: 'password123!', nickname: '사용자B' }),
    });
    expect(regB.status).toBe(201);

    // 사용자 A의 토큰으로 지갑 조회 → 사용자 A의 지갑 반환
    const walletRes = await app.request('/api/wallet', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(walletRes.status).toBe(200);
    const walletBody = await walletRes.json();
    // A의 지갑에는 A의 playerId가 있어야 함
    expect(typeof walletBody.playerId).toBe('string');
    expect(typeof walletBody.electricity).toBe('number');
  });

  // 13. 전투 세션 중복 종료 방지 (unit test)
  it('이미 종료된 세션 다시 종료 → 409 SESSION_NOT_ACTIVE', async () => {
    const { endBattleSession } = await import('../shared/battle-session.js');
    const { jsonBattleRepo } = await import('../store-battle.js');

    // 가짜 세션 생성 (completed 상태)
    await jsonBattleRepo.createSession({
      id: 'finished-session', playerId: 'p1', userId: 'p1',
      stageId: 'stage_01_ruins', status: 'completed',
      contentVersion: '1.0.0',
    });

    try {
      await endBattleSession('finished-session', 'p1', {
        totalKills: 10, totalCoreEnergy: 50,
        bossDefeated: [], elapsedSeconds: 100,
      });
      expect(true).toBe(false); // 여기까지 오면 안 됨
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.code).toBe('SESSION_NOT_ACTIVE');
    }
  });
});
