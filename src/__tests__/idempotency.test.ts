process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono, type Context } from 'hono';
import { idempotencyGuard, clearIdempotencyCache } from '../shared/idempotency.js';
import { AppError } from '../shared/errors.js';

function createIdempotencyApp() {
  const app = new Hono<{ Variables: { idempotencyKey: string } }>();
  let calls = 0;

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400);
    }
    return c.json({ error: 'internal' }, 500);
  });

  const handler = (c: Context<{ Variables: { idempotencyKey: string } }>) => {
    return c.json({ key: c.get('idempotencyKey'), calls: ++calls });
  };
  app.post('/test', idempotencyGuard, handler);
  app.post('/other', idempotencyGuard, handler);
  return app;
}

beforeEach(() => clearIdempotencyCache());

describe('Idempotency-Key', () => {
  it('키가 없으면 400을 반환해야 한다', async () => {
    const app = createIdempotencyApp();
    const res = await app.request('/test', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('키가 비어있으면 400을 반환해야 한다', async () => {
    const app = createIdempotencyApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': '' },
    });
    expect(res.status).toBe(400);
  });

  it('키가 64자를 초과하면 400을 반환해야 한다', async () => {
    const app = createIdempotencyApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'a'.repeat(65) },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('IDEMPOTENCY_KEY_TOO_LONG');
  });

  it('유효한 키는 scope된 키로 정상 처리되어야 한다', async () => {
    const app = createIdempotencyApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'valid-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(/^[a-f0-9]{64}$/);
    expect(body.key).not.toBe('valid-key-123');
  });

  it('동일 키·경로·본문의 동시 재시도는 한 번만 실행되고 결과를 재생한다', async () => {
    const app = createIdempotencyApp();
    const request = () => app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'retry-key' },
    });
    const [first, second] = await Promise.all([request(), request()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ calls: 1 });
    expect(await second.json()).toMatchObject({ calls: 1 });
  });

  it('같은 키의 다른 본문은 거부하고 다른 경로는 별도 처리한다', async () => {
    const app = createIdempotencyApp();
    const first = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'reuse-key', 'Content-Type': 'application/json' },
      body: '{"amount":1}',
    });
    expect(first.status).toBe(200);

    const conflict = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'reuse-key', 'Content-Type': 'application/json' },
      body: '{"amount":2}',
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const otherPath = await app.request('/other', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'reuse-key' },
    });
    expect(otherPath.status).toBe(200);
    expect(await otherPath.json()).toMatchObject({ calls: 2 });
  });

  it('UUID 형식의 키도 허용해야 한다', async () => {
    const app = createIdempotencyApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(res.status).toBe(200);
  });
});
