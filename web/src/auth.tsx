import { can, type Permission, type Role } from '@bannerfront/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  can(permission: Permission): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<{ user: User }>('GET', '/api/auth/me')
      .then((r) => setUser(r.user))
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User }>('POST', '/api/auth/login', { email, password });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, can: (p) => can(user?.role, p) }),
    [user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
