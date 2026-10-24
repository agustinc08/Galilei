import { clearAuth, getToken, setAuthNotice } from './auth';
import { buildApiUrl } from './env';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = RequestInit & {
  query?: Record<string, string | number | boolean | undefined | null>;
  skipAuth?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = options.skipAuth ? null : getToken();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!isFormData && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;

  try {
    response = await fetch(buildApiUrl(path, options.query), {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(
      'No se pudo conectar con el backend. Verifica que el servidor este levantado.',
      0,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuth) {
      clearAuth();
      if (typeof window !== 'undefined') {
        setAuthNotice('Sesión expirada. Iniciá sesión nuevamente.');
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }

    const message =
      (payload &&
        typeof payload === 'object' &&
        'message' in payload &&
        typeof payload.message === 'string' &&
        payload.message) ||
      (payload &&
        typeof payload === 'object' &&
        'message' in payload &&
        Array.isArray(payload.message) &&
        payload.message[0]) ||
      (typeof payload === 'string' && payload) ||
      'Ocurrió un error inesperado';

    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

async function download(path: string, options: RequestOptions = {}) {
  const headers = new Headers(options.headers);
  const token = options.skipAuth ? null : getToken();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(buildApiUrl(path, options.query), {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(
      'No se pudo conectar con el backend. Verifica que el servidor este levantado.',
      0,
    );
  }

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuth) {
      clearAuth();
      if (typeof window !== 'undefined') {
        setAuthNotice('Sesión expirada. Iniciá sesión nuevamente.');
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }
    throw new ApiError('No se pudo descargar el archivo', response.status);
  }

  return response.blob();
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body:
        body instanceof FormData || typeof body === 'string'
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'PATCH',
      body:
        body instanceof FormData || typeof body === 'string'
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  download,
};
