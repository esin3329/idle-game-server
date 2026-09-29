import { describe, expect, it } from 'vitest';
import { createApiUpstreamRequest, rewriteAdminApiRequest } from '../cloudflare-routing.js';

describe('Cloudflare admin API routing', () => {
  it('strips the SPA proxy prefix from admin API paths and preserves query strings', () => {
    const request = new Request('https://idle-game.example/api/admin/ai/runs/run-1?targetUserId=user-1');
    const rewritten = rewriteAdminApiRequest(request);

    expect(new URL(rewritten.url).pathname).toBe('/admin/ai/runs/run-1');
    expect(new URL(rewritten.url).searchParams.get('targetUserId')).toBe('user-1');
  });

  it('strips the SPA proxy prefix from auth API paths', () => {
    const request = new Request('https://idle-game.example/api/auth/login');
    expect(new URL(rewriteAdminApiRequest(request).url).pathname).toBe('/auth/login');
  });

  it('keeps game API paths intact because the server routes already include /api', () => {
    const request = new Request('https://idle-game.example/api/players/player-1/claim', { method: 'POST' });
    const rewritten = rewriteAdminApiRequest(request);

    expect(new URL(rewritten.url).pathname).toBe('/api/players/player-1/claim');
    expect(rewritten.method).toBe('POST');
  });

  it('proxies admin requests to the configured Node origin, preserving query, method, headers, and body', async () => {
    const request = new Request('https://admin.example/api/admin/users?search=pilot', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });

    const upstream = createApiUpstreamRequest(request, 'https://api.example.net');

    expect(new URL(upstream.url).origin).toBe('https://api.example.net');
    expect(new URL(upstream.url).pathname).toBe('/admin/users');
    expect(new URL(upstream.url).searchParams.get('search')).toBe('pilot');
    expect(upstream.method).toBe('POST');
    expect(upstream.headers.get('Authorization')).toBe('Bearer test-token');
    expect(await upstream.json()).toEqual({ status: 'active' });
  });

  it('rejects non-HTTPS public API origins', () => {
    const request = new Request('https://admin.example/api/admin/health');
    expect(() => createApiUpstreamRequest(request, 'http://api.example.net')).toThrow('API_ORIGIN must use HTTPS');
  });
});
