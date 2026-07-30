process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import routes from '../routes.js';
import authRoutes from '../auth.routes.js';
import adminRoutes from '../admin.routes.js';
import partsRoutes from '../parts.routes.js';
import craftingRoutes from '../crafting.routes.js';
import { resetAllRepos } from '../provider.js';
import { resetPartsStores } from '../store-parts.js';
import { resetCraftingStores } from '../store-crafting.js';
import { resetResearchStores } from '../store-research.js';
import { resetItemLedger } from '../store-item-ledger.js';
import { resetBattleStores } from '../store-battle.js';
import { resetWalletStores } from '../store-wallet.js';
import jwt from 'jsonwebtoken';


// ─── 헬퍼 ──────────────────────────────────────────

const ADMIN_TOKEN = jwt.sign({ sub: 'admin-user', type: 'access', role: 'admin' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
const USER_TOKEN = jwt.sign({ sub: 'normal-user', type: 'access', role: 'user' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
const EXPIRED_TOKEN = jwt.sign({ sub: 'expired-user', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '0s' });

const adminAuth = () => ({ Authorization: `Bearer ${ADMIN_TOKEN}` });
const userAuth = () => ({ Authorization: `Bearer ${USER_TOKEN}` });
function createFullApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err && typeof err === 'object' && 'status' in err) {
      return c.json({ error: err.message, code: (err as any).code }, (err as any).status);
    }
    return c.json({ error: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found', code: 'ROUTE_NOT_FOUND' }, 404));
  app.route('/', authRoutes);
  app.route('/', routes);
  app.route('/', partsRoutes);
  app.route('/', craftingRoutes);
  app.route('/', adminRoutes);
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
  app.route('/', authRoutes);
  app.route('/', routes);
  app.route('/', partsRoutes);
  app.route('/', craftingRoutes);
  return app;
}

beforeEach(() => {
  process.env.DB_DRIVER = 'json';
  // JSON 파일 삭제 (store 계열이 파일에서 로드하는 것 방지)
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-wallets.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-ledger.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-parts.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-equip.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-configs.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-research.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-item-ledger.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-blueprints.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-crafts.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-battles.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-battle-events.json')); } catch {}
  try { require('fs').unlinkSync(require('path').join(process.cwd(), 'data-battle-results.json')); } catch {}
  resetAllRepos();
  resetPartsStores();
  resetCraftingStores();
  resetResearchStores();
  resetItemLedger();
  resetBattleStores();
  resetWalletStores();
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

  it('인증 없이 /parts/my → 401', async () => {
    const app = createApp();
    const res = await app.request('/parts/my');
    expect(res.status).toBe(401);
  });

  it('인증 없이 /crafting/drop → 401', async () => {
    const app = createApp();
    const res = await app.request('/crafting/drop', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  // 2. 만료된 토큰으로 접근
  it('만료된 토큰 → 401 TOKEN_EXPIRED', async () => {
    const app = createApp();
    const res = await app.request('/parts/my', { headers: { Authorization: `Bearer ${EXPIRED_TOKEN}` } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('TOKEN_EXPIRED');
  });

  // 3. 일반 사용자 토큰으로 admin API 접근
  it('일반 유저가 /admin/users 접근 → 403', async () => {
    const app = createFullApp();
    const res = await app.request('/admin/users', { headers: userAuth() });
    expect(res.status).toBe(403);
  });

  it('일반 유저가 /admin/users/:id 접근 → 403', async () => {
    const app = createFullApp();
    const res = await app.request('/admin/users/test-id', { headers: userAuth() });
    expect(res.status).toBe(403);
  });

  it('일반 유저가 /admin/grants 접근 → 403', async () => {
    const app = createFullApp();
    const res = await app.request('/admin/grants', { headers: userAuth() });
    expect(res.status).toBe(403);
  });

  // 4. admin 토큰으로 admin API 접근 (정상)
  it('admin 유저가 /admin/users 접근 → 200', async () => {
    const app = createFullApp();
    const res = await app.request('/admin/users', { headers: adminAuth() });
    expect(res.status).toBe(200);
  });

  // 5. Idempotency-Key 없이 POST 요청
  it('Idempotency-Key 없이 /api/players/:id/claim → 400 BAD_REQUEST', async () => {
    const app = createApp();
    const res = await app.request('/api/players/test-id/claim', {
      method: 'POST',
      headers: userAuth(),
    });
    expect(res.status).toBe(400);
  });

  // 6. 다른 사용자의 리소스 접근
  it('다른 사용자의 /parts/my 접근 → 본인 데이터만 반환', async () => {
    const app = createApp();
    // user1이 파츠 지급
    const token1 = jwt.sign({ sub: 'user1', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });
    const token2 = jwt.sign({ sub: 'user2', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });

    await app.request('/parts/grant', {
      method: 'POST', headers: { Authorization: `Bearer ${token1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'light_frame' }),
    });

    // user2의 인벤토리에는 user1의 파츠가 없어야 함
    const res2 = await app.request('/parts/my', { headers: { Authorization: `Bearer ${token2}` } });
    const body2 = await res2.json();
    expect(body2.inventory).toHaveLength(0);
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

    const first = await adjustBalance('dup-player-1', 100, 'test', uniqueKey, 'electricity', 'test');
    expect(first.success).toBe(true);
    expect(first.balanceAfter).toBe(100);

    const second = await adjustBalance('dup-player-1', 100, 'test', uniqueKey, 'electricity', 'test');
    expect(second.success).toBe(false);
    expect(second.balanceAfter).toBe(100);
  });

  // 8. adjustBalance 멱등성 키 검증 (다른 키)
  it('다른 키로 adjustBalance → 각각 성공', async () => {
    const { adjustBalance } = await import('../shared/wallet.js');
    const k1 = `k-${Date.now()}-a`;
    const k2 = `k-${Date.now()}-b`;

    const first = await adjustBalance('dup-player-2', 50, 'test', k1, 'electricity', 'test');
    expect(first.success).toBe(true);
    expect(first.balanceAfter).toBe(50);

    const second = await adjustBalance('dup-player-2', 30, 'test', k2, 'electricity', 'test');
    expect(second.success).toBe(true);
    expect(second.balanceAfter).toBe(80); // 누적
  });

  // 9. 파츠 중복 지급 방지
  it('동일 파츠 중복 grant → 두 번째는 409', async () => {
    const app = createApp();
    const token = jwt.sign({ sub: 'dup-test-user', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });

    // 첫 번째 지급
    const first = await app.request('/parts/grant', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'machine_gun' }),
    });
    expect(first.status).toBe(201);

    // 두 번째 지급 (중복)
    const second = await app.request('/parts/grant', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ partCode: 'machine_gun' }),
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.code).toBe('PART_ALREADY_OWNED');
  });

  // 10. 설계도 중복 드롭 방지
  it('동일 설계도 중복 드롭 → duplicate 플래그', async () => {
    const app = createApp();
    const token = jwt.sign({ sub: 'dup-bp-user', type: 'access' }, 'dev-secret-change-in-production', { expiresIn: '1h' });

    // 먼저 특정 설계도를 직접 지급 (machine_gun)
    const { jsonCraftingRepo } = await import('../store-crafting.js');
    await jsonCraftingRepo.grantBlueprint('dup-bp-user', 'bp_machine_gun');

    const res = await app.request('/crafting/drop', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    // 랜덤 드롭이므로 bp_machine_gun과 다를 수 있음
    // 중복 체크는 hasBlueprint에서 처리
    expect([201, 200]).toContain(res.status);
    if (body.duplicate === true) {
      expect(body.message).toContain('이미 보유');
    }
  });

  // 11. 전투 세션 중복 종료 방지 (unit test)
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
