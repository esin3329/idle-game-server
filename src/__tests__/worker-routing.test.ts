process.env.DB_DRIVER = 'json';

import { describe, expect, it, vi } from 'vitest';

const { default: worker } = await import('../worker.js');

describe('Worker API path routing', () => {
  it('forwards /api requests to the server and leaves non-API paths to assets', async () => {
    const assetResponse = new Response('static asset');
    const fetchAsset = vi.fn(async () => assetResponse);
    const env = {
      ASSETS: { fetch: fetchAsset },
      AI_RUNS_QUEUE: { send: vi.fn() },
    } as any;

    const legacyPath = await worker.fetch(new Request('https://game.example/auth/login'), env);
    expect(await legacyPath.text()).toBe('static asset');
    expect(fetchAsset).toHaveBeenCalledTimes(1);

    const apiPath = await worker.fetch(new Request('https://game.example/api/auth/login'), env);
    expect(apiPath.status).toBe(503);
    expect(await apiPath.json()).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(fetchAsset).toHaveBeenCalledTimes(1);

    const health = await worker.fetch(new Request('https://game.example/api/health'), env);
    expect(health.status).toBe(200);
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });
});
