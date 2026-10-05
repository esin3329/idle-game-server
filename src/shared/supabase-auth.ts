import { z } from 'zod';
import { getAuthRepo } from '../provider.js';
import { AppError } from './errors.js';
import type { TokenPair } from './auth-service.js';

const identitySchema = z.object({ id: z.string().uuid(), email: z.string().optional() });
const sessionSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1), user: identitySchema,
});
const errorSchema = z.object({ error_code: z.string().optional(), code: z.string().optional() });

export function usesSupabaseAuth(): boolean {
  return process.env.AUTH_PROVIDER === 'supabase';
}

// No retry: password grants and refresh rotation have side effects.
async function authRequest(path: string, body?: unknown, token?: string): Promise<unknown> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new AppError('Supabase Auth 설정이 필요합니다.', 503, 'AUTH_NOT_CONFIGURED');
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/auth/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof Error) throw new AppError('인증 서버에 연결할 수 없습니다.', 503, 'AUTH_UNAVAILABLE');
    throw error;
  }
  if (!response.ok) {
    if (response.status >= 500) throw new AppError('인증 서버를 사용할 수 없습니다.', 503, 'AUTH_UNAVAILABLE');
    if (response.status === 429) throw new AppError('인증 요청이 너무 많습니다.', 429, 'RATE_LIMITED');
    const parsed = errorSchema.safeParse(await response.json());
    const code = parsed.success ? parsed.data.error_code || parsed.data.code : undefined;
    if (code === 'user_already_exists' || code === 'email_exists') {
      throw new AppError('이미 사용 중인 이메일입니다.', 409, 'DUPLICATE_ACCOUNT');
    }
    if (code === 'email_not_confirmed') throw new AppError('이메일 인증이 필요합니다.', 403, 'EMAIL_CONFIRMATION_REQUIRED');
    throw new AppError('유효하지 않은 인증 정보입니다.', 401, 'INVALID_CREDENTIALS');
  }
  return response.status === 204 ? undefined : response.json();
}

function parseSession(value: unknown) {
  const result = sessionSchema.safeParse(value);
  if (!result.success) throw new AppError('인증 서버의 응답이 올바르지 않습니다.', 502, 'INVALID_AUTH_RESPONSE');
  return result.data;
}

export function sessionTokens(session: z.infer<typeof sessionSchema>): TokenPair {
  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}

export async function supabasePasswordLogin(email: string, password: string) {
  return parseSession(await authRequest('/token?grant_type=password', { email, password }));
}

export async function supabaseSignup(email: string, password: string) {
  const response = await authRequest('/signup', { email, password });
  if (!sessionSchema.safeParse(response).success && identitySchema.safeParse(response).success) {
    throw new AppError('이메일 인증 후 다시 가입 요청을 보내세요.', 403, 'EMAIL_CONFIRMATION_REQUIRED');
  }
  return parseSession(response);
}

export async function supabaseRefresh(refreshToken: string): Promise<TokenPair> {
  const session = parseSession(await authRequest('/token?grant_type=refresh_token', { refresh_token: refreshToken }));
  await activeGameUser(session.user.id);
  return sessionTokens(session);
}

export async function supabaseLogout(refreshToken: string): Promise<void> {
  const session = parseSession(await authRequest('/token?grant_type=refresh_token', { refresh_token: refreshToken }));
  await authRequest('/logout?scope=local', {}, session.access_token);
}

export async function activeGameUser(id: string) {
  const repo = await getAuthRepo();
  const user = await repo.findUserById(id);
  if (!user) throw new AppError('게임 계정 연결이 필요합니다.', 403, 'ACCOUNT_NOT_LINKED');
  if (user.status !== 'active') throw new AppError('비활성화된 계정입니다.', 403, 'ACCOUNT_DISABLED');
  if ((await repo.findActiveSanctions(id)).length) throw new AppError('제재된 계정입니다.', 403, 'ACCOUNT_SUSPENDED');
  return user;
}

export async function verifySupabaseAccess(token: string) {
  // Auth server verifies signature, expiry and identity; roles come from our DB.
  const result = identitySchema.safeParse(await authRequest('/user', undefined, token));
  if (!result.success) throw new AppError('유효하지 않은 토큰입니다.', 401, 'INVALID_TOKEN');
  return activeGameUser(result.data.id);
}
