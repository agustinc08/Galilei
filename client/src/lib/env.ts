const rawApiUrl = import.meta.env.VITE_API_URL?.trim() || '/api';

if (rawApiUrl.startsWith('/')) {
  if (rawApiUrl.replace(/\/+$/u, '') !== '/api') {
    throw new Error('VITE_API_URL debe ser /api o una URL absoluta con el path /api.');
  }
} else {
  const parsedApiUrl = new URL(rawApiUrl);
  if (
    !['http:', 'https:'].includes(parsedApiUrl.protocol) ||
    parsedApiUrl.username ||
    parsedApiUrl.password ||
    parsedApiUrl.pathname.replace(/\/+$/u, '') !== '/api' ||
    parsedApiUrl.search ||
    parsedApiUrl.hash
  ) {
    throw new Error('VITE_API_URL debe ser una URL HTTP(S) sin credenciales y con el path /api.');
  }
}

export const API_BASE_URL = rawApiUrl.replace(/\/+$/u, '');
export const API_ORIGIN = API_BASE_URL.startsWith('/') ? '' : new URL(API_BASE_URL).origin;

export function buildApiUrl(path: string, query?: Record<string, string | number | boolean | undefined | null>) {
  const normalizedPath = path.replace(/^\/+/, '');
  const url = new URL(`${API_BASE_URL}/${normalizedPath}`, window.location.origin);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}
