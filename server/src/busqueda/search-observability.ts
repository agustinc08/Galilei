import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export type SearchOperation =
  | 'http.search'
  | 'federated.search'
  | 'source.jurisprudencia.search'
  | 'source.corpus.search'
  | 'opensearch.search'
  | 'postgres.hydrate'
  | 'workspace.acl';

export type SearchSource = 'JURISPRUDENCIA' | 'CORPUS';
export type SearchEventKind =
  'SEARCH_OPERATION' | 'SEARCH_SLOW_REQUEST' | 'SEARCH_HTTP_503';
export type SearchErrorCategory =
  'service_unavailable' | 'timeout' | 'connection_failure' | 'operation_failed';

export interface SearchObservationEvent {
  timestamp: string;
  event: SearchEventKind;
  requestId: string;
  operation: SearchOperation;
  source?: SearchSource;
  durationMs?: number;
  success?: boolean;
  status?: number;
  resultCount?: number;
  pageSize?: number;
  errorCategory?: SearchErrorCategory;
}

export interface SearchObservationWriter {
  write(event: SearchObservationEvent): void;
  flush?(): Promise<void>;
}

export interface SearchOperationOptions {
  source?: SearchSource;
  pageSize?: number;
}

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const searchRequestContext = new AsyncLocalStorage<{ requestId: string }>();

export function createSearchRequestId() {
  return randomUUID();
}

export function withSearchRequestContext<T>(
  requestId: string,
  callback: () => T,
): T {
  const safeRequestId = REQUEST_ID_PATTERN.test(requestId)
    ? requestId.toLowerCase()
    : createSearchRequestId();
  return searchRequestContext.run({ requestId: safeRequestId }, callback);
}

export function currentSearchRequestId() {
  return searchRequestContext.getStore()?.requestId;
}

export const SEARCH_LOG_ROTATION = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  retainedFiles: 5,
  maxQueuedEvents: 1000,
});

/** A single bounded JSONL channel. A full or unavailable disk never affects Search. */
export class RotatingSearchObservationWriter implements SearchObservationWriter {
  private readonly queue: string[] = [];
  private worker: Promise<void> | null = null;

  constructor(
    private readonly directory = defaultSearchLogDirectory(),
    private readonly maxBytes = SEARCH_LOG_ROTATION.maxBytes,
    private readonly retainedFiles = SEARCH_LOG_ROTATION.retainedFiles,
    private readonly maxQueuedEvents = SEARCH_LOG_ROTATION.maxQueuedEvents,
  ) {}

  write(event: SearchObservationEvent) {
    if (this.queue.length >= this.maxQueuedEvents) return;
    this.queue.push(`${JSON.stringify(event)}\n`);
    this.startWorker();
  }

  async flush() {
    while (this.worker || this.queue.length > 0) {
      this.startWorker();
      await this.worker;
    }
  }

  private startWorker() {
    if (this.worker || this.queue.length === 0) return;
    const current = this.drain();
    this.worker = current;
    void current.finally(() => {
      if (this.worker === current) this.worker = null;
      if (this.queue.length > 0) this.startWorker();
    });
  }

  private async drain() {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 100).join('');
      try {
        await this.appendBounded(batch);
      } catch {
        // Diagnostics are best-effort and must never change application behavior.
      }
    }
  }

  private async appendBounded(batch: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const active = path.join(this.directory, 'search-events.jsonl');
    let activeBytes = 0;
    try {
      activeBytes = (await stat(active)).size;
    } catch {
      // The active log does not exist yet.
    }
    if (activeBytes + Buffer.byteLength(batch, 'utf8') > this.maxBytes)
      await this.rotate(active);
    await appendFile(active, batch, { encoding: 'utf8', mode: 0o600 });
  }

  private async rotate(active: string) {
    const oldest = `${active}.${this.retainedFiles}`;
    await unlinkIfPresent(oldest);
    for (let index = this.retainedFiles - 1; index >= 1; index -= 1)
      await renameIfPresent(`${active}.${index}`, `${active}.${index + 1}`);
    await renameIfPresent(active, `${active}.1`);
  }
}

export class SearchObservability {
  constructor(
    private readonly writer: SearchObservationWriter = new RotatingSearchObservationWriter(),
    private readonly slowThresholdMs = configuredSlowSearchThresholdMs(),
  ) {}

  async measure<T>(
    operation: SearchOperation,
    run: () => Promise<T>,
    options: SearchOperationOptions = {},
  ): Promise<T> {
    if (!currentSearchRequestId())
      return withSearchRequestContext(createSearchRequestId(), () =>
        this.measure(operation, run, options),
      );

    const requestId = currentSearchRequestId()!;
    const startedAt = performance.now();
    let result: T | undefined;
    let error: unknown;
    let succeeded = false;
    try {
      result = await run();
      succeeded = true;
      return result;
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      const durationMs = safeDuration(performance.now() - startedAt);
      const status = errorStatus(error);
      const errorCategory = classifyError(error, status);
      const common = {
        requestId,
        operation,
        ...(options.source ? { source: options.source } : {}),
        durationMs,
        success: succeeded,
        ...(status ? { status } : {}),
        ...(succeeded ? safeResultCount(result) : {}),
        ...(safePageSize(options.pageSize) !== undefined
          ? { pageSize: safePageSize(options.pageSize) }
          : {}),
        ...(!succeeded ? { errorCategory } : {}),
      };
      this.emit('SEARCH_OPERATION', common);
      if (durationMs >= this.slowThresholdMs)
        this.emit('SEARCH_SLOW_REQUEST', common);
      if (status === 503)
        this.emit('SEARCH_HTTP_503', { ...common, status: 503 });
    }
  }

  recordHttpSearchCompletion(
    requestId: string,
    status: number,
    durationMs: number,
    pageSize?: number,
  ) {
    const safeStatus = safeHttpStatus(status);
    const common = {
      requestId,
      operation: 'http.search' as const,
      durationMs: safeDuration(durationMs),
      success: safeStatus < 400,
      status: safeStatus,
      ...(safePageSize(pageSize) !== undefined
        ? { pageSize: safePageSize(pageSize) }
        : {}),
      ...(safeStatus >= 500
        ? { errorCategory: 'operation_failed' as const }
        : {}),
    };
    this.emit('SEARCH_OPERATION', common);
    if (common.durationMs >= this.slowThresholdMs)
      this.emit('SEARCH_SLOW_REQUEST', common);
    if (safeStatus === 503)
      this.emit('SEARCH_HTTP_503', { ...common, status: 503 });
  }

  async flush() {
    await this.writer.flush?.();
  }

  private emit(
    event: SearchEventKind,
    fields: {
      requestId: string;
      operation: SearchOperation;
      source?: SearchSource;
      durationMs?: number;
      success?: boolean;
      status?: number;
      resultCount?: number;
      pageSize?: number;
      errorCategory?: SearchErrorCategory;
    },
  ) {
    const requestId = REQUEST_ID_PATTERN.test(fields.requestId)
      ? fields.requestId.toLowerCase()
      : createSearchRequestId();
    const safe: SearchObservationEvent = {
      timestamp: new Date().toISOString(),
      event,
      requestId,
      operation: fields.operation,
      ...(fields.source ? { source: fields.source } : {}),
      ...(fields.durationMs !== undefined
        ? { durationMs: safeDuration(fields.durationMs) }
        : {}),
      ...(fields.success !== undefined ? { success: fields.success } : {}),
      ...(fields.status !== undefined
        ? { status: safeHttpStatus(fields.status) }
        : {}),
      ...(fields.resultCount !== undefined
        ? { resultCount: safeCount(fields.resultCount) }
        : {}),
      ...(fields.pageSize !== undefined
        ? { pageSize: safePageSize(fields.pageSize) }
        : {}),
      ...(fields.errorCategory ? { errorCategory: fields.errorCategory } : {}),
    };
    try {
      this.writer.write(safe);
    } catch {
      // A broken diagnostic sink must not change Search behavior.
    }
  }
}

export const searchObservability = new SearchObservability();

export function safeBuildIdentity(env: NodeJS.ProcessEnv = process.env) {
  const sourceCommit = env.SOURCE_COMMIT ?? env.GITHUB_SHA ?? 'unknown';
  const buildTimestamp = env.BUILD_TIMESTAMP ?? env.BUILD_TIME ?? 'unknown';
  return {
    sourceCommit: /^[0-9a-f]{7,40}$/iu.test(sourceCommit)
      ? sourceCommit.toLowerCase()
      : 'unknown',
    buildTimestamp:
      buildTimestamp !== 'unknown' &&
      Number.isFinite(Date.parse(buildTimestamp))
        ? new Date(buildTimestamp).toISOString()
        : 'unknown',
  };
}

export function isSearchRoute(routePath: unknown, baseUrl: unknown = '') {
  if (typeof routePath !== 'string' || typeof baseUrl !== 'string')
    return false;
  const candidates = [routePath, `${baseUrl}${routePath}`];
  const allowlist = new Set([
    'busqueda/avanzada',
    'busqueda/simple',
    'busqueda/cita',
    'busqueda/avanzada/exportar',
    'public/busqueda',
  ]);
  return candidates.some((candidate) => {
    const normalized = candidate
      .replace(/^\/?api(?=\/)/u, '')
      .replace(/^\/+|\/+$/gu, '');
    return allowlist.has(normalized);
  });
}

function defaultSearchLogDirectory() {
  const configured = process.env.SEARCH_OBSERVABILITY_LOG_DIR?.trim();
  return configured || path.join(process.cwd(), 'logs', 'search-observability');
}

function configuredSlowSearchThresholdMs() {
  const configured = Number(process.env.BJC_SLOW_SEARCH_MS ?? 1500);
  return Number.isFinite(configured) &&
    configured >= 100 &&
    configured <= 60_000
    ? configured
    : 1500;
}

function safeDuration(value: number) {
  return Number.isFinite(value)
    ? Math.max(0, Math.round(value * 100) / 100)
    : 0;
}

function safeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safePageSize(value?: number) {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(0, Math.min(value, 500))
    : undefined;
}

function safeHttpStatus(value: number) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 500;
}

function safeResultCount<T>(value: T) {
  if (!value || typeof value !== 'object' || !('results' in value)) return {};
  const results = (value as { results?: unknown }).results;
  return Array.isArray(results) ? { resultCount: results.length } : {};
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object' || !('getStatus' in error))
    return undefined;
  try {
    const status = (error as { getStatus: () => unknown }).getStatus();
    return typeof status === 'number' ? safeHttpStatus(status) : undefined;
  } catch {
    return undefined;
  }
}

function classifyError(
  error: unknown,
  status: number | undefined,
): SearchErrorCategory {
  if (status === 503) return 'service_unavailable';
  if (!error || typeof error !== 'object') return 'operation_failed';
  const name = 'name' in error ? (error as { name?: unknown }).name : undefined;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const message =
    'message' in error ? (error as { message?: unknown }).message : undefined;
  if (message === 'search source timeout') return 'timeout';
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (
    code === '57014'
  )
    return 'timeout';
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND'
  )
    return 'connection_failure';
  return 'operation_failed';
}

async function unlinkIfPresent(file: string) {
  try {
    await unlink(file);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function renameIfPresent(from: string, to: string) {
  try {
    await rename(from, to);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function isMissing(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT',
  );
}
