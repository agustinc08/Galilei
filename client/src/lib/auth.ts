import type { AuthUser } from '@/types/auth';

const TOKEN_KEY = 'jurisprudencia_token';
const USER_KEY = 'jurisprudencia_user';
const AUTH_NOTICE_KEY = 'jurisprudencia_auth_notice';
const LEGACY_AUTH_KEYS = [
  'token',
  'accessToken',
  'auth_token',
  'jurisprudenciaToken',
];

export function getToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === 'undefined') {
    return;
  }

  clearLegacyAuthKeys();
  localStorage.setItem(TOKEN_KEY, token);
}

export function getCurrentUser() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function setCurrentUser(user: AuthUser) {
  if (typeof window === 'undefined') {
    return;
  }

  clearLegacyAuthKeys();
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearLegacyAuthKeys();
}

function clearLegacyAuthKeys() {
  for (const key of LEGACY_AUTH_KEYS) {
    localStorage.removeItem(key);
  }
}

export function setAuthNotice(message: string) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(AUTH_NOTICE_KEY, message);
}

export function consumeAuthNotice() {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = localStorage.getItem(AUTH_NOTICE_KEY);
  if (!value) {
    return null;
  }

  localStorage.removeItem(AUTH_NOTICE_KEY);
  return value;
}
