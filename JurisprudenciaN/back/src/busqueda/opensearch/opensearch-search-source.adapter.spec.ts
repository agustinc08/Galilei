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

  it('uses a stable scan order before applying the product locale comparator', async () => {
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
      sort: { field: 'sala', order: 'asc' },
    });

    expect(requests[0]?.body?.sort).toEqual([
      { logicalNumericId: { order: 'desc', missing: '_last' } },
      { id: { order: 'desc' } },
    ]);
  });

  it('locale-sorts the complete hit set before selecting the requested page', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        body: {
          took: 3,
          hits: {
            total: { value: 3, relation: 'eq' },
            hits: [
              {
                _id: 'JURISPRUDENCIA:SENTENCIA:3',
                _score: 1,
                sort: [3, 'JURISPRUDENCIA:SENTENCIA:3'],
                _source: {
                  logicalNumericId: 3,
                  sortFields: { sala: 'Sala B' },
                },
              },
              {
                _id: 'JURISPRUDENCIA:SENTENCIA:2',
                _score: 1,
                sort: [2, 'JURISPRUDENCIA:SENTENCIA:2'],
                _source: { logicalNumericId: 2, sortFields: { sala: null } },
              },
              {
                _id: 'JURISPRUDENCIA:SENTENCIA:1',
                _score: 1,
                sort: [1, 'JURISPRUDENCIA:SENTENCIA:1'],
                _source: {
                  logicalNumericId: 1,
                  sortFields: { sala: 'Sala A' },
                },
              },
            ],
          },
        },
      }),
    } as unknown as Client;
    const hydrated = jest.fn<
      Promise<SearchResultPage>,
      Parameters<SearchCandidateHydrator>
    >((_query, _context, ids) =>
      Promise.resolve({
        total: ids.length,
        page: 1,
        pageSize: ids.length,
        results: ids.map((id) => sentenciaHit(id.replace('SENTENCIA:', ''))),
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
      visibility: 'INTERNAL',
      publicationPolicy: 'legacy-active-only',
      sort: { field: 'sala', order: 'asc' },
    });

    expect(result.total).toBe(3);
    expect(result.results.map((row) => row.sourceId)).toEqual(['2', '1']);
    expect(hydrated.mock.calls[0]?.[2]).toEqual(['SENTENCIA:2', 'SENTENCIA:1']);
    expect(adapter.getLastSearchProfile()?.stageTimings).toMatchObject({
      localeSearchScannedHits: 3,
      localeSearchDistinctHits: 3,
    });
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
