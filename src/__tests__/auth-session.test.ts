import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'core-forge-auth-'));
for (const name of ['USERS', 'SESSIONS', 'SANCTIONS', 'PROFILES', 'WALLETS']) {
  vi.stubEnv(`DATA_FILE_${name}`, join(directory, `${name.toLowerCase()}.json`));
}
vi.stubEnv('JWT_REFRESH_EXPIRES_IN', '');
const { registerUser, loginUser, refreshTokens, revokeRefreshToken } = await import('../shared/auth-service.js');
const startedAt = new Date('2026-10-05T00:00:00Z');
const day = 86_400_000;

afterEach(() => vi.useRealTimers());
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('restores a login after twenty days and rejects its rotated token', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(startedAt);
  await registerUser('remember@example.test', 'local-test-password', 'RememberPilot');
  const login = await loginUser('remember@example.test', 'local-test-password');
  vi.setSystemTime(startedAt.getTime() + 20 * day);
  const rotated = await refreshTokens(login.tokens.refreshToken);
  expect(rotated.accessToken).toBeTruthy();
  await expect(refreshTokens(login.tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
});

it('requires login once the original token reaches twenty-one days', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(startedAt);
  const login = await registerUser('expired@example.test', 'local-test-password', 'ExpiredPilot');
  vi.setSystemTime(startedAt.getTime() + 21 * day);
  await expect(refreshTokens(login.tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
});

it('rejects a remembered login after logout revokes its token', async () => {
  const login = await registerUser('logout@example.test', 'local-test-password', 'LogoutPilot');
  await revokeRefreshToken(login.tokens.refreshToken);
  await expect(refreshTokens(login.tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
});
