import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { loadTokens, clearTokens, login as apiLogin, getAdminHealth } from '../api';

interface AuthContextType {
  isAuthenticated: boolean;
  role: string | null;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!loadTokens()) return;
    let cancelled = false;
    // request()가 401 시 refresh를 시도하고, 실패하면 토큰을 비운 뒤 ApiError를 던진다.
    getAdminHealth()
      .then((res) => {
        if (cancelled) return;
        setRole(res.role);
        setIsAuthenticated(true);
      })
      .catch(() => {
        if (cancelled) return;
        clearTokens();
        setRole(null);
        setIsAuthenticated(false);
      });
    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string) => {
    await apiLogin(email, password);
    try {
      const res = await getAdminHealth();
      setRole(res.role);
      setIsAuthenticated(true);
    } catch (err) {
      clearTokens();
      setRole(null);
      setIsAuthenticated(false);
      throw err;
    }
  };

  const logout = () => {
    clearTokens();
    setRole(null);
    setIsAuthenticated(false);
  };

  const isAdmin = role === 'admin' || role === 'administrator';

  return (
    <AuthContext.Provider value={{ isAuthenticated, role, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
