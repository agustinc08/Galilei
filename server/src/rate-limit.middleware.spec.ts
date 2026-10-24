import { LocalApiRateLimiter } from './rate-limit.middleware';

function invoke(
  limiter: LocalApiRateLimiter,
  path = '/api/busqueda/avanzada',
  method = 'GET',
) {
  const request = {
    path,
    method,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const state: {
    status?: number;
    headers: Record<string, string>;
    body?: unknown;
    next: boolean;
  } = { headers: {}, next: false };
  const response = {
    setHeader: (name: string, value: string) => {
      state.headers[name] = value;
    },
    status: (status: number) => {
      state.status = status;
      return response;
    },
    json: (body: unknown) => {
      state.body = body;
      return response;
    },
  };
  limiter.middleware()(
    request as never,
    response as never,
    (() => {
      state.next = true;
    }) as never,
  );
  return state;
}

describe('LocalApiRateLimiter', () => {
  it('limits by route category and returns Retry-After without exposing request data', () => {
    const limiter = new LocalApiRateLimiter({
      API_RATE_LIMIT_SEARCH_MAX: '1',
      API_RATE_LIMIT_AUTH_MAX: '1',
    });
    expect(invoke(limiter).next).toBe(true);
    const rejected = invoke(limiter);
    expect(rejected.status).toBe(429);
    expect(Number(rejected.headers['Retry-After'])).toBeGreaterThan(0);
    expect(rejected.body).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Demasiadas solicitudes. Esperá antes de reintentar.',
    });
    expect(invoke(limiter, '/api/auth/login', 'POST').next).toBe(true);
  });

  it('can be disabled through its configuration', () => {
    const limiter = new LocalApiRateLimiter({
      API_RATE_LIMIT_ENABLED: 'false',
      API_RATE_LIMIT_SEARCH_MAX: '1',
    });
    expect(invoke(limiter).next).toBe(true);
    expect(invoke(limiter).next).toBe(true);
  });
});
