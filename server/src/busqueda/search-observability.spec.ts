import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createSearchRequestId,
  RotatingSearchObservationWriter,
  SEARCH_LOG_ROTATION,
  SearchObservability,
  isSearchRoute,
  safeBuildIdentity,
  withSearchRequestContext,
  type SearchObservationEvent,
} from './search-observability';

describe('Search observability', () => {
  it('correlates nested operations and emits a slow event with bounded fields', async () => {
    const events: SearchObservationEvent[] = [];
    const observability = new SearchObservability(
      { write: (event) => events.push(event) },
      1,
    );
    const requestId = createSearchRequestId();

    const result = await withSearchRequestContext(requestId, async () => {
      const nested = await observability.measure(
        'opensearch.search',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { total: 42, hits: [] };
        },
        { source: 'JURISPRUDENCIA', pageSize: 10 },
      );
      return observability.measure(
        'federated.search',
        () => Promise.resolve({ results: [nested] }),
        { pageSize: 10 },
      );
    });

    expect(result.results).toHaveLength(1);
    expect(
      events
        .filter((event) => event.event === 'SEARCH_OPERATION')
        .map((event) => event.operation),
    ).toEqual(['opensearch.search', 'federated.search']);
    expect(events.every((event) => event.requestId === requestId)).toBe(true);
    expect(events.some((event) => event.event === 'SEARCH_SLOW_REQUEST')).toBe(
      true,
    );
    expect(
      events.find((event) => event.operation === 'federated.search'),
    ).toMatchObject({ resultCount: 1, pageSize: 10, success: true });
    expect(Object.keys(events[0]).sort()).toEqual(
      [
        'durationMs',
        'event',
        'operation',
        'pageSize',
        'requestId',
        'source',
        'success',
        'timestamp',
      ].sort(),
    );
  });

  it('rethrows the exact 503 error and never serializes sensitive values', async () => {
    const events: SearchObservationEvent[] = [];
    const observability = new SearchObservability({
      write: (event) => events.push(event),
    });
    const requestId = createSearchRequestId();
    const sensitive = [
      'responsabilidad civil "daño moral"',
      'eyJhbGciOiJIUzI1NiJ9.secret.signature',
      'password=qa-only-secret',
      'abogada@example.test',
      'documento judicial texto privado',
      'OCR TEXTO CONFIDENCIAL',
    ];
    const failure = Object.assign(new Error(sensitive.join(' ')), {
      getStatus: () => 503,
    });

    const thrown = await withSearchRequestContext(requestId, async () => {
      try {
        await observability.measure(
          'federated.search',
          () => Promise.reject(failure),
          { pageSize: 20 },
        );
      } catch (error) {
        return error;
      }
      return undefined;
    });

    expect(thrown).toBe(failure);
    expect(events.some((event) => event.event === 'SEARCH_HTTP_503')).toBe(
      true,
    );
    const serialized = JSON.stringify(events);
    for (const value of sensitive) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain('secret.signature');
    expect(events[0]).toMatchObject({
      requestId,
      operation: 'federated.search',
      status: 503,
      errorCategory: 'service_unavailable',
      success: false,
    });
    expect(Object.keys(events[0]).sort()).toEqual(
      [
        'durationMs',
        'errorCategory',
        'event',
        'operation',
        'pageSize',
        'requestId',
        'status',
        'success',
        'timestamp',
      ].sort(),
    );
  });

  it('records the final HTTP 503 independently with generated request correlation', () => {
    const events: SearchObservationEvent[] = [];
    const observability = new SearchObservability({
      write: (event) => events.push(event),
    });
    const requestId = createSearchRequestId();

    observability.recordHttpSearchCompletion(requestId, 503, 1550, 20);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      event: 'SEARCH_OPERATION',
      operation: 'http.search',
      requestId,
      status: 503,
      pageSize: 20,
    });
    expect(events[1]).toMatchObject({
      event: 'SEARCH_SLOW_REQUEST',
      operation: 'http.search',
      requestId,
      status: 503,
    });
    expect(events[2]).toMatchObject({
      event: 'SEARCH_HTTP_503',
      operation: 'http.search',
      requestId,
    });
  });

  it('classifies the existing federation deadline without logging its message', async () => {
    const events: SearchObservationEvent[] = [];
    const observability = new SearchObservability({
      write: (event) => events.push(event),
    });
    const requestId = createSearchRequestId();

    await withSearchRequestContext(requestId, async () => {
      await expect(
        observability.measure('source.corpus.search', () =>
          Promise.reject(new Error('search source timeout')),
        ),
      ).rejects.toThrow('search source timeout');
    });

    expect(events[0]).toMatchObject({
      operation: 'source.corpus.search',
      errorCategory: 'timeout',
      success: false,
    });
    expect(JSON.stringify(events)).not.toContain('search source timeout');
  });

  it('classifies PostgreSQL statement cancellation as a timeout without logging SQL details', async () => {
    const events: SearchObservationEvent[] = [];
    const observability = new SearchObservability({
      write: (event) => events.push(event),
    });
    const requestId = createSearchRequestId();
    const failure = Object.assign(
      new Error('canceling statement due to statement timeout'),
      {
        code: '57014',
      },
    );

    await withSearchRequestContext(requestId, async () => {
      await expect(
        observability.measure('postgres.hydrate', () =>
          Promise.reject(failure),
        ),
      ).rejects.toThrow('canceling statement due to statement timeout');
    });

    expect(events[0]).toMatchObject({
      operation: 'postgres.hydrate',
      errorCategory: 'timeout',
      success: false,
    });
    expect(JSON.stringify(events)).not.toContain('canceling statement');
  });

  it('keeps JSONL rotation bounded and retains only the configured history', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bjc-search-log-'));
    const writer = new RotatingSearchObservationWriter(directory, 320, 2, 20);
    try {
      for (let index = 0; index < 12; index += 1) {
        writer.write({
          timestamp: new Date(index).toISOString(),
          event: 'SEARCH_OPERATION',
          requestId: createSearchRequestId(),
          operation: 'source.corpus.search',
          source: 'CORPUS',
          durationMs: index,
          success: true,
        });
        await writer.flush();
      }
      const files = (await readdir(directory)).sort();
      expect(files).toEqual([
        'search-events.jsonl',
        'search-events.jsonl.1',
        'search-events.jsonl.2',
      ]);
      for (const file of files)
        expect(
          (await stat(path.join(directory, file))).size,
        ).toBeLessThanOrEqual(320);
      const retained = await Promise.all(
        files.map((file) => readFile(path.join(directory, file), 'utf8')),
      );
      expect(retained.join('')).toContain('SEARCH_OPERATION');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the request lookup output allowlisted even if a log line has extra fields', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'bjc-search-lookup-'),
    );
    const requestId = createSearchRequestId();
    try {
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(
          path.join(directory, 'search-events.jsonl'),
          `${JSON.stringify({
            timestamp: '2026-10-27T00:00:00.000Z',
            event: 'SEARCH_HTTP_503',
            requestId,
            operation: 'http.search',
            status: 503,
            authorization: 'never-print-this-token',
            query: 'private legal phrase',
          })}\n`,
        ),
      );
      const script = path.resolve(
        process.cwd(),
        'scripts/search-observability-lookup.cjs',
      );
      const result = spawnSync(process.execPath, [script, requestId], {
        encoding: 'utf8',
        env: { ...process.env, SEARCH_OBSERVABILITY_LOG_DIR: directory },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('SEARCH_HTTP_503');
      expect(result.stdout).not.toContain('never-print-this-token');
      expect(result.stdout).not.toContain('private legal phrase');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('pins the documented production rotation policy', () => {
    expect(SEARCH_LOG_ROTATION).toEqual({
      maxBytes: 5 * 1024 * 1024,
      retainedFiles: 5,
      maxQueuedEvents: 1000,
    });
  });

  it('preserves successful values when the best-effort writer fails', async () => {
    const observability = new SearchObservability({
      write: () => {
        throw new Error('writer failure');
      },
    });
    const value = { results: [{ id: 'SENTENCIA:1' }], total: 1 };

    await expect(
      observability.measure('federated.search', () => Promise.resolve(value)),
    ).resolves.toBe(value);
  });

  it('uses only static Search route names and safe build identity values', () => {
    expect(isSearchRoute('/api/busqueda/avanzada')).toBe(true);
    expect(isSearchRoute('/busqueda', '/api')).toBe(false);
    expect(isSearchRoute('/api/private/document/123')).toBe(false);
    expect(
      safeBuildIdentity({
        SOURCE_COMMIT: 'ABCDEF1234567',
        BUILD_TIMESTAMP: '2026-10-27T10:00:00.000Z',
        JWT: 'do-not-emit',
      }),
    ).toEqual({
      sourceCommit: 'abcdef1234567',
      buildTimestamp: '2026-10-27T10:00:00.000Z',
    });
  });
});
