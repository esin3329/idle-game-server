process.env.DB_DRIVER = 'json';

import { describe, expect, it } from 'vitest';

const { app } = await import('../app.js');

describe('canonical /api contract', () => {
  it('serves application routes under /api and rejects legacy root and doubled prefixes', async () => {
    const parts = await app.request('/api/parts');
    expect(parts.status).toBe(200);
    const partCatalog = await parts.json() as Record<string, unknown>;
    expect(partCatalog).toMatchObject({
      frames: expect.any(Array),
      weapons: expect.any(Array),
      cores: expect.any(Array),
      modules: expect.any(Array),
    });

    const legacyParts = await app.request('/parts');
    expect(legacyParts.status).toBe(404);
    expect(await legacyParts.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' });

    const doubledPrefix = await app.request('/api/api/parts');
    expect(doubledPrefix.status).toBe(404);

    const canonicalAuth = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'api-contract-invalid-register' },
      body: JSON.stringify({ email: 'invalid' }),
    });
    expect(canonicalAuth.status).toBe(400);

    const legacyAuth = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid' }),
    });
    expect(legacyAuth.status).toBe(404);
  });
});
