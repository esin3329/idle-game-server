import type { AdminHealth, AuthResult } from '../types';

export interface LoginFlowDeps {
  /** 이 로그인 시도가 아직 최신 세대인지(그 사이 logout/다른 login이 없었는지). */
  isCurrent: () => boolean;
  requestLogin: () => Promise<AuthResult>;
  setTokens: (access: string, refresh: string) => void;
  fetchHealth: () => Promise<AdminHealth>;
  onSuccess: (health: AdminHealth) => void;
  /** 토큰 제거, 캐시/상태 초기화. 최신 세대일 때만 호출된다. */
  onFailure: () => void;
}

/**
 * 로그인 응답 → 토큰 저장 → health 조회 흐름. 어느 단계에서든 세대가 바뀌었다면
 * (오래된 login 응답이 logout/후속 login 뒤에 도착) 전역 토큰과 상태를 건드리지 않고 조용히 끝난다.
 */
export async function runLoginFlow(deps: LoginFlowDeps): Promise<void> {
  const result = await deps.requestLogin();
  if (!deps.isCurrent()) return;

  deps.setTokens(result.tokens.accessToken, result.tokens.refreshToken);
  let health: AdminHealth;
  try {
    health = await deps.fetchHealth();
  } catch (err) {
    if (deps.isCurrent()) deps.onFailure();
    throw err;
  }
  if (!deps.isCurrent()) return;
  deps.onSuccess(health);
}
