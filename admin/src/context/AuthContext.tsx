import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadTokens, clearTokens, login as apiLogin, getAdminHealth } from '../api';
import type { AdminHealth } from '../types';

type AuthProviderName = NonNullable<AdminHealth['authProvider']>;

interface AuthContextType {
  isAuthenticated: boolean;
  role: string | null;
  isAdmin: boolean;
  userId: string | null;
  authProvider: AuthProviderName | null;
  /** 인증 상태가 전환될 때마다(로그인/로그아웃/인증 확인 결과) 1씩 증가한다. 쿼리 키 격리용. */
  sessionKey: number;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authProvider, setAuthProvider] = useState<AuthProviderName | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  // login/logout 호출마다 증가. 이전 세대의 비동기 결과가 현재 세션 상태를 덮어쓰지 못하게 한다.
  const authGenRef = useRef(0);

  const resetCache = () => {
    void queryClient.cancelQueries();
    queryClient.clear();
  };

  const applyHealth = (res: AdminHealth) => {
    setRole(res.role);
    setUserId(res.userId ?? null);
    setAuthProvider(res.authProvider ?? null);
    setIsAuthenticated(true);
    setSessionKey((k) => k + 1);
  };

  const applySignedOut = () => {
    setRole(null);
    setUserId(null);
    setAuthProvider(null);
    setIsAuthenticated(false);
    setSessionKey((k) => k + 1);
  };

  useEffect(() => {
    if (!loadTokens()) return;
    const gen = authGenRef.current;
    let cancelled = false;
    const isStale = () => cancelled || authGenRef.current !== gen;
    // request()가 401 시 refresh를 시도하고, 실패하면 토큰을 비운 뒤 ApiError를 던진다.
    getAdminHealth()
      .then((res) => {
        if (isStale()) return;
        applyHealth(res);
      })
      .catch(() => {
        if (isStale()) return;
        clearTokens();
        resetCache();
        applySignedOut();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    const gen = ++authGenRef.current;
    resetCache();
    await apiLogin(email, password);
    let res: AdminHealth;
    try {
      res = await getAdminHealth();
    } catch (err) {
      if (authGenRef.current === gen) {
        clearTokens();
        resetCache();
        applySignedOut();
      }
      throw err;
    }
    if (authGenRef.current !== gen) throw new Error('로그인이 다른 인증 작업으로 대체되었습니다.');
    resetCache();
    applyHealth(res);
  };

  const logout = () => {
    authGenRef.current++;
    clearTokens();
    resetCache();
    applySignedOut();
  };

  const isAdmin = role === 'admin' || role === 'administrator';

  return (
    <AuthContext.Provider value={{ isAuthenticated, role, isAdmin, userId, authProvider, sessionKey, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
