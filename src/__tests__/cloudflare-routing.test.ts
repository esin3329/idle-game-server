import { describe, expect, it } from 'vitest';
import { rewriteAdminApiRequest } from '../cloudflare-routing.js';

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
});
