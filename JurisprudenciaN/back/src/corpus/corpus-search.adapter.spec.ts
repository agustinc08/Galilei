import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { parseSearchQuery } from '../busqueda/utils/search-parser';

describe('CorpusSearchSourceAdapter Digesto filters', () => {
  it.each([
    { filter: 'digestoCollectionId', sql: 'DigestoCollectionMembership', value: 'collection-1' },
    { filter: 'digestoTopicId', sql: 'CorpusDocumentTopic', value: 'topic-1' },
    { filter: 'digestoTagId', sql: 'CorpusDocumentTag', value: 'tag-1' },
  ])('binds $filter as a parameterized Corpus predicate', async ({ filter, sql, value }) => {
    const adapter = new CorpusSearchSourceAdapter('postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev');
    const pool = (adapter as unknown as { pool: { query: (...args: unknown[]) => unknown; end: () => Promise<void> } }).pool;
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ isReady: true }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('responsabilidad'), {
        visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
        page: 1, pageSize: 10, filters: { [filter]: value },
      });
      const [candidateSql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(candidateSql).toContain(sql);
      expect(values).toContain(value);
      expect(candidateSql).not.toContain(value);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      await adapter.close();
    }
  });

  it('uses a bounded token EXISTS lookup for short terms instead of building every candidate ID', async () => {
    const adapter = new CorpusSearchSourceAdapter('postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev');
    const pool = (adapter as unknown as { pool: { query: (...args: unknown[]) => unknown; end: () => Promise<void> } }).pool;
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ isReady: true }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('de'), {
        visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 10,
      });
      const [sql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('EXISTS (SELECT 1 FROM "CorpusSearchToken" token');
      expect(sql).toContain('LIMIT ($4 + 1) OFFSET $5');
      expect(sql).not.toContain('SELECT DISTINCT token."documentId"');
      expect(values).toContain('%de%');
      expect(adapter.getLastSearchProfile()?.candidateStrategy).toBe('token-projection-short-window-v2');
    } finally {
      await adapter.close();
    }
  });
});

describe('CorpusSearchSourceAdapter generic full-text search', () => {
  it('uses the token projection and a bounded first-page candidate window', async () => {
    const adapter = new CorpusSearchSourceAdapter('postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev');
    const pool = (adapter as unknown as { pool: { query: (...args: unknown[]) => unknown; end: () => Promise<void> } }).pool;
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ isReady: true }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('responsabilidad'), {
        visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
        page: 1, pageSize: 10,
      });
      const [candidateSql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(candidateSql).toContain('"CorpusSearchToken" token');
      expect(candidateSql).toContain('token."token" ILIKE $2');
      expect(candidateSql.indexOf('"candidateWindow"')).toBeLessThan(candidateSql.indexOf('SELECT p."pageNumber"'));
      expect(candidateSql).toContain('FROM "pagedCandidates" selected');
      expect(values).toContain('%responsabilidad%');
      expect(candidateSql).toContain('LIMIT ($4 + 1) OFFSET $5');
      expect(candidateSql).toContain('"pageStats"');
      expect(candidateSql).not.toContain('count(*) OVER()');
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      await adapter.close();
    }
  });

  it('intersects phrase token candidates, then verifies the exact phrase before paging', async () => {
    const adapter = new CorpusSearchSourceAdapter('postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev');
    const pool = (adapter as unknown as { pool: { query: (...args: unknown[]) => unknown; end: () => Promise<void> } }).pool;
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ isReady: true }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: null, total: '12', candidateCount: '1000', totalExact: false, hasMore: true, candidateWindowSizes: [100, 200], exactHitsByWindow: [3, 12] }], rowCount: 1 } as never);
    try {
      await adapter.search(parseSearchQuery('"responsabilidad civil"'), {
        visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
        page: 1, pageSize: 10,
      });
      const [sql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('WITH RECURSIVE');
      expect(sql).toContain(' INTERSECT ');
      expect(sql).toContain('token."token" ILIKE');
      expect(sql).toContain('lower(token."token") LIKE');
      expect(sql).toContain('"phraseWindowScan"');
      expect(sql).toContain('candidateIds"[scan."examined" + 1:');
      expect(sql).toContain('AND d."searchText" ILIKE');
      expect(sql).toContain('"candidateWindowSizes"');
      expect(sql).toContain('FROM "corpusSearchCandidates" c JOIN "CorpusDocument" d');
      expect(sql.match(/"corpusSearchCandidates" AS MATERIALIZED/gu)).toHaveLength(1);
      expect(values).toContain('%responsabilidad');
      expect(values).toContain('civil%');
      expect(values).toContain('%responsabilidad civil%');
      expect(query).toHaveBeenCalledTimes(2);
      expect(adapter.getLastSearchProfile()?.candidateStrategy).toBe('token-projection-phrase-boundary-materialized-v5');
      expect(adapter.getLastSearchProfile()?.candidateGenerationCount).toBe(1);
      expect(adapter.getLastSearchProfile()?.candidateCount).toBe(1000);
      expect(adapter.getLastSearchProfile()?.windowExpansions).toBe(1);
      expect(adapter.getLastSearchProfile()?.windowSizes).toEqual([100, 200]);
      expect(adapter.getLastSearchProfile()?.exactHitsByWindow).toEqual([3, 12]);
    } finally {
      await adapter.close();
    }
  });

  it.each([
    { queryText: 'responsa%', expected: 'token."token" LIKE' },
    { queryText: '%bilidad', expected: 'reverse(token."token") LIKE' },
  ])('uses token projection for $queryText without scanning the full text for candidates', async ({ queryText, expected }) => {
    const adapter = new CorpusSearchSourceAdapter('postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev');
    const pool = (adapter as unknown as { pool: { query: (...args: unknown[]) => unknown; end: () => Promise<void> } }).pool;
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ isReady: true }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery(queryText), {
        visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 10,
      });
      const [sql] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain(expected);
      expect(sql).toContain('FROM "CorpusSearchToken" token');
      expect(sql).toContain('"candidateWindow"');
      expect(sql).not.toContain('WHERE d."searchText" ILIKE');
    } finally {
      await adapter.close();
    }
  });

  it('falls back to exact source text while the token projection is not ready', async () => {
    const adapter = new CorpusSearchSourceAdapter('postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev');
    const pool = (adapter as unknown as { pool: { query: (...args: unknown[]) => unknown; end: () => Promise<void> } }).pool;
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ isReady: false }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('responsabilidad'), {
        visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
        page: 1, pageSize: 10,
      });
      const [sql] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('d."searchText" ILIKE $2');
      expect(sql).not.toContain('FROM "CorpusSearchToken" token');
    } finally {
      await adapter.close();
    }
  });
});
