import type {
  SearchContext,
  SearchResult,
  SearchResultPage,
  SearchSourceAdapter,
} from './adapters/search-source.adapter';
import { parseSearchQuery } from './utils/search-parser';
import { FederatedSearchService } from './federated-search.service';

const context: SearchContext = {
  visibility: 'PUBLIC',
  dialect: 'modern',
  publicationPolicy: 'published-active-only',
  page: 1,
  pageSize: 10,
};
function result(
  id: string,
  sourceSystem: SearchResult['sourceSystem'],
  score: number,
  linkedResultIds?: string[],
): SearchResult {
  return {
    id,
    sourceSystem,
    sourceType: sourceSystem === 'CORPUS' ? 'DOCUMENTO' : 'SUMARIO',
    sourceId: id.split(':').pop()!,
    title: id,
    subtitle: null,
    date: null,
    snippet: null,
    matchedFields: [],
    score,
    metadata: {},
    visibility: 'PUBLIC',
    document: null,
    linkedResultIds,
  };
}
function adapter(
  page: SearchResultPage | (() => Promise<SearchResultPage>),
): SearchSourceAdapter {
  return {
    search: jest.fn(() =>
      typeof page === 'function' ? page() : Promise.resolve(page),
    ),
  };
}

describe('FederatedSearchService', () => {
  it('fans out concurrently, merges stably, and removes an explicitly linked Corpus representation', async () => {
    let active = 0;
    let maxActive = 0;
    const make = (page: SearchResultPage) => ({
      search: async () => {
        active += 1;
        maxActive = Math.max(active, maxActive);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return page;
      },
    });
    const juris = result('JURISPRUDENCIA:SUMARIO:4', 'JURISPRUDENCIA', 5);
    const corpusLinked = result('CORPUS:DOCUMENTO:x', 'CORPUS', 6, ['4']);
    const corpusNew = result('CORPUS:DOCUMENTO:y', 'CORPUS', 3);
    const service = new FederatedSearchService(
      make({ total: 1, page: 1, pageSize: 3, results: [juris] }),
      make({
        total: 2,
        page: 1,
        pageSize: 3,
        results: [corpusLinked, corpusNew],
      }),
    );
    const found = await service.search(parseSearchQuery('civil'), context);
    expect(maxActive).toBe(2);
    expect(found.results.map((item) => item.id)).toEqual([
      juris.id,
      corpusNew.id,
    ]);
    expect(found.deduplicated).toBe(1);
    expect(found.total).toBe(2);
    await service.onModuleDestroy();
  });

  it('respects source selection', async () => {
    const slow: SearchSourceAdapter = {
      search: () => new Promise(() => undefined),
    };
    const onlyCorpus = new FederatedSearchService(
      slow,
      adapter({
        total: 1,
        page: 1,
        pageSize: 10,
        results: [result('CORPUS:DOCUMENTO:ok', 'CORPUS', 1)],
      }),
      2,
    );
    const found = await onlyCorpus.search(parseSearchQuery('civil'), {
      ...context,
      sourceSystems: ['CORPUS'],
    });
    expect(found.results).toHaveLength(1);
    expect(found.sources).toHaveLength(1);
    expect(found.sources[0].source).toBe('CORPUS');
    await onlyCorpus.onModuleDestroy();
  });

  it('searches only Jurisprudencia when requested', async () => {
    const jurisResult = result(
      'JURISPRUDENCIA:SUMARIO:solo',
      'JURISPRUDENCIA',
      2,
    );
    const jurisSearch = jest.fn().mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      results: [jurisResult],
    });
    const corpusSearch = jest.fn().mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      results: [result('CORPUS:DOCUMENTO:omitido', 'CORPUS', 1)],
    });
    const juris: SearchSourceAdapter = { search: jurisSearch };
    const corpus: SearchSourceAdapter = { search: corpusSearch };
    const service = new FederatedSearchService(juris, corpus);
    const found = await service.search(parseSearchQuery('civil'), {
      ...context,
      sourceSystems: ['JURISPRUDENCIA'],
    });
    expect(jurisSearch).toHaveBeenCalledTimes(1);
    expect(corpusSearch).not.toHaveBeenCalled();
    expect(found.results.map((item) => item.id)).toEqual([jurisResult.id]);
    expect(found.sources.map((item) => item.source)).toEqual([
      'JURISPRUDENCIA',
    ]);
    await service.onModuleDestroy();
  });

  it('returns available-source results when another source exceeds its timeout', async () => {
    const slow: SearchSourceAdapter = {
      search: () => new Promise(() => undefined),
    };
    const fast = adapter({
      total: 1,
      page: 1,
      pageSize: 10,
      results: [result('CORPUS:DOCUMENTO:ok', 'CORPUS', 1)],
    });
    const service = new FederatedSearchService(slow, fast, 2);
    const found = await service.search(parseSearchQuery('civil'), context);
    expect(found.results).toHaveLength(1);
    expect(found.partial).toBe(true);
    expect(found.totalExact).toBe(false);
    expect(
      found.sources.find((source) => source.source === 'JURISPRUDENCIA'),
    ).toMatchObject({ ok: false, error: 'source_timeout_or_unavailable' });
    expect(found.sources.find((source) => source.source === 'CORPUS')?.ok).toBe(
      true,
    );
    await service.onModuleDestroy();
  });

  it('uses source pagination directly without refetching and re-slicing a single source', async () => {
    const items = Array.from({ length: 80 }, (_, index) =>
      result(`JURISPRUDENCIA:SUMARIO:${index}`, 'JURISPRUDENCIA', 100 - index),
    );
    const jurisSearch = jest.fn((_query, sourceContext: SearchContext) => {
      const page = sourceContext.page ?? 1;
      const pageSize = sourceContext.pageSize ?? 25;
      const offset = (page - 1) * pageSize;
      return Promise.resolve({
        total: items.length,
        page,
        pageSize,
        hasMore: offset + pageSize < items.length,
        results: items.slice(offset, offset + pageSize),
      });
    });
    const juris: SearchSourceAdapter = { search: jurisSearch };
    const service = new FederatedSearchService(juris, null);
    const found = await service.search(parseSearchQuery('civil'), {
      ...context,
      page: 2,
      pageSize: 20,
    });
    expect(found.results.map((item) => item.sourceId)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(index + 20)),
    );
    expect(jurisSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, pageSize: 20 }),
    );
    expect(found.page).toBe(2);
    expect(found.total).toBe(80);
    await service.onModuleDestroy();
  });
});
