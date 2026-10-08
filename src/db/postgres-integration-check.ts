import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { migratePostgres } from './postgres-migrate.js';
import { withPostgresConnection, withPostgresTransaction, closePostgresPool } from './postgres-connection.js';
import { registerUserTransaction } from './postgres-auth.repository.js';
import { postgresWalletRepo } from './postgres-wallet.repository.js';

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
  console.log('PostgreSQL check passed: schema/RLS, duplicate credit, rollback, API signup/login, concurrent claim/grant replay, ownership and revoked admin access.');
} finally {
  await closePostgresPool();
  await client?.end();
  await postgres.stop();
}


