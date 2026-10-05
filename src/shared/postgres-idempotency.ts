import type { Context, Next } from 'hono';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/postgres-connection.js';
import { AppError } from './errors.js';

export async function postgresIdempotency(c: Context<{ Variables: { idempotencyKey: string } }>, next: Next, key: string): Promise<Response | void> {
  const body = await c.req.raw.clone().text();
  const principal = 'userId' in c.var && typeof c.var.userId === 'string'
    ? c.var.userId : createHash('sha256').update(body).digest('hex');
  const scopedKey = createHash('sha256').update([principal, c.req.method, c.req.path, key].join(':')).digest('hex');
  const requestHash = createHash('sha256').update(body).digest('hex');
  const db = getDb();
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'idempotency:' + scopedKey}, 0))`);
  const cached = await db.execute<{ request_hash: string; status: number; response_body: string }>(sql`
    SELECT request_hash, status, response_body FROM game.request_idempotency
    WHERE scope_key = ${scopedKey} AND expires_at > CURRENT_TIMESTAMP`);
  const entry = cached.rows[0];
  if (entry) {
    if (entry.request_hash !== requestHash) throw new AppError('동일한 키가 다른 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
    return new Response(entry.response_body, { status: entry.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  c.set('idempotencyKey', scopedKey);
  await next();
  if (c.res.status >= 200 && c.res.status < 300) {
    const responseBody = await c.res.clone().text();
    await db.execute(sql`
      INSERT INTO game.request_idempotency(scope_key, request_hash, status, response_body, expires_at)
      VALUES(${scopedKey}, ${requestHash}, ${c.res.status}, ${responseBody}, CURRENT_TIMESTAMP + INTERVAL '24 hours')
      ON CONFLICT(scope_key) DO UPDATE SET request_hash = EXCLUDED.request_hash,
        status = EXCLUDED.status, response_body = EXCLUDED.response_body, expires_at = EXCLUDED.expires_at`);
  }
}
