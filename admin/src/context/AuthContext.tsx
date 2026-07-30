import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { loadTokens, clearTokens, setTokens, login as apiLogin, getAccessToken } from '../api';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const ok = loadTokens();
    if (ok) {
      // Verify token is still valid by making a lightweight request
      fetch('/api/admin/health', {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      })
        .then((r) => setIsAuthenticated(r.ok))
        .catch(() => { clearTokens(); setIsAuthenticated(false); });
    }
  }, []);

  const login = async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setIsAuthenticated(true);
  };

  const logout = () => {
    clearTokens();
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
