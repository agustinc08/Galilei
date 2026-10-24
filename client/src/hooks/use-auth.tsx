'use client';

import { usePathname, useRouter } from '@/lib/router-compat';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, ApiError } from '@/lib/api';
import {
  consumeAuthNotice,
  clearAuth,
  getCurrentUser,
  getToken,
  setCurrentUser,
  setAuthNotice,
  setToken,
} from '@/lib/auth';
import type {
  AuthUser,
  ChangePasswordPayload,
  LoginPayload,
  LoginResponse,
} from '@/types/auth';
import type { ApiResponse } from '@/types/common';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authNotice: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<AuthUser | null>;
  refreshUser: () => Promise<AuthUser | null>;
  changeContraseña: (payload: ChangePasswordPayload) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authNotice, setAuthNoticeState] = useState<string | null>(null);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
    setTokenState(null);
    setAuthNoticeState(null);
    router.replace('/login');
  }, [router]);

  const refreshUser = useCallback(async () => {
    const storedToken = getToken();
    const storedUser = getCurrentUser();

    if (!storedToken || !storedUser) {
      clearAuth();
      setUser(null);
      setTokenState(null);
      return null;
    }

    setUser(storedUser);
    setTokenState(storedToken);

    try {
      const currentUser = await api.get<AuthUser>('/auth/me');
      setCurrentUser(currentUser);
      setUser(currentUser);
      setTokenState(storedToken);
      return currentUser;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuth();
      }
      setUser(null);
      setTokenState(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        setAuthNoticeState(consumeAuthNotice());
        await refreshUser();
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [refreshUser]);

  useEffect(() => {
    const handler = () => {
      const notice = consumeAuthNotice();
      clearAuth();
      setUser(null);
      setTokenState(null);
      setAuthNoticeState(notice ?? 'Sesión expirada. Iniciá sesión nuevamente.');
      if (pathname !== '/login') {
        router.replace('/login');
      }
    };

    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, [pathname, router]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const isProtectedRoute =
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/sentencias') ||
      pathname.startsWith('/sumarios') ||
      pathname.startsWith('/archivos') ||
      pathname.startsWith('/estadisticas') ||
      pathname.startsWith('/favoritos') ||
      pathname.startsWith('/busquedas-guardadas') ||
      pathname.startsWith('/busqueda-avanzada') ||
      pathname.startsWith('/busqueda') ||
      pathname.startsWith('/jurisprudencia') ||
      pathname.startsWith('/galilei') ||
      pathname.startsWith('/perfil') ||
      pathname.startsWith('/institutos-juridicos') ||
      pathname.startsWith('/normas') ||
      pathname.startsWith('/admin');
    const isNewProtectedRoute =
      pathname.startsWith('/digesto') ||
      pathname.startsWith('/documentos') ||
      pathname.startsWith('/revision') ||
      pathname.startsWith('/spaces') ||
      pathname.startsWith('/personal');

    if (!user && (isProtectedRoute || isNewProtectedRoute)) {
      setAuthNotice('Debés iniciar sesión para continuar.');
      router.replace('/login');
      return;
    }

    if (user && pathname === '/login') {
      router.replace(landingForRole());
    }
  }, [isLoading, pathname, router, user]);

  const login = useCallback(
    async (payload: LoginPayload) => {
      const response = await api.post<LoginResponse>('/auth/login', payload, {
        skipAuth: true,
      });

      if (!response.accessToken || !response.user) {
        throw new ApiError('Respuesta de login invalida: falta accessToken o user.', 0);
      }

      setToken(response.accessToken);
      setCurrentUser(response.user);
      setUser(response.user);
      setTokenState(response.accessToken);
      setAuthNoticeState(null);
      setIsLoading(false);
      router.replace(landingForRole());
    },
    [router],
  );

  const changeContraseña = useCallback(
    async (payload: ChangePasswordPayload) => {
      await api.post<ApiResponse<{ message: string }>>(
        '/auth/change-password',
        payload,
      );
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user),
      isLoading,
      authNotice,
      login,
      logout,
      hydrate: refreshUser,
      refreshUser,
      changeContraseña,
    }),
    [authNotice, changeContraseña, isLoading, login, logout, refreshUser, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function landingForRole() {
  return '/galilei';
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }

  return context;
}
