/**
 * Admin SPA API 클라이언트(`api.ts`) 계약 스모크 테스트.
 *
 * 실제 서버 없이 `fetch`/`localStorage`를 스텁해 토큰 저장, 요청 헤더(Authorization/Idempotency-Key),
 * 401 → refresh → 재시도, 엔드포인트 경로/메서드/본문, 서버 오류(ApiError) 전파를 검증한다.
 * 서버와의 실제 통신은 검증하지 않는다 (서버 쪽 계약은 루트 `src/__tests__`가 담당).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError, clearTokens, createGrant, createOperator, createSanction, getAccessToken, getAdminHealth,
  listOperators, listUsers, loadTokens, login, setTokens, suspendUser, updateOperatorRole,
} from '../api';

// ─── 브라우저 API 스텁 ────────────────────────────────

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
  get size(): number { return this.items.size; }
}

const ACCESS_KEY = 'admin_access_token';
const REFRESH_KEY = 'admin_refresh_token';

let storage: MemoryStorage;
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface RecordedCall { url: string; method: string; headers: Record<string, string>; body: unknown }

// api.ts는 재시도 시 headers 객체를 변경하므로, 호출 시점의 값을 복사해 기록한다.
let recorded: RecordedCall[];

function callAt(index: number): RecordedCall {
  return recorded[index];
}

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  recorded = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    recorded.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    return fetchMock(input, init);
  });
  clearTokens();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── 토큰 저장소 ──────────────────────────────────────

describe('토큰 저장소', () => {
  it('setTokens는 메모리와 localStorage에 저장하고 clearTokens는 둘 다 비운다', () => {
    expect(getAccessToken()).toBeNull();
    setTokens('access-1', 'refresh-1');
    expect(getAccessToken()).toBe('access-1');
    expect(storage.getItem(ACCESS_KEY)).toBe('access-1');
    expect(storage.getItem(REFRESH_KEY)).toBe('refresh-1');

    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(storage.size).toBe(0);
  });

  it('loadTokens는 두 토큰이 모두 저장된 경우에만 복원한다', () => {
    expect(loadTokens()).toBe(false);

    storage.setItem(ACCESS_KEY, 'only-access');
    expect(loadTokens()).toBe(false);
    expect(getAccessToken()).toBeNull();

    storage.setItem(REFRESH_KEY, 'refresh-2');
    expect(loadTokens()).toBe(true);
    expect(getAccessToken()).toBe('only-access');
  });
});

// ─── 요청 헤더 ────────────────────────────────────────

describe('요청 헤더', () => {
  it('GET은 Bearer 토큰만 붙이고 Idempotency-Key는 붙이지 않는다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { users: [], limit: 20, offset: 0, total: 0 }));

    await listUsers({ limit: 20, offset: 40, search: 'neo', status: 'active' });

    const call = callAt(0);
    expect(call.url).toBe('/api/admin/users?limit=20&offset=40&search=neo&status=active');
    expect(call.method).toBe('GET');
    expect(call.headers.Authorization).toBe('Bearer access-1');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('토큰이 없으면 Authorization 헤더를 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { users: [] }));
    await listUsers({});
    expect(callAt(0).headers).not.toHaveProperty('Authorization');
    expect(callAt(0).url).toBe('/api/admin/users?');
  });

  it('POST/PUT은 메서드 접두사가 붙은 UUID Idempotency-Key를 호출마다 새로 생성한다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { id: 's1', type: 'chat_ban', status: 'active' }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 's2', type: 'chat_ban', status: 'active' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'suspended' }));

    await createSanction('u1', 'chat_ban', '욕설 사용 제재');
    await createSanction('u1', 'chat_ban', '욕설 사용 제재');
    await suspendUser('u1', '계정 정지 사유');

    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const [first, second, third] = [callAt(0), callAt(1), callAt(2)];
    expect(first.headers['Idempotency-Key']).toMatch(new RegExp(`^post-${uuid}$`));
    expect(second.headers['Idempotency-Key']).toMatch(new RegExp(`^post-${uuid}$`));
    expect(second.headers['Idempotency-Key']).not.toBe(first.headers['Idempotency-Key']);
    expect(third.method).toBe('PUT');
    expect(third.headers['Idempotency-Key']).toMatch(new RegExp(`^put-${uuid}$`));
    for (const call of [first, second, third]) expect(call.headers.Authorization).toBe('Bearer access-1');
  });
});

// ─── 401 → refresh → 재시도 ───────────────────────────

describe('401 토큰 갱신', () => {
  it('401이면 /auth/refresh로 토큰을 교체하고 동일 요청(동일 Idempotency-Key)을 새 토큰으로 재시도한다', async () => {
    setTokens('expired-access', 'refresh-old');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired', code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-new', refreshToken: 'refresh-new' }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'sanction-1', type: 'chat_ban', status: 'active' }));

    const result = await createSanction('u1', 'chat_ban', '욕설 사용 제재', '2030-01-01T00:00:00.000Z');

    expect(result).toEqual({ id: 'sanction-1', type: 'chat_ban', status: 'active' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const original = callAt(0);
    const refresh = callAt(1);
    const retry = callAt(2);
    expect(original.headers.Authorization).toBe('Bearer expired-access');
    expect(refresh.url).toBe('/api/auth/refresh');
    expect(refresh.method).toBe('POST');
    expect(refresh.body).toEqual({ refreshToken: 'refresh-old' });
    expect(retry.url).toBe(original.url);
    expect(retry.method).toBe('POST');
    expect(retry.body).toEqual(original.body);
    expect(retry.headers.Authorization).toBe('Bearer access-new');
    expect(retry.headers['Idempotency-Key']).toBe(original.headers['Idempotency-Key']);

    expect(getAccessToken()).toBe('access-new');
    expect(storage.getItem(ACCESS_KEY)).toBe('access-new');
    expect(storage.getItem(REFRESH_KEY)).toBe('refresh-new');
  });

  it('갱신이 실패하면 토큰을 지우고 ApiError(401)를 던지며 원 요청을 재시도하지 않는다', async () => {
    setTokens('expired-access', 'refresh-revoked');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'revoked', code: 'TOKEN_EXPIRED' }));

    const error = await listUsers({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'ApiError', status: 401, code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
    expect(storage.size).toBe(0);
  });

  it('갱신 요청이 네트워크 오류로 실패해도 토큰을 지우고 ApiError(401)를 던진다', async () => {
    setTokens('expired-access', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockRejectedValueOnce(new TypeError('network down'));

    await expect(listUsers({})).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(getAccessToken()).toBeNull();
    expect(storage.size).toBe(0);
  });

  it('refresh 토큰이 없으면 갱신을 시도하지 않고 바로 ApiError(401)를 던진다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(listUsers({})).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('갱신 후 재시도가 실패하면 서버의 status/code/message를 그대로 전달한다', async () => {
    setTokens('expired-access', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-new', refreshToken: 'refresh-new' }))
      .mockResolvedValueOnce(jsonResponse(403, { error: '운영자 권한이 필요합니다.', code: 'FORBIDDEN' }));

    await expect(listUsers({})).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: '운영자 권한이 필요합니다.' });
    expect(getAccessToken()).toBe('access-new');
  });
});

// ─── 엔드포인트 계약 ──────────────────────────────────

describe('엔드포인트 계약', () => {
  it('login은 인증 헤더 없이 자격 증명을 POST하고 응답 토큰을 저장한다', async () => {
    setTokens('stale-access', 'stale-refresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {
      userId: 'op-1', playerId: 'player-1', tokens: { accessToken: 'access-login', refreshToken: 'refresh-login' },
    }));

    const result = await login('op@example.test', 'pw-12345678');

    const call = callAt(0);
    expect(call.url).toBe('/api/auth/login');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ email: 'op@example.test', password: 'pw-12345678' });
    expect(call.headers).not.toHaveProperty('Authorization');
    expect(call.headers['Idempotency-Key']).toMatch(/^post-/);
    expect(result.userId).toBe('op-1');
    expect(getAccessToken()).toBe('access-login');
    expect(storage.getItem(REFRESH_KEY)).toBe('refresh-login');
  });

  it('login 실패(401)는 갱신을 시도하지 않고 서버 오류를 ApiError로 전달하며 기존 토큰을 건드리지 않는다', async () => {
    setTokens('keep-access', 'keep-refresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: '이메일 또는 비밀번호가 일치하지 않습니다.', code: 'INVALID_CREDENTIALS' }));

    const error = await login('op@example.test', 'wrong').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('keep-access');
  });

  it('createSanction은 POST /admin/users/:id/sanctions에 type/reasonText/expiresAt를 보낸다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 's1', type: 'battle_restriction', status: 'active' }));

    await createSanction('user-7', 'battle_restriction', '전투 조작 의심', '2030-01-01T00:00:00.000Z');

    const call = callAt(0);
    expect(call.url).toBe('/api/admin/users/user-7/sanctions');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ type: 'battle_restriction', reasonText: '전투 조작 의심', expiresAt: '2030-01-01T00:00:00.000Z' });
  });

  it('createSanction 서버 검증 오류(400)는 status/code/message를 보존한다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: '사유는 5자 이상이어야 합니다.', code: 'BAD_REQUEST' }));

    const error = await createSanction('user-7', 'chat_ban', '짧음').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'BAD_REQUEST', message: '사유는 5자 이상이어야 합니다.' });
    expect(callAt(0).body).toEqual({ type: 'chat_ban', reasonText: '짧음' });
  });

  it('createGrant는 POST /admin/users/:id/grants에 지급 정보를 보내고 응답을 반환한다', async () => {
    setTokens('access-1', 'refresh-1');
    const granted = { status: 'granted', grantType: 'currency', resourceCode: 'scrap', amount: 500, grantId: 'g-1' };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, granted));

    const result = await createGrant('user-7', 'currency', 'scrap', 500, '이벤트 보상 지급');

    const call = callAt(0);
    expect(call.url).toBe('/api/admin/users/user-7/grants');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ resourceType: 'currency', resourceCode: 'scrap', amount: 500, reasonText: '이벤트 보상 지급' });
    expect(result).toEqual(granted);
  });

  it('createGrant 권한 오류(403)와 멱등성 충돌(409)을 ApiError로 전달한다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: '권한이 없습니다.', code: 'FORBIDDEN' }))
      .mockResolvedValueOnce(jsonResponse(409, { error: '동일한 키가 다른 요청에 사용되었습니다.', code: 'IDEMPOTENCY_CONFLICT' }));

    await expect(createGrant('user-7', 'currency', 'electricity', 20000, '고액 지급 시도'))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: '권한이 없습니다.' });
    await expect(createGrant('user-7', 'currency', 'electricity', 20000, '고액 지급 시도'))
      .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    // 오류 응답은 인증 상태를 바꾸지 않는다
    expect(getAccessToken()).toBe('access-1');
  });

  it('JSON이 아닌 오류 응답은 statusText로 대체한다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }));

    await expect(listUsers({})).rejects.toMatchObject({ status: 502, message: 'Bad Gateway', code: undefined });
  });

  it('getAdminHealth는 인증 헤더와 함께 GET /admin/health를 호출해 role을 반환한다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'ok', role: 'admin' }));

    const result = await getAdminHealth();

    const call = callAt(0);
    expect(call.url).toBe('/api/admin/health');
    expect(call.method).toBe('GET');
    expect(call.headers['Authorization']).toBe('Bearer access-1');
    expect(call.headers).not.toHaveProperty('Idempotency-Key');
    expect(result).toEqual({ status: 'ok', role: 'admin' });
  });

  it('getAdminHealth는 401 시 refresh 후 재시도한다', async () => {
    setTokens('expired', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'ok', role: 'operator' }));

    await expect(getAdminHealth()).resolves.toEqual({ status: 'ok', role: 'operator' });
    expect(callAt(1).url).toBe('/api/auth/refresh');
    expect(callAt(2).headers['Authorization']).toBe('Bearer access-2');
  });

  it('listOperators는 GET /admin/operators 응답을 반환한다', async () => {
    setTokens('access-1', 'refresh-1');
    const operators = [{ id: 'o1', email: 'op@example.test', nickname: 'op', role: 'operator', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }];
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { operators }));

    const result = await listOperators();

    const call = callAt(0);
    expect(call.url).toBe('/api/admin/operators');
    expect(call.method).toBe('GET');
    expect(call.headers['Authorization']).toBe('Bearer access-1');
    expect(result.operators).toEqual(operators);
  });

  it('createOperator는 POST /admin/operators에 email/password/nickname/role과 Idempotency-Key를 보낸다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'o2', email: 'new@example.test', role: 'admin', status: 'active' }));

    const result = await createOperator({ email: 'new@example.test', password: 'pw-12345678', nickname: 'newop', role: 'admin' });

    const call = callAt(0);
    expect(call.url).toBe('/api/admin/operators');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ email: 'new@example.test', password: 'pw-12345678', nickname: 'newop', role: 'admin' });
    expect(call.headers['Idempotency-Key']).toMatch(/^post-/);
    expect(result).toEqual({ id: 'o2', email: 'new@example.test', role: 'admin', status: 'active' });
  });

  it('createOperator 권한 오류(403)와 충돌(409)을 ApiError로 전달한다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: '권한이 없습니다.', code: 'FORBIDDEN' }))
      .mockResolvedValueOnce(jsonResponse(409, { error: '이미 사용 중인 이메일입니다.', code: 'CONFLICT' }));
    const input = { email: 'dup@example.test', password: 'pw-12345678', nickname: 'dup', role: 'operator' as const };

    const forbidden = await createOperator(input).catch((e: unknown) => e);
    expect(forbidden).toBeInstanceOf(ApiError);
    expect(forbidden).toMatchObject({ status: 403, code: 'FORBIDDEN', message: '권한이 없습니다.' });
    await expect(createOperator(input)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(getAccessToken()).toBe('access-1');
  });

  it('updateOperatorRole은 PUT /admin/operators/:id/role에 role/reason과 Idempotency-Key를 보낸다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'o2', role: 'operator' }));

    const result = await updateOperatorRole('o2', 'operator', '권한 축소');

    const call = callAt(0);
    expect(call.url).toBe('/api/admin/operators/o2/role');
    expect(call.method).toBe('PUT');
    expect(call.body).toEqual({ role: 'operator', reason: '권한 축소' });
    expect(call.headers['Idempotency-Key']).toMatch(/^put-/);
    expect(result).toEqual({ id: 'o2', role: 'operator' });
  });

  it('updateOperatorRole 권한 오류(403)와 충돌(409)을 ApiError로 전달한다', async () => {
    setTokens('access-1', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: '권한이 없습니다.', code: 'FORBIDDEN' }))
      .mockResolvedValueOnce(jsonResponse(409, { error: '마지막 admin은 강등할 수 없습니다.', code: 'CONFLICT' }));

    await expect(updateOperatorRole('o1', 'operator', '사유')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(updateOperatorRole('o1', 'operator', '사유')).rejects.toMatchObject({ status: 409, message: '마지막 admin은 강등할 수 없습니다.' });
  });
});
