import { afterEach, expect, it, vi } from 'vitest';
const { login, setTokens, clearTokens } = await import('../../admin/src/' + 'api.ts');

const values = new Map<string, string>();
vi.stubGlobal('localStorage', {
  setItem: (key: string, value: string) => values.set(key, value),
  getItem: (key: string) => values.get(key) ?? null,
  removeItem: (key: string) => values.delete(key),
});
afterEach(() => { clearTokens(); vi.unstubAllGlobals(); });

it('stores nested login tokens without sending an old access token', async () => {
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  setTokens('old-access', 'old-refresh');
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ userId: 'user', playerId: 'player', tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' } }));
  vi.stubGlobal('fetch', fetchMock);
  await login('test@example.test', 'test-password');
  expect(values.get('admin_access_token')).toBe('new-access');
  expect(values.get('admin_refresh_token')).toBe('new-refresh');
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
});

it('shows the actual login rejection without attempting token refresh', async () => {
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  setTokens('old-access', 'old-refresh');
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: '이메일 또는 비밀번호가 일치하지 않습니다.', code: 'INVALID_CREDENTIALS' }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(login('test@example.test', 'test-password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


