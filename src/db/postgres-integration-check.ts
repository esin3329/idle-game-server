import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compare } from 'bcryptjs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { migratePostgres } from './postgres-migrate.js';
import { withPostgresConnection, withPostgresTransaction, closePostgresPool } from './postgres-connection.js';
import { registerUserTransaction } from './postgres-auth.repository.js';
import { postgresWalletRepo } from './postgres-wallet.repository.js';
import { postgresAdminRepo } from './postgres-admin.repository.js';
import { resetOperatorPassword } from './reset-operator-password.js';
import { AppError } from '../shared/errors.js';
import { seed as seedBattleContent } from './battle-seed.js';

await mkdir('.tools', { recursive: true });
const dir = await mkdtemp(resolve('.tools/postgres-check-'));
const password = randomUUID();
const postgres = new EmbeddedPostgres({
  databaseDir: dir, user: 'postgres', password, port: 55437,
  persistent: true, createPostgresUser: false,
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
  onLog: () => {}, onError: (message) => console.error(message),
});
let client: Client | undefined;
try {
  await postgres.initialise();
  await postgres.start();
  client = postgres.getPgClient();
  await client.connect();
  // Use the same local credentials without printing them.
  const connectionString = 'postgresql://postgres:' + encodeURIComponent(password) + '@127.0.0.1:55437/postgres';
  await migratePostgres(connectionString);
  await migratePostgres(connectionString);
  const tables = await client.query<{ count: string }>("SELECT count(*) FROM pg_tables WHERE schemaname='game'");
  assert.equal(Number(tables.rows[0].count), 37);
  const rls = await client.query<{ count: string }>("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='game' AND c.relkind='r' AND NOT c.relrowsecurity");
  assert.equal(Number(rls.rows[0].count), 0);
  const account = await withPostgresConnection(connectionString, () => registerUserTransaction('check@example.test', 'check', 'test-only-hash'));
  const player = await client.query<{ count: string }>('SELECT count(*) FROM game.players WHERE id=$1', [account.playerId]);
  assert.equal(Number(player.rows[0].count), 1);
  const key = randomUUID();
  const credit = () => withPostgresConnection(connectionString, () => postgresWalletRepo.adjustBalance({
    playerId: account.playerId, amount: 100, source: 'test', idempotencyKey: key,
  }));
  const outcomes = await Promise.all(Array.from({ length: 8 }, credit));
  assert.equal(outcomes.filter((outcome) => outcome.success).length, 1);
  const balance = await withPostgresConnection(connectionString, () => postgresWalletRepo.getBalance(account.playerId));
  assert.equal(balance?.balance, 100);
  await assert.rejects(withPostgresConnection(connectionString, () => withPostgresTransaction(async () => {
    await postgresWalletRepo.adjustBalance({ playerId: account.playerId, amount: 50, source: 'test', idempotencyKey: randomUUID() });
    throw new Error('rollback-check');
  })), /rollback-check/);
  const afterRollback = await withPostgresConnection(connectionString, () => postgresWalletRepo.getBalance(account.playerId));
  assert.equal(afterRollback?.balance, 100);
  const ledger = await client.query<{ count: string }>('SELECT count(*) FROM game.currency_ledger');
  assert.equal(Number(ledger.rows[0].count), 1);
  process.env.DB_DRIVER = 'postgres';
  process.env.AUTH_PROVIDER = 'local';
  process.env.DATABASE_URL = connectionString;
  process.env.JWT_ACCESS_SECRET = randomUUID();
  process.env.JWT_REFRESH_SECRET = randomUUID();
  const { app } = await import('../app.js');
  const request = (path: string, method = 'GET', body?: object, token?: string, key = randomUUID()) =>
    withPostgresConnection(connectionString, async () => app.request('http://localhost' + path, {
      method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  const registration = await request('/api/auth/register', 'POST', { email: 'api@example.test', password: 'test-password-only', nickname: 'apicheck' });
  assert.equal(registration.status, 201, await registration.clone().text());
  const registered = await registration.json() as { userId: string; playerId: string; tokens: { accessToken: string } };
  const token = registered.tokens.accessToken;
  const login = await request('/api/auth/login', 'POST', { email: 'api@example.test', password: 'test-password-only' });
  assert.equal(login.status, 200, await login.clone().text());
  const staleLogin = await request('/api/auth/login', 'POST', { email: 'api@example.test', password: 'test-password-only' }, 'expired-access-token');
  assert.equal(staleLogin.status, 200, await staleLogin.clone().text());
  const session = await staleLogin.json() as { tokens: { refreshToken: string } };
  const staleRefresh = await request('/api/auth/refresh', 'POST', { refreshToken: session.tokens.refreshToken }, 'expired-access-token');
  assert.equal(staleRefresh.status, 200, await staleRefresh.clone().text());
  const owner = await request('/api/players/' + registered.playerId);
  assert.equal(owner.status, 200);
  await client.query("UPDATE game.wallet_balances SET last_claimed_at=NOW()-INTERVAL '10 seconds' WHERE player_id=$1", [registered.playerId]);
  const claimKey = randomUUID();
  const claims = await Promise.all(Array.from({ length: 4 }, () => request('/api/players/' + registered.playerId + '/claim', 'POST', {}, token, claimKey)));
  const claimBodies = await Promise.all(claims.map(async (response) => { assert.equal(response.status, 200, await response.clone().text()); return response.text(); }));
  assert.equal(new Set(claimBodies).size, 1);
  const claimed = JSON.parse(claimBodies[0]) as { claimed: number };
  assert.ok(claimed.claimed >= 10 && claimed.claimed <= 15);
  const craftId = randomUUID();
  await client.query("INSERT INTO game.crafting_queue (id,player_id,result_code,materials,started_at,completes_at,completed,created_at) VALUES ($1,$2,'medium_frame','{}',NOW()-INTERVAL '1 minute',NOW()-INTERVAL '1 second',0,NOW())", [craftId, registered.playerId]);
  const completion = await request('/api/crafting/' + craftId + '/complete', 'POST', {}, token);
  assert.equal(completion.status, 200, await completion.clone().text());
  const craftedParts = await client.query<{ count: string }>('SELECT count(*) FROM game.parts_inventory WHERE player_id=$1', [registered.playerId]);
  assert.equal(Number(craftedParts.rows[0].count), 1);
  const craftedLedger = await client.query<{ count: string }>('SELECT count(*) FROM game.item_ledger WHERE reference_id=$1', [craftId]);
  assert.equal(Number(craftedLedger.rows[0].count), 1);
  // 선택지 생성(400 CHOICES_GENERATED)이 요청 트랜잭션 롤백으로 사라지지 않고 영속되는지 확인
  await withPostgresConnection(connectionString, () => seedBattleContent());
  interface BattleSessionBody { id: string }
  interface ProgressBody { upgradesAvailable: boolean }
  interface ErrorBody { code: string }
  interface PersistedBattleBody { offeredChoices: { level: number; options: { upgradeId: string }[] }[] }
  interface SelectBody { applied: string[] }
  const battleStart = await request('/api/battles/start', 'POST', { stageCode: 'stage_01_ruins' }, token);
  assert.equal(battleStart.status, 201, await battleStart.clone().text());
  const battleSession: BattleSessionBody = await battleStart.json();
  const battlePath = '/api/battles/' + battleSession.id;
  const battleProgress = await request(battlePath + '/progress', 'POST', { sequence: 1, killsDelta: 10, coreEnergyDelta: 50, elapsedSeconds: 2 }, token);
  assert.equal(battleProgress.status, 200, await battleProgress.clone().text());
  const progressBody: ProgressBody = await battleProgress.json();
  assert.equal(progressBody.upgradesAvailable, true);
  const generated = await request(battlePath + '/upgrades/select', 'POST', { selectedUpgradeCode: 'machine_gun_1' }, token);
  assert.equal(generated.status, 400);
  const generatedBody: ErrorBody = await generated.json();
  assert.equal(generatedBody.code, 'CHOICES_GENERATED');
  const battleState = await request(battlePath, 'GET', undefined, token);
  assert.equal(battleState.status, 200, await battleState.clone().text());
  const persisted: PersistedBattleBody = await battleState.json();
  assert.equal(persisted.offeredChoices.length, 1);
  assert.equal(persisted.offeredChoices[0].level, 2);
  const offeredCode = persisted.offeredChoices[0].options[0].upgradeId;
  const selectedUpgrade = await request(battlePath + '/upgrades/select', 'POST', { selectedUpgradeCode: offeredCode }, token);
  assert.equal(selectedUpgrade.status, 200, await selectedUpgrade.clone().text());
  const selectedBody: SelectBody = await selectedUpgrade.json();
  assert.deepEqual(selectedBody.applied, [offeredCode]);
  const unauthorized = await request('/api/players/' + account.playerId + '/claim', 'POST', {}, token);
  assert.equal(unauthorized.status, 403);
  await client.query("UPDATE game.users SET role='admin' WHERE id=$1", [registered.userId]);
  const adminLogin = await request('/api/auth/login', 'POST', { email: 'api@example.test', password: 'test-password-only' });
  const admin = await adminLogin.json() as { tokens: { accessToken: string } };
  const adminToken = admin.tokens.accessToken;
  const details = await request('/api/admin/users/' + registered.userId, 'GET', undefined, adminToken);
  assert.equal(details.status, 200);
  const userDetails = await details.json() as Record<string, unknown>;
  assert.equal('passwordHash' in userDetails, false);
  assert.equal('refreshToken' in userDetails, false);
  const grantKey = randomUUID();
  const grantBody = { resourceType: 'currency', resourceCode: 'electricity', amount: 20, reasonText: 'integration test grant' };
  const grants = await Promise.all(Array.from({ length: 3 }, () => request('/api/admin/users/' + registered.userId + '/grants', 'POST', grantBody, adminToken, grantKey)));
  for (const response of grants) assert.equal(response.status, 201, await response.clone().text());
  const granted = await withPostgresConnection(connectionString, () => postgresWalletRepo.getBalance(registered.playerId));
  assert.equal(granted?.balance, claimed.claimed + 20);
  const audit = await request('/api/admin/audit-logs', 'GET', undefined, adminToken);
  assert.equal(audit.status, 200, await audit.clone().text());
  await client.query("UPDATE game.users SET role='user' WHERE id=$1", [registered.userId]);
  const revoked = await request('/api/admin/users', 'GET', undefined, adminToken);
  assert.equal(revoked.status, 403);
  // updateOperatorRole: users.role(코드) 과 operator_accounts.role_id(operator_roles.id UUID) 동기화 (기존 행 갱신 + 행 없을 때 생성)
  const newOperator = (role: string) => {
    const key = randomUUID();
    return withPostgresConnection(connectionString, () => postgresAdminRepo.createOperator({
      email: 'operator-' + key + '@example.test', passwordHash: 'test-only-hash', nickname: 'op' + key.slice(0, 8),
      role, grantedBy: registered.userId,
    }));
  };
  const roleSync = (userId: string) => client!.query<{ user_role: string; role_id: string; code: string; accounts: string }>(
    'SELECT u.role AS user_role, oa.role_id, r.code, (SELECT count(*) FROM game.operator_accounts WHERE user_id=u.id) AS accounts FROM game.users u JOIN game.operator_accounts oa ON oa.user_id=u.id JOIN game.operator_roles r ON r.id=oa.role_id WHERE u.id=$1', [userId]);
  const createdOperator = await newOperator('operator');
  const createdSync = await roleSync(createdOperator.id);
  assert.equal(createdSync.rows.length, 1);
  assert.equal(createdSync.rows[0].code, 'operator');
  assert.notEqual(createdSync.rows[0].role_id, 'operator');
  const roleChange = await withPostgresConnection(connectionString, () => postgresAdminRepo.updateOperatorRole(createdOperator.id, 'admin', registered.userId, 'integration role sync'));
  assert.equal(roleChange.oldRole, 'operator');
  const syncedRoles = await roleSync(createdOperator.id);
  assert.equal(syncedRoles.rows.length, 1);
  assert.equal(syncedRoles.rows[0].user_role, 'admin');
  assert.equal(syncedRoles.rows[0].code, 'admin');
  assert.notEqual(syncedRoles.rows[0].role_id, 'admin');
  assert.equal(Number(syncedRoles.rows[0].accounts), 1);
  await withPostgresConnection(connectionString, () => postgresAdminRepo.updateOperatorRole(registered.userId, 'operator', createdOperator.id, 'integration role upsert'));
  const upserted = await roleSync(registered.userId);
  assert.equal(upserted.rows.length, 1);
  assert.equal(upserted.rows[0].user_role, 'operator');
  assert.equal(upserted.rows[0].code, 'operator');
  assert.notEqual(upserted.rows[0].role_id, 'operator');

  // 마지막 활성 관리자 보호: 활성 admin 2명을 동시에 강등하면 정확히 1건만 성공한다
  const secondAdmin = await newOperator('admin');
  const activeAdminCount = async () => Number((await client!.query<{ count: string }>("SELECT count(*) FROM game.users WHERE status='active' AND role IN ('admin','administrator')")).rows[0].count);
  assert.equal(await activeAdminCount(), 2);
  const demotions = await Promise.allSettled([createdOperator.id, secondAdmin.id].map((targetId) =>
    withPostgresConnection(connectionString, () => postgresAdminRepo.updateOperatorRole(targetId, 'operator', registered.userId, 'integration concurrent demotion'))));
  assert.equal(demotions.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const rejectedDemotions = demotions.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  assert.equal(rejectedDemotions.length, 1);
  const rejection = rejectedDemotions[0].reason;
  assert.ok(rejection instanceof AppError);
  assert.deepEqual({ status: rejection.status, code: rejection.code }, { status: 409, code: 'LAST_ADMIN_PROTECTED' });
  assert.equal(await activeAdminCount(), 1);

  // 비밀번호 재설정 CLI: 역할·상태 보존, 해시만 변경, 짧은/빈 비밀번호와 비운영자 거부
  const resetTarget = await newOperator('operator');
  const newPassword = 'reset-password-' + randomUUID();
  const before = await client.query<{ password_hash: string }>('SELECT password_hash FROM game.users WHERE id=$1', [resetTarget.id]);
  await assert.rejects(withPostgresConnection(connectionString, () => resetOperatorPassword('operator-reset@example.test', 'short')), /8자 이상/);
  await assert.rejects(withPostgresConnection(connectionString, () => resetOperatorPassword('operator-reset@example.test', '')), /8자 이상/);
  await assert.rejects(withPostgresConnection(connectionString, () => resetOperatorPassword('  ', newPassword)), /이메일/);
  await assert.rejects(withPostgresConnection(connectionString, () => resetOperatorPassword('check@example.test', newPassword)), /운영자 계정이 아닙니다/);
  const resetEmail = (await client.query<{ email: string }>('SELECT email FROM game.users WHERE id=$1', [resetTarget.id])).rows[0].email;
  await assert.rejects(withPostgresConnection(connectionString, () => resetOperatorPassword(resetEmail, 'short')), /8자 이상/);
  const untouched = await client.query<{ password_hash: string }>('SELECT password_hash FROM game.users WHERE id=$1', [resetTarget.id]);
  assert.equal(untouched.rows[0].password_hash, before.rows[0].password_hash);
  await withPostgresConnection(connectionString, () => resetOperatorPassword(resetEmail, newPassword));
  const after = await client.query<{ password_hash: string; role: string; status: string }>('SELECT password_hash, role, status FROM game.users WHERE id=$1', [resetTarget.id]);
  assert.equal(after.rows[0].role, 'operator');
  assert.equal(after.rows[0].status, 'active');
  assert.equal(await compare(newPassword, after.rows[0].password_hash), true);
  const resetAudit = await client.query<{ count: string }>("SELECT count(*) FROM game.operator_audit_logs WHERE action='operator_password_reset' AND target_id=$1", [resetTarget.id]);
  assert.equal(Number(resetAudit.rows[0].count), 1);
  console.log('PostgreSQL check passed: schema/RLS, duplicate credit, rollback, API signup/login, concurrent claim/grant replay, ownership, operator role sync, last-admin protection, operator password reset and revoked admin access.');
} finally {
  await closePostgresPool();
  await client?.end();
  await postgres.stop();
}


