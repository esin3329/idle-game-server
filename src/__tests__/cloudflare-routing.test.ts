import { describe, expect, it } from 'vitest';
import { createApiUpstreamRequest } from '../cloudflare-routing.js';

describe('Cloudflare admin API routing', () => {
  it('preserves admin, auth, and game API paths for the public server proxy', () => {
    const adminRequest = new Request('https://idle-game.example/api/admin/ai/runs/run-1?targetUserId=user-1');
    const authRequest = new Request('https://idle-game.example/api/auth/login');
    const request = new Request('https://idle-game.example/api/players/player-1/claim', { method: 'POST' });

    expect(new URL(createApiUpstreamRequest(adminRequest, 'https://api.example.net').url).pathname)
      .toBe('/api/admin/ai/runs/run-1');
    expect(new URL(createApiUpstreamRequest(adminRequest, 'https://api.example.net').url).searchParams.get('targetUserId'))
      .toBe('user-1');
    expect(new URL(createApiUpstreamRequest(authRequest, 'https://api.example.net').url).pathname)
      .toBe('/api/auth/login');
    const upstreamGameRequest = createApiUpstreamRequest(request, 'https://api.example.net');
    expect(new URL(upstreamGameRequest.url).pathname).toBe('/api/players/player-1/claim');
    expect(upstreamGameRequest.method).toBe('POST');
  });

  it('proxies admin requests to the configured Node origin, preserving query, method, headers, and body', async () => {
    const request = new Request('https://admin.example/api/admin/users?search=pilot', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });

    const upstream = createApiUpstreamRequest(request, 'https://api.example.net');

    expect(new URL(upstream.url).origin).toBe('https://api.example.net');
    expect(new URL(upstream.url).pathname).toBe('/api/admin/users');
    expect(new URL(upstream.url).searchParams.get('search')).toBe('pilot');
    expect(upstream.method).toBe('POST');
    expect(upstream.headers.get('Authorization')).toBe('Bearer test-token');
    expect(await upstream.json()).toEqual({ status: 'active' });
  });

  it('preserves Worker health aliases as server root health paths', () => {
    const health = createApiUpstreamRequest(new Request('https://admin.example/health'), 'https://api.example.net');
    const live = createApiUpstreamRequest(new Request('https://admin.example/health/live'), 'https://api.example.net');
    const ready = createApiUpstreamRequest(new Request('https://admin.example/ready'), 'https://api.example.net');
    const metrics = createApiUpstreamRequest(new Request('https://admin.example/metrics'), 'https://api.example.net');

    expect(new URL(health.url).pathname).toBe('/health');
    expect(new URL(live.url).pathname).toBe('/health/live');
    expect(new URL(ready.url).pathname).toBe('/ready');
    expect(new URL(metrics.url).pathname).toBe('/metrics');
  });

  it('rejects non-HTTPS public API origins', () => {
    const request = new Request('https://admin.example/api/admin/health');
    expect(() => createApiUpstreamRequest(request, 'http://api.example.net')).toThrow('API_ORIGIN must use HTTPS');
  });
});
