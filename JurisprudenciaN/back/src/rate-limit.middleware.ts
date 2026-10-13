import type { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };
type Limit = { name: string; maximum: number };
type Category = 'auth' | 'search' | 'matches' | 'download';

export class LocalApiRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly enabled: boolean;
  private readonly limits: Record<Category, Limit>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.windowMs = positiveInteger(env.API_RATE_LIMIT_WINDOW_MS, 60_000);
    this.enabled = env.API_RATE_LIMIT_ENABLED !== 'false';
    this.limits = {
      auth: { name: 'auth', maximum: positiveInteger(env.API_RATE_LIMIT_AUTH_MAX, 15) },
      search: { name: 'search', maximum: positiveInteger(env.API_RATE_LIMIT_SEARCH_MAX, 120) },
      matches: { name: 'matches', maximum: positiveInteger(env.API_RATE_LIMIT_MATCHES_MAX, 120) },
      download: { name: 'download', maximum: positiveInteger(env.API_RATE_LIMIT_DOWNLOAD_MAX, 120) },
    };
  }

  middleware() {
    return (request: Request, response: Response, next: NextFunction) => {
      if (!this.enabled) return next();
      const limit = classifyRequest(request);
      if (!limit) return next();
      const now = Date.now();
      const key = `${request.ip ?? request.socket.remoteAddress ?? 'unknown'}:${limit}`;
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + this.windowMs };
        this.buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count <= this.limits[limit].maximum) return next();
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader('Retry-After', String(retryAfterSeconds));
      response.status(429).json({ statusCode: 429, code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Esperá antes de reintentar.' });
      if (this.buckets.size > 10_000) this.prune(now);
    };
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    if (this.buckets.size > 10_000) {
      const first = this.buckets.keys().next().value as string | undefined;
      if (first) this.buckets.delete(first);
    }
  }
}

function classifyRequest(request: Request): Category | null {
  const path = request.path;
  if (request.method === 'POST' && path === '/api/auth/login') return 'auth';
  if (request.method === 'GET' && (path === '/api/busqueda/avanzada' || path === '/api/busqueda/simple' || path === '/api/busqueda/publica')) return 'search';
  if (request.method === 'GET' && /^\/api\/(?:public\/)?corpus\/documents\/[^/]+\/matches$/u.test(path)) return 'matches';
  if (request.method === 'GET' && (/^\/api\/(?:public\/)?corpus\/documents\/[^/]+\/file$/u.test(path) || /^\/api\/(?:public\/)?sentencias\/[^/]+\/pdf$/u.test(path))) return 'download';
  return null;
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
