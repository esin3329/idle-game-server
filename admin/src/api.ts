import type {
  User, UserDetail, WalletLedgerEntry, ItemLedgerEntry,
  Sanction, Grant, SecurityEvent, AuditLog, Battle,
  AuthResult, PaginatedResponse,
} from './types';

const BASE_URL = '/api';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string) {
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
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Idempotency-Key for mutation requests
  let idempotencyHeader = '';
  if (options.method && options.method !== 'GET') {
    idempotencyHeader = `${options.method.toLowerCase()}-${crypto.randomUUID()}`;
    headers['Idempotency-Key'] = idempotencyHeader;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    // Try token refresh
    if (refreshToken) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${accessToken}`;
        const retryRes = await fetch(`${BASE_URL}${path}`, { ...options, headers });
        if (!retryRes.ok) {
          const err = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
          throw new ApiError(err.error || '요청 실패', retryRes.status, err.code);
        }
        return retryRes.json();
      }
    }
    clearTokens();
    throw new ApiError('인증이 필요합니다.', 401, 'UNAUTHORIZED');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(err.error || '요청 실패', res.status, err.code);
  }

  return res.json();
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data: { accessToken: string; refreshToken: string } = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Auth ───────────────────────────────────────────

export async function login(email: string, password: string): Promise<AuthResult> {
  const data = await request<AuthResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setTokens(data.accessToken, data.refreshToken);
  return data;
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
