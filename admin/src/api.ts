import type {
  User, UserDetail, WalletLedgerEntry, ItemLedgerEntry,
  Sanction, Grant, SecurityEvent, AuditLog, Battle,
  AuthResult, PaginatedResponse, Operator, AdminHealth,
} from './types';

const BASE_URL = '/api';

let accessToken: string | null = null;
let refreshToken: string | null = null;
// 로그인/로그아웃(setTokens/clearTokens)마다 증가하는 세션 세대. refresh에 의한 토큰 회전은 올리지 않는다.
let tokenEpoch = 0;
let refreshInFlight: { epoch: number; promise: Promise<boolean> } | null = null;

export function setTokens(access: string, refresh: string) {
  tokenEpoch++;
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('admin_access_token', access);
  localStorage.setItem('admin_refresh_token', refresh);
}

export function loadTokens(): boolean {
  const a = localStorage.getItem('admin_access_token');
  const r = localStorage.getItem('admin_refresh_token');
  if (a && r) {
    accessToken = a;
    refreshToken = r;
    return true;
  }
  return false;
}

export function clearTokens() {
  tokenEpoch++;
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('admin_access_token');
  localStorage.removeItem('admin_refresh_token');
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  // 이 요청이 속한 세션과 사용한 토큰을 캡처해, 뒤늦게 도착한 401이 새 세션을 지우지 않게 한다.
  const epoch = tokenEpoch;
  const usedToken = accessToken;
  if (usedToken && path !== '/auth/login') {
    headers['Authorization'] = `Bearer ${usedToken}`;
  }

  // Idempotency-Key for mutation requests
  let idempotencyHeader = '';
  if (options.method && options.method !== 'GET') {
    idempotencyHeader = `${options.method.toLowerCase()}-${crypto.randomUUID()}`;
    headers['Idempotency-Key'] = idempotencyHeader;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401 && path !== '/auth/login') {
    const unauthorized = () => new ApiError('인증이 필요합니다.', 401, 'UNAUTHORIZED');
    // 요청 도중 로그인/로그아웃으로 세션이 바뀜: 새 세션을 건드리지 않는다.
    if (tokenEpoch !== epoch) throw unauthorized();

    // 같은 세션에서 다른 요청이 이미 토큰을 갱신했다면 refresh 없이 새 토큰으로 재시도한다.
    let refreshed = accessToken !== null && accessToken !== usedToken;
    if (!refreshed && refreshToken) {
      refreshed = await tryRefresh(epoch);
      if (tokenEpoch !== epoch) throw unauthorized();
    }
    if (!refreshed || !accessToken) {
      clearTokens();
      throw unauthorized();
    }

    headers['Authorization'] = `Bearer ${accessToken}`;
    const retryRes = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    if (!retryRes.ok) {
      const err = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
      throw new ApiError(err.error || '요청 실패', retryRes.status, err.code);
    }
    return retryRes.json();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(err.error || '요청 실패', res.status, err.code);
  }

  return res.json();
}

export interface GameOpsEvidence {
  id: string;
  type: string;
  title: string;
  occurredAt?: string;
  data: unknown;
}

export type GameOpsRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out';

export interface GameOpsRun {
  id: string;
  targetUserId: string;
  status: GameOpsRunStatus;
  caseType: 'missing_reward' | 'duplicate_suspected' | 'battle_rejected';
  provider: 'gemini' | 'huggingface';
  model: string;
  elapsedMs?: number;
  errorCode?: string;
  toolsUsed: string[];
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  result?: {
    verdict: 'confirmed' | 'suspected' | 'insufficient_evidence';
    facts: Array<{ text: string; evidenceIds: string[] }>;
    hypotheses: Array<{ text: string; evidenceIds: string[]; confidence: 'low' | 'medium' | 'high' }>;
    nextChecks: string[];
    replyDraft: string;
    evidence: GameOpsEvidence[];
  };
}

export interface AiProviderInfo {
  id: 'gemini' | 'huggingface';
  name: string;
  enabled: boolean;
  model: string;
}

export async function listAiProviders(): Promise<{ providers: AiProviderInfo[] }> {
  return request('/admin/ai/providers');
}

export async function analyzeGameOpsIssue(input: {
  targetUserId: string;
  caseType: GameOpsRun['caseType'];
  provider: AiProviderInfo['id'];
  question: string;
}): Promise<{ id: string; status: GameOpsRunStatus; replayed: boolean }> {
  return request('/admin/ai/analyze', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getGameOpsRun(id: string, targetUserId: string): Promise<GameOpsRun> {
  const q = new URLSearchParams({ targetUserId });
  return request(`/admin/ai/runs/${encodeURIComponent(id)}?${q}`);
}

async function refreshTokens(startEpoch: number): Promise<boolean> {
  const currentRefresh = refreshToken;
  if (!currentRefresh) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: currentRefresh }),
    });
    if (!res.ok) return false;
    const data: { accessToken: string; refreshToken: string } = await res.json();
    // 갱신 도중 로그인/로그아웃으로 세션이 바뀌었다면 결과를 버린다.
    if (tokenEpoch !== startEpoch) return false;
    // 같은 세션 안의 토큰 회전이므로 tokenEpoch는 올리지 않는다.
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    localStorage.setItem('admin_access_token', data.accessToken);
    localStorage.setItem('admin_refresh_token', data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** 같은 세션(tokenEpoch)에서 동시에 발생한 401들만 하나의 refresh 요청을 공유한다(refresh 토큰 회전 중복 방지). */
function tryRefresh(startEpoch: number): Promise<boolean> {
  if (refreshInFlight?.epoch === startEpoch) return refreshInFlight.promise;
  const promise: Promise<boolean> = refreshTokens(startEpoch).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  });
  refreshInFlight = { epoch: startEpoch, promise };
  return promise;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Auth ───────────────────────────────────────────

/** 서버 응답만 반환하고 토큰은 건드리지 않는다. 세대 검증이 필요한 호출자(AuthContext)가 사용한다. */
export async function requestLogin(email: string, password: string): Promise<AuthResult> {
  return request<AuthResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/** 로그인 후 응답 토큰을 저장한다. */
export async function login(email: string, password: string): Promise<AuthResult> {
  const data = await requestLogin(email, password);
  setTokens(data.tokens.accessToken, data.tokens.refreshToken);
  return data;
}

// ─── Admin / Operators ──────────────────────────────

export async function getAdminHealth(): Promise<AdminHealth> {
  return request('/admin/health');
}

export async function listOperators(): Promise<{ operators: Operator[] }> {
  return request('/admin/operators');
}

export async function createOperator(input: {
  email: string; password: string; nickname: string; role: 'operator' | 'admin';
}): Promise<{ id: string; email: string; role: string; status: string }> {
  return request('/admin/operators', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateOperatorRole(
  id: string,
  role: 'operator' | 'admin',
  reason: string,
): Promise<{ id: string; role: string }> {
  return request(`/admin/operators/${id}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role, reason }),
  });
}

// ─── Users ──────────────────────────────────────────

export async function listUsers(params: {
  limit?: number; offset?: number; search?: string; status?: string;
}): Promise<{ users: User[] } & PaginatedResponse<User>> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  return request(`/admin/users?${q}`);
}

export async function getUserDetail(id: string): Promise<UserDetail> {
  return request(`/admin/users/${id}`);
}

export async function getUserWalletLedger(id: string): Promise<{ ledger: WalletLedgerEntry[] }> {
  return request(`/admin/users/${id}/wallet-ledger`);
}

export async function getUserItemLedger(id: string): Promise<{ items: ItemLedgerEntry[] }> {
  return request(`/admin/users/${id}/item-ledger`);
}

export async function getUserBattles(id: string): Promise<{ battles: Battle[] }> {
  return request(`/admin/users/${id}/battles`);
}

// ─── Sanctions ──────────────────────────────────────

export async function getUserSanctions(id: string): Promise<{ sanctions: Sanction[] }> {
  return request(`/admin/users/${id}/sanctions`);
}

export async function suspendUser(id: string, reason: string): Promise<{ status: string }> {
  return request(`/admin/users/${id}/suspend`, {
    method: 'PUT',
    body: JSON.stringify({ reason }),
  });
}

export async function unsuspendUser(id: string, reason: string): Promise<{ status: string }> {
  return request(`/admin/users/${id}/unsuspend`, {
    method: 'PUT',
    body: JSON.stringify({ reason }),
  });
}

export async function createSanction(
  userId: string,
  type: string,
  reasonText: string,
  expiresAt?: string,
): Promise<{ id: string; type: string; status: string }> {
  return request(`/admin/users/${userId}/sanctions`, {
    method: 'POST',
    body: JSON.stringify({ type, reasonText, expiresAt }),
  });
}

export async function revokeSanction(
  userId: string,
  sanctionId: string,
  reason: string,
): Promise<{ status: string }> {
  return request(`/admin/users/${userId}/sanctions/${sanctionId}/revoke`, {
    method: 'PUT',
    body: JSON.stringify({ reason }),
  });
}

// ─── Grants ────────────────────────────────────────

export async function createGrant(
  userId: string,
  resourceType: string,
  resourceCode: string,
  amount: number,
  reasonText: string,
): Promise<{ status: string; grantType: string; resourceCode: string; amount: number; grantId: string }> {
  return request(`/admin/users/${userId}/grants`, {
    method: 'POST',
    body: JSON.stringify({ resourceType, resourceCode, amount, reasonText }),
  });
}

export async function listGrants(params: {
  limit?: number; offset?: number; userId?: string;
}): Promise<{ grants: Grant[] } & PaginatedResponse<Grant>> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  if (params.userId) q.set('userId', params.userId);
  return request(`/admin/grants?${q}`);
}

// ─── Security Events ────────────────────────────────

export async function listSecurityEvents(params: {
  limit?: number; offset?: number; eventType?: string; severity?: string;
}): Promise<{ events: SecurityEvent[] } & PaginatedResponse<SecurityEvent>> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  if (params.eventType) q.set('eventType', params.eventType);
  if (params.severity) q.set('severity', params.severity);
  return request(`/admin/security-events?${q}`);
}

export async function reviewSecurityEvent(
  eventId: string,
  resolution: string,
  resolutionNote?: string,
): Promise<{ status: string }> {
  return request(`/admin/security-events/${eventId}/review`, {
    method: 'PUT',
    body: JSON.stringify({ resolution, resolutionNote }),
  });
}

// ─── Audit Logs ─────────────────────────────────────

export async function listAuditLogs(params: {
  limit?: number; offset?: number; action?: string; operator_id?: string;
}): Promise<{ logs: AuditLog[] } & PaginatedResponse<AuditLog>> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  if (params.action) q.set('action', params.action);
  if (params.operator_id) q.set('operator_id', params.operator_id);
  return request(`/admin/audit-logs?${q}`);
}


