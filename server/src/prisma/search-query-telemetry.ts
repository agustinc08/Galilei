import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export type SearchQueryEvent = { fingerprint: string; durationMs: number };
export type CapturedSearchQueryTemplate = {
  query: string;
  params: unknown;
  durationMs: number;
  fingerprint: string;
};

export const searchQueryTelemetry = new AsyncLocalStorage<SearchQueryEvent[]>();
const capturedSearchQueryTemplates: CapturedSearchQueryTemplate[] = [];

export function recordSearchQuery(
  query: string,
  durationMs: number,
  params?: string,
) {
  const events = searchQueryTelemetry.getStore();
  if (!events) return;
  const fingerprint = createHash('sha256')
    .update(query.replace(/\s+/gu, ' ').trim())
    .digest('hex')
    .slice(0, 16);
  events.push({ fingerprint, durationMs });
  if (
    process.env.BJC_SEARCH_EXPLAIN_CAPTURE === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    capturedSearchQueryTemplates.push({
      query,
      params,
      durationMs,
      fingerprint,
    });
    if (capturedSearchQueryTemplates.length > 32)
      capturedSearchQueryTemplates.shift();
  }
}

/** Volatile local diagnostic access; callers must persist only a sanitized plan. */
export function drainCapturedSearchQueryTemplates() {
  return capturedSearchQueryTemplates.splice(
    0,
    capturedSearchQueryTemplates.length,
  );
}
