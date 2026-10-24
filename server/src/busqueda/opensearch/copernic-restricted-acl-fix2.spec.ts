import type { Client } from '@opensearch-project/opensearch';
import type {
  SearchContext,
  SearchResult,
} from '../adapters/search-source.adapter';
import type { SearchCandidateHydrator } from './opensearch-search-source.adapter';
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../prisma/create-prisma-client.js', () => ({
  getPrismaPoolDiagnostics: jest.fn().mockReturnValue(null),
}));
const { parseSearchQuery } = await import('../utils/search-parser.js');
const { FederatedSearchService } =
  await import('../federated-search.service.js');
const { OpenSearchSearchSourceAdapter, searchSort } =
  await import('./opensearch-search-source.adapter.js');
const privateContext: SearchContext = {
  visibility: 'ADMIN',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
  sourceSystems: ['CORPUS'],
  page: 26,
  pageSize: 20,
  documentScope: {
    kind: 'WORKSPACE',
    workspaceId: 'workspace-fix2-synthetic',
    userId: 424242,
  },
};

function corpusHit(id: string): SearchResult {
  return {
    id: `CORPUS:DOCUMENTO:${id}`,
    sourceSystem: 'CORPUS',
    sourceType: 'DOCUMENTO',
    sourceId: id,
    title: id,
    subtitle: null,
    date: null,
    snippet: null,
    matchedFields: ['text'],
    score: 1,
    metadata: {},
    visibility: 'ADMIN',
    document: null,
  };
}

function hits(ids: string[], score = 1) {
  return ids.map((id) => ({
    _id: id,
    _score: score,
    sort: [score, null, null, id],
  }));
}

function response(
  docs: ReturnType<typeof hits>,
  total?: number,
  pitId = 'synthetic-fix2-pit',
) {
  return {
    body: {
      pit_id: pitId,
      hits: {
        ...(total === undefined
          ? {}
          : { total: { value: total, relation: 'eq' as const } }),
        hits: docs,
      },
    },
  };
}

function harness(search: jest.Mock) {
  const createPit = jest.fn().mockResolvedValue({
    body: { pit_id: 'synthetic-fix2-pit' },
  });
  const deletePit = jest.fn().mockResolvedValue({
    body: { succeeded: true },
  });
  const hydrate = jest.fn<SearchCandidateHydrator>((_query, context, ids) =>
    Promise.resolve({
      total: ids.length,
      page: 1,
      pageSize: ids.length,
      results: ids.map((id) => ({
        ...corpusHit(id),
        visibility: context.visibility,
      })),
    }),
  );
  const adapter = new OpenSearchSearchSourceAdapter(
    { createPit, search, deletePit } as unknown as Client,
    'synthetic-restricted-acl-index',
    'CORPUS',
    hydrate,
  );
  return { adapter, createPit, deletePit, hydrate };
}

describe('COPERNIC-RESTRICTED-ACL-FIX-2 private PIT traversal', () => {
  it('fails closed on the Fix 1 repeated-cursor regression and closes the PIT', async () => {
    const repeatedBatch = hits(
      Array.from(
        { length: 500 },
        (_, index) => `doc-${String(index).padStart(6, '0')}`,
      ),
    );
    const search = jest
      .fn()
      .mockResolvedValueOnce(response(repeatedBatch, 1000))
      .mockResolvedValueOnce(response(repeatedBatch));
    const { adapter, deletePit, hydrate } = harness(search);

    await expect(
      adapter.search(
        parseSearchQuery('synthetic-cursor-regression'),
        privateContext,
      ),
    ).rejects.toThrow('SEARCH_PRIVATE_CURSOR_NOT_PROGRESSING');
    expect(search).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('rejects a cursor cycle even when the cycle is longer than one page', async () => {
    const a = Array.from(
      { length: 500 },
      (_, index) => `a-${String(index).padStart(4, '0')}`,
    );
    const b = Array.from(
      { length: 500 },
      (_, index) => `b-${String(index).padStart(4, '0')}`,
    );
    const search = jest
      .fn()
      .mockResolvedValueOnce(response(hits(a, 3), 2000))
      .mockResolvedValueOnce(response(hits(b, 2)))
      .mockResolvedValueOnce(response(hits(a, 3)));
    const { adapter, deletePit, hydrate } = harness(search);

    await expect(
      adapter.search(
        parseSearchQuery('synthetic-cursor-cycle'),
        privateContext,
      ),
    ).rejects.toThrow('SEARCH_PRIVATE_CURSOR_CYCLE');
    expect(search).toHaveBeenCalledTimes(3);
    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('rejects the same candidate set even if a malformed provider changes its cursor', async () => {
    const repeatedBatch = hits(
      Array.from(
        { length: 500 },
        (_, index) => `doc-${String(index).padStart(6, '0')}`,
      ),
    );
    const lowerScoreBatch = hits(
      Array.from(
        { length: 500 },
        (_, index) => `doc-${String(index).padStart(6, '0')}`,
      ),
      0,
    );
    const search = jest
      .fn()
      .mockResolvedValueOnce(response(repeatedBatch, 1000))
      .mockResolvedValueOnce(response(lowerScoreBatch));
    const { adapter, deletePit, hydrate } = harness(search);

    await expect(
      adapter.search(
        parseSearchQuery('synthetic-duplicate-batch'),
        privateContext,
      ),
    ).rejects.toThrow('SEARCH_PRIVATE_CANDIDATE_BATCH_DUPLICATE');
    expect(search).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('rejects an overlapping document at a page boundary under the stable PIT sort tuple', async () => {
    const firstBatch = hits(
      Array.from(
        { length: 500 },
        (_, index) => `doc-${String(index).padStart(6, '0')}`,
      ),
    );
    const overlappingBatch = hits(['doc-000499', 'doc-000500']);
    const search = jest
      .fn()
      .mockResolvedValueOnce(response(firstBatch, 502))
      .mockResolvedValueOnce(response(overlappingBatch));
    const { adapter, deletePit, hydrate } = harness(search);

    await expect(
      adapter.search(
        parseSearchQuery('synthetic-overlapping-page-boundary'),
        privateContext,
      ),
    ).rejects.toThrow('SEARCH_PRIVATE_CURSOR_NOT_PROGRESSING');
    expect(search).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('fails closed when OpenSearch returns an empty page with candidates remaining', async () => {
    const search = jest.fn().mockResolvedValue(response([], 1000));
    const { adapter, deletePit, hydrate } = harness(search);

    await expect(
      adapter.search(parseSearchQuery('synthetic-empty-page'), privateContext),
    ).rejects.toThrow('SEARCH_PRIVATE_CANDIDATE_SCAN_INCOMPLETE');
    expect(search).toHaveBeenCalledTimes(1);
    expect(hydrate).not.toHaveBeenCalled();
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('requires an empty exhaustion probe after an exact full-size total', async () => {
    const fullBatch = hits(
      Array.from(
        { length: 500 },
        (_, index) => `doc-${String(index).padStart(6, '0')}`,
      ),
    );
    const search = jest
      .fn()
      .mockResolvedValueOnce(response(fullBatch, 500))
      .mockResolvedValueOnce(response([]));
    const { adapter, deletePit, hydrate } = harness(search);

    const result = await adapter.search(
      parseSearchQuery('synthetic-full-size-exhaustion'),
      { ...privateContext, page: 1, pageSize: 20 },
    );

    expect(result).toMatchObject({ total: 500, totalExact: true });
    expect(search).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a continuation page omits its sort cursor', async () => {
    const malformed = [{ _id: 'doc-1', _score: 1 }];
    const search = jest
      .fn()
      .mockResolvedValue(response(malformed as ReturnType<typeof hits>, 2));
    const { adapter, deletePit, hydrate } = harness(search);

    await expect(
      adapter.search(
        parseSearchQuery('synthetic-missing-cursor'),
        privateContext,
      ),
    ).rejects.toThrow('SEARCH_PRIVATE_CANDIDATE_CURSOR_MISSING');
    expect(hydrate).not.toHaveBeenCalled();
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('fails closed when search_after does not change although the next batch differs', async () => {
    const firstBatch = hits(
      Array.from(
        { length: 500 },
        (_, index) => `doc-${String(index).padStart(6, '0')}`,
      ),
    );
    const differentBatch = hits(
      Array.from(
        { length: 300 },
        (_, index) => `doc-${String(index + 200).padStart(6, '0')}`,
      ),
    );
    const search = jest
      .fn()
      .mockResolvedValueOnce(response(firstBatch, 1000))
      .mockResolvedValueOnce(response(differentBatch));
    const { adapter, deletePit, hydrate } = harness(search);

    await expect(
      adapter.search(
        parseSearchQuery('synthetic-stalled-cursor-different-batch'),
        privateContext,
      ),
    ).rejects.toThrow('SEARCH_PRIVATE_CURSOR_NOT_PROGRESSING');
    expect(search).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(deletePit).toHaveBeenCalledTimes(1);
  });

  it('preserves equal-score order, exact totals, and empty pages after the end', async () => {
    const ids = ['case-01', 'case-02', 'case-03', 'case-04'];
    const search = jest
      .fn()
      .mockImplementation(() => response(hits(ids), ids.length));
    const { adapter, deletePit } = harness(search);
    const query = parseSearchQuery('synthetic-equal-sort');
    const page = async (pageNumber: number) =>
      adapter.search(query, {
        ...privateContext,
        page: pageNumber,
        pageSize: 2,
      });

    const [first, second, afterEnd] = await Promise.all([
      page(1),
      page(2),
      page(3),
    ]);

    expect(first).toMatchObject({
      total: 4,
      totalExact: true,
      hasMore: true,
      results: [{ sourceId: 'case-01' }, { sourceId: 'case-02' }],
    });
    expect(second).toMatchObject({
      total: 4,
      totalExact: true,
      hasMore: false,
      results: [{ sourceId: 'case-03' }, { sourceId: 'case-04' }],
    });
    expect(afterEnd).toMatchObject({
      total: 4,
      totalExact: true,
      hasMore: false,
      results: [],
    });
    expect(
      [...first.results, ...second.results, ...afterEnd.results].map(
        (item) => item.sourceId,
      ),
    ).toEqual(ids);
    expect(deletePit).toHaveBeenCalledTimes(3);
  });

  it('keeps a unique id tiebreaker in every supported private Corpus sort', () => {
    const fields = ['relevancia', 'fecha', 'sala', 'numeroSentencia'] as const;
    for (const field of fields) {
      for (const order of ['asc', 'desc'] as const) {
        const sort = searchSort(
          {
            ...privateContext,
            sort: { field, order },
          },
          'CORPUS',
        );
        expect(sort.at(-1)).toEqual({ id: { order: 'asc' } });
      }
    }
  });

  it('exposes only the controlled 503 Search failure to callers', async () => {
    const repeatedBatch = hits(
      Array.from(
        { length: 500 },
        (_, index) => `doc-${String(index).padStart(6, '0')}`,
      ),
    );
    const search = jest
      .fn()
      .mockResolvedValueOnce(response(repeatedBatch, 1000))
      .mockResolvedValueOnce(response(repeatedBatch));
    const { adapter, deletePit } = harness(search);
    const service = new FederatedSearchService(null, adapter, 5000, true);

    await expect(
      service.search(
        parseSearchQuery('synthetic-controlled-failure'),
        privateContext,
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: 'La búsqueda no está disponible temporalmente.',
    });
    expect(deletePit).toHaveBeenCalledTimes(1);
  });
});
