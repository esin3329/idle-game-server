import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { idempotencyGuard } from '../shared/idempotency.js';
import { AppError } from '../shared/errors.js';

function createIdempotencyApp() {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400);
    }
    return c.json({ error: 'internal' }, 500);
  });

  app.post('/test', idempotencyGuard, (c) => {
    return c.json({ key: c.get('idempotencyKey') });
  });

  return app;
}

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

  it('유효한 키는 정상 처리되어야 한다', async () => {
    const app = createIdempotencyApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'valid-key-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('valid-key-123');
  });

  it('UUID 형식의 키도 허용해야 한다', async () => {
    const app = createIdempotencyApp();
    const key = crypto.randomUUID();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe(key);
  });
});
