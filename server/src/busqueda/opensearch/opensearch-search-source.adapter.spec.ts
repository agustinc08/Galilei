import type { Client } from '@opensearch-project/opensearch';
import type {
  SearchContext,
  SearchResult,
  SearchResultPage,
} from '../adapters/search-source.adapter';
import { parseSearchQuery } from '../utils/search-parser';
import {
  OpenSearchSearchSourceAdapter,
  searchSort,
  type SearchCandidateHydrator,
} from './opensearch-search-source.adapter';

const context: SearchContext = {
  visibility: 'PUBLIC',
  dialect: 'modern',
  publicationPolicy: 'published-active-only',
  page: 2,
  pageSize: 2,
};

function hit(id: string, score: number): SearchResult {
  return {
    id: `JURISPRUDENCIA:SUMARIO:${id}`,
    sourceSystem: 'JURISPRUDENCIA',
    sourceType: 'SUMARIO',
    sourceId: id,
    title: `Tema ${id}`,
    subtitle: null,
    date: null,
    snippet: null,
    matchedFields: ['texto'],
    score,
    metadata: { publicado: true, activo: true },
    visibility: 'PUBLIC',
    document: null,
  };
}

function sentenciaHit(id: string): SearchResult {
  return {
    ...hit(id, 0),
    id: `JURISPRUDENCIA:SENTENCIA:${id}`,
    sourceType: 'SENTENCIA',
    metadata: { sentenciaId: Number(id), publicado: true, activo: true },
  };
}

describe('OpenSearchSearchSourceAdapter', () => {
  it('uses exact engine totals, hydrates only page IDs, and restores engine hit order', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        body: {
          hits: {
            total: { value: 41, relation: 'eq' },
            hits: [
              { _id: 'JURISPRUDENCIA:SUMARIO:22', _score: 7 },
              { _id: 'JURISPRUDENCIA:SUMARIO:11', _score: 5 },
            ],
          },
        },
      }),
    } as unknown as Client;
    const hydrate = jest.fn<
      Promise<SearchResultPage>,
      Parameters<SearchCandidateHydrator>
    >(() =>
      Promise.resolve({
        total: 2,
        page: 1,
        pageSize: 2,
        results: [hit('11', 0), hit('22', 0)],
      }),
    );
    const adapter = new OpenSearchSearchSourceAdapter(
      client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      hydrate,
    );

    const result = await adapter.search(parseSearchQuery('civil'), context);

    expect(result.total).toBe(41);
    expect(result.totalExact).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.page).toBe(2);
    expect(result.results.map((item) => item.sourceId)).toEqual(['22', '11']);
    expect(result.results.map((item) => item.score)).toEqual([7, 5]);
    const [hydratedQuery, hydratedContext, hydratedIds] = hydrate.mock.calls[0];
    expect(hydratedQuery).toEqual(parseSearchQuery('civil'));
    expect(hydratedContext).toMatchObject({ page: 1, pageSize: 2 });
    expect(hydratedIds).toEqual(['22', '11']);
  });

  it('requests and returns public facets with the same query used for the result page', async () => {
    const search = jest.fn().mockResolvedValue({
      body: {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{ _id: 'JURISPRUDENCIA:SENTENCIA:7', _score: 1 }],
        },
        aggregations: {
          publicFacets: {
            salas: { buckets: [{ key: 'Sala H', doc_count: 1 }] },
            years: { buckets: [{ key_as_string: '2024', doc_count: 1 }] },
          },
        },
      },
    });
    const adapter = new OpenSearchSearchSourceAdapter(
      { search } as unknown as Client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      () => ({
        total: 1,
        page: 1,
        pageSize: 1,
        results: [sentenciaHit('7')],
      }),
    );

    const result = await adapter.search(parseSearchQuery('daño'), {
      ...context,
      page: 1,
      pageSize: 1,
      filters: { sala: 'Sala H' },
    });

    expect(result.facets).toEqual({
      salas: [{ value: 'Sala H', count: 1 }],
      years: [{ value: 2024, count: 1 }],
    });
    const calls = search.mock.calls as unknown as Array<
      [{ body?: { aggs?: unknown; query?: unknown } }]
    >;
    const requestBody = calls[0]?.[0]?.body;
    expect(requestBody?.aggs).toMatchObject({
      publicFacets: { filter: { match_all: {} } },
    });
    expect(requestBody?.query).toBeDefined();
  });

  it('chunks large PostgreSQL hydration pages and restores the full Search order', async () => {
    const ids = Array.from({ length: 205 }, (_, index) => String(index + 1));
    const search = jest.fn().mockResolvedValue({
      body: {
        hits: {
          total: { value: ids.length, relation: 'eq' },
          hits: ids.map((id) => ({
            _id: `JURISPRUDENCIA:SUMARIO:${id}`,
            _score: Number(id),
          })),
        },
      },
    });
    const hydrated = jest.fn<
      Promise<SearchResultPage>,
      Parameters<SearchCandidateHydrator>
    >((_query, _context, batchIds) =>
      Promise.resolve({
        total: batchIds.length,
        page: 1,
        pageSize: batchIds.length,
        results: [...batchIds].reverse().map((id) => hit(id, 0)),
      }),
    );
    const adapter = new OpenSearchSearchSourceAdapter(
      { search } as unknown as Client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      hydrated,
    );

    const result = await adapter.search(
      parseSearchQuery('"responsabilidad civil"'),
      {
        ...context,
        page: 1,
        pageSize: ids.length,
      },
    );

    expect(hydrated).toHaveBeenCalledTimes(3);
    expect(hydrated.mock.calls.map((call) => call[2].length)).toEqual([
      100, 100, 5,
    ]);
    expect(hydrated.mock.calls[0]?.[1]).toMatchObject({
      page: 1,
      pageSize: 100,
    });
    expect(result.total).toBe(ids.length);
    expect(result.results.map((item) => item.sourceId)).toEqual(ids);
    expect(result.results[0]?.score).toBe(1);
    expect(result.results.at(-1)?.score).toBe(205);
  });

  it.each([
    ['sala', 'asc', '_first'],
    ['sala', 'desc', '_last'],
    ['numeroSentencia', 'asc', '_first'],
    ['numeroSentencia', 'desc', '_last'],
  ] as const)(
    'uses one bounded OpenSearch request for %s/%s with missing=%s',
    async (field, order, missing) => {
      const requests: Array<{
        index?: string;
        body?: Record<string, unknown>;
      }> = [];
      const search = jest.fn(
        (request: { index?: string; body?: Record<string, unknown> }) => {
          requests.push(request);
          return Promise.resolve({
            body: { hits: { total: { value: 0, relation: 'eq' }, hits: [] } },
          });
        },
      );
      const adapter = new OpenSearchSearchSourceAdapter(
        { search } as unknown as Client,
        'galilei-search-active',
        'JURISPRUDENCIA',
        jest.fn(),
      );

      await adapter.search(parseSearchQuery('civil'), {
        ...context,
        page: 1,
        pageSize: 25,
        sort: { field, order },
      });

      expect(search).toHaveBeenCalledTimes(1);
      expect(requests[0]).toMatchObject({
        index: 'galilei-search-active',
        body: {
          from: 0,
          size: 25,
          track_total_hits: true,
          _source: false,
          sort: [
            { [`sortFields.${field}`]: { order, missing } },
            { logicalNumericId: { order: 'desc', missing: '_last' } },
            { id: { order: 'desc' } },
          ],
        },
      });
    },
  );

  it('keeps engine sort order when PostgreSQL hydration returns IDs in another order', async () => {
    const search = jest.fn().mockResolvedValue({
      body: {
        took: 3,
        hits: {
          total: { value: 3, relation: 'eq' },
          hits: [
            {
              _id: 'JURISPRUDENCIA:SENTENCIA:2',
              _score: 1,
              sort: [null, 2, 'JURISPRUDENCIA:SENTENCIA:2'],
            },
            {
              _id: 'JURISPRUDENCIA:SENTENCIA:1',
              _score: 1,
              sort: ['Sala A', 1, 'JURISPRUDENCIA:SENTENCIA:1'],
            },
          ],
        },
      },
    });
    const client = { search } as unknown as Client;
    const hydrated = jest.fn<
      Promise<SearchResultPage>,
      Parameters<SearchCandidateHydrator>
    >((_query, _context, ids) =>
      Promise.resolve({
        total: ids.length,
        page: 1,
        pageSize: ids.length,
        results: [sentenciaHit('1'), sentenciaHit('2')],
      }),
    );
    const adapter = new OpenSearchSearchSourceAdapter(
      client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      hydrated,
    );

    const result = await adapter.search(parseSearchQuery('civil'), {
      ...context,
      page: 1,
      pageSize: 2,
      sort: { field: 'sala', order: 'asc' },
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.results.map((row) => row.sourceId)).toEqual(['2', '1']);
    expect(hydrated.mock.calls[0]?.[2]).toEqual(['SENTENCIA:2', 'SENTENCIA:1']);
    expect(adapter.getLastSearchProfile()).toMatchObject({
      queryCount: 1,
      resultRows: 2,
      stageTimings: { openSearchTookMs: 3 },
    });
  });

  it('uses the OpenSearch page window for later pages', async () => {
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    const search = jest.fn((request: { body?: Record<string, unknown> }) => {
      requests.push(request);
      return Promise.resolve({
        body: { hits: { total: { value: 41, relation: 'eq' }, hits: [] } },
      });
    });
    const adapter = new OpenSearchSearchSourceAdapter(
      { search } as unknown as Client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      jest.fn(),
    );

    await adapter.search(parseSearchQuery('civil'), {
      ...context,
      page: 2,
      pageSize: 25,
      sort: { field: 'numeroSentencia', order: 'asc' },
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(requests[0]?.body).toMatchObject({ from: 25, size: 25 });
    expect(requests[0]?.body).not.toHaveProperty('search_after');
  });

  it('honors ascending relevance while keeping deterministic secondary keys', async () => {
    const requests: Array<{ body?: { sort?: unknown } }> = [];
    const search = jest.fn((request: { body?: { sort?: unknown } }) => {
      requests.push(request);
      return Promise.resolve({
        body: { hits: { total: { value: 0, relation: 'eq' }, hits: [] } },
      });
    });
    const adapter = new OpenSearchSearchSourceAdapter(
      { search } as unknown as Client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      jest.fn(),
    );

    await adapter.search(parseSearchQuery('civil'), {
      ...context,
      sort: { field: 'relevancia', order: 'asc' },
    });

    expect(requests[0]?.body?.sort).toEqual([
      { _score: { order: 'asc' } },
      {
        _script: {
          type: 'number',
          order: 'desc',
          script: {
            lang: 'painless',
            source:
              "doc['decisionDate'].size() == 0 ? 0L : doc['decisionDate'].value.toInstant().toEpochMilli()",
          },
        },
      },
      { logicalNumericId: { order: 'desc', missing: '_last' } },
      { id: { order: 'desc' } },
    ]);
  });

  it('maps nullable legacy date sorting to epoch zero for both directions', () => {
    const sort = (order: 'asc' | 'desc') => [
      {
        _script: {
          type: 'number',
          order,
          script: {
            lang: 'painless',
            source:
              "doc['decisionDate'].size() == 0 ? 0L : doc['decisionDate'].value.toInstant().toEpochMilli()",
          },
        },
      },
      { logicalNumericId: { order: 'desc', missing: '_last' } },
      { id: { order: 'desc' } },
    ];

    expect(
      searchSort(
        {
          ...context,
          sort: { field: 'fecha', order: 'asc' },
        },
        'JURISPRUDENCIA',
      ),
    ).toEqual(sort('asc'));
    expect(
      searchSort(
        {
          ...context,
          sort: { field: 'fecha', order: 'desc' },
        },
        'JURISPRUDENCIA',
      ),
    ).toEqual(sort('desc'));
  });

  it('fails closed when OpenSearch cannot promise an exact hit total', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        body: {
          hits: { total: { value: 10000, relation: 'gte' }, hits: [] },
        },
      }),
    } as unknown as Client;
    const hydrate = jest.fn<
      Promise<SearchResultPage>,
      Parameters<SearchCandidateHydrator>
    >();
    const adapter = new OpenSearchSearchSourceAdapter(
      client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      hydrate,
    );

    await expect(
      adapter.search(parseSearchQuery('civil'), context),
    ).rejects.toThrow('SEARCH_TOTAL_NOT_EXACT');
    expect(hydrate).not.toHaveBeenCalled();
  });

  it('hydrates a standalone Sentencia using its own stable logical ID', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        body: {
          hits: {
            total: { value: 1, relation: 'eq' },
            hits: [{ _id: 'JURISPRUDENCIA:SENTENCIA:8142', _score: 9 }],
          },
        },
      }),
    } as unknown as Client;
    const hydrate = jest.fn<
      Promise<SearchResultPage>,
      Parameters<SearchCandidateHydrator>
    >(() =>
      Promise.resolve({
        total: 1,
        page: 1,
        pageSize: 1,
        results: [sentenciaHit('8142')],
      }),
    );
    const adapter = new OpenSearchSearchSourceAdapter(
      client,
      'galilei-search-active',
      'JURISPRUDENCIA',
      hydrate,
    );

    const result = await adapter.search(parseSearchQuery('civil'), {
      ...context,
      documentKinds: ['SENTENCIA'],
    });

    expect(result.results.map((item) => item.id)).toEqual([
      'JURISPRUDENCIA:SENTENCIA:8142',
    ]);
    expect(result.results[0].score).toBe(9);
    expect(hydrate.mock.calls[0][2]).toEqual(['SENTENCIA:8142']);
  });

  it('does not query an engine source omitted by the authorized source list', async () => {
    const search = jest.fn();
    const client = { search } as unknown as Client;
    const hydrate = jest.fn();
    const adapter = new OpenSearchSearchSourceAdapter(
      client,
      'galilei-search-active',
      'CORPUS',
      hydrate,
    );

    const result = await adapter.search(parseSearchQuery('civil'), {
      ...context,
      sourceSystems: ['JURISPRUDENCIA'],
    });

    expect(result).toMatchObject({ total: 0, totalExact: true, results: [] });
    expect(search).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
  });
});
