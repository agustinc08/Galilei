import type { Client } from '@opensearch-project/opensearch';
import type {
  SearchContext,
  SearchResult,
  SearchResultPage,
  SearchSourceAdapter,
} from '../adapters/search-source.adapter';
import type { SearchQueryAst } from '../utils/search-ast';
import { buildSearchQueryDsl } from './search-dsl';

type SearchableSource = 'CORPUS' | 'JURISPRUDENCIA';
export type SearchCandidateHydrator = (
  query: SearchQueryAst,
  context: SearchContext,
  candidateIds: string[],
) => Promise<SearchResultPage>;

type LocaleSortField = 'sala' | 'numeroSentencia';
type OpenSearchHit = {
  _id: string;
  _score: number | null;
  sort?: unknown[];
  _source?: {
    logicalNumericId?: number | null;
    sortFields?: { sala?: string | null; numeroSentencia?: string | null };
  };
};
type SearchResponseBody = {
  took?: number;
  hits?: {
    total?: { value?: number; relation?: 'eq' | 'gte' };
    hits?: OpenSearchHit[];
  };
};
type CompleteLocaleSearch = {
  body: SearchResponseBody;
  queryCount: number;
  inMemorySortMs: number;
  scannedHits: number;
  distinctHits: number;
};

/** OpenSearch owns matching/count/order; PostgreSQL revalidates ACL and hydrates only the returned page. */
export class OpenSearchSearchSourceAdapter implements SearchSourceAdapter {
  private lastProfile: {
    countMs: number;
    resultPageMs: number;
    resultRows: number;
    queryCount: number;
    candidateStrategy: string;
    stageTimings: Record<string, number | number[]>;
  } | null = null;

  constructor(
    private readonly client: Client,
    private readonly alias: string,
    private readonly source: SearchableSource,
    private readonly hydrate: SearchCandidateHydrator,
    private readonly closeHydrator?: () => Promise<void>,
  ) {}

  getLastSearchProfile() {
    return this.lastProfile;
  }

  async close() {
    await this.closeHydrator?.();
  }

  async search(
    query: SearchQueryAst,
    context: SearchContext,
  ): Promise<SearchResultPage> {
    const started = performance.now();
    const page = Math.max(1, Math.trunc(context.page ?? 1));
    const pageSize = Math.min(
      500,
      Math.max(1, Math.trunc(context.pageSize ?? 25)),
    );
    if (context.sourceSystems && !context.sourceSystems.includes(this.source)) {
      return {
        total: 0,
        totalExact: true,
        hasMore: false,
        page,
        pageSize,
        results: [],
      };
    }

    const from = (page - 1) * pageSize;
    if (from + pageSize > 30000) throw new Error('SEARCH_PAGE_WINDOW_EXCEEDED');
    const dslStarted = performance.now();
    const searchQuery = buildSearchQueryDsl(query, context, {
      source: this.source,
    });
    const dslBuildMs = performance.now() - dslStarted;
    const engineStarted = performance.now();
    const localeField = localeSortField(context, this.source);
    const localeSearch = localeField
      ? await this.searchWithLocaleSort(
          searchQuery,
          from,
          pageSize,
          localeField,
          context.sort?.order ?? 'asc',
        )
      : null;
    const body = localeSearch
      ? localeSearch.body
      : await this.searchPage(searchQuery, from, pageSize, context);
    const clientWallMs = performance.now() - engineStarted;
    const total = body.hits?.total?.value;
    if (!Number.isSafeInteger(total) || body.hits?.total?.relation !== 'eq') {
      throw new Error('SEARCH_TOTAL_NOT_EXACT');
    }
    const exactTotal = total as number;
    const pageIdExtractionStarted = performance.now();
    const hits = body.hits?.hits ?? [];
    const ids = hits.map((hit) => this.toHydrationId(hit._id));
    const engineScore = new Map(
      ids.map((id, index) => [id, hits[index]._score ?? 0]),
    );
    const pageIdExtractionMs = performance.now() - pageIdExtractionStarted;
    const hydrationStarted = performance.now();
    const hydrated = ids.length
      ? await this.hydrate(
          query,
          { ...context, page: 1, pageSize: ids.length },
          ids,
        )
      : { total: 0, page: 1, pageSize, results: [] };
    const postgresHydrationMs = performance.now() - hydrationStarted;
    const reorderStarted = performance.now();
    const byId = new Map(
      hydrated.results.map((result) => [this.toEngineId(result), result]),
    );
    const results: SearchResult[] = [];
    for (const hit of hits) {
      const hydratedResult = byId.get(hit._id);
      if (!hydratedResult) continue;
      results.push({
        ...hydratedResult,
        score: engineScore.get(hydratedResult.sourceId) ?? hit._score ?? 0,
      });
    }
    const hydrationReorderMs = performance.now() - reorderStarted;
    const elapsed = performance.now() - started;
    this.lastProfile = {
      countMs: 0,
      resultPageMs: Math.round(elapsed * 100) / 100,
      resultRows: results.length,
      queryCount: localeSearch?.queryCount ?? 1,
      candidateStrategy: 'opensearch-exact-id-page-postgresql-hydration',
      stageTimings: {
        dslBuildMs,
        openSearchClientWallMs: clientWallMs,
        openSearchTookMs: Number(body.took ?? 0),
        ...(localeSearch
          ? {
              inMemoryLocaleSortMs: localeSearch.inMemorySortMs,
              localeSearchScannedHits: localeSearch.scannedHits,
              localeSearchDistinctHits: localeSearch.distinctHits,
            }
          : {}),
        pageIdExtractionMs,
        postgresHydrationMs,
        hydrationReorderMs,
        totalAdapterMs: elapsed,
      },
    };
    return {
      total: exactTotal,
      totalExact: true,
      hasMore: from + hits.length < exactTotal,
      page,
      pageSize,
      results,
    };
  }

  private async searchPage(
    query: Record<string, unknown>,
    from: number,
    pageSize: number,
    context: SearchContext,
  ): Promise<SearchResponseBody> {
    const response = await this.client.search({
      index: this.alias,
      body: {
        from,
        size: pageSize,
        track_total_hits: true,
        _source: false,
        query,
        sort: searchSort(context, this.source),
      },
    });
    return (
      (response as unknown as { body?: SearchResponseBody }).body ??
      (response as unknown as SearchResponseBody)
    );
  }

  private async searchWithLocaleSort(
    query: Record<string, unknown>,
    from: number,
    pageSize: number,
    field: LocaleSortField,
    order: 'asc' | 'desc',
  ): Promise<CompleteLocaleSearch> {
    const batchSize = 1000;
    const hits: OpenSearchHit[] = [];
    let total: number | null = null;
    let tookMs = 0;
    let queryCount = 0;
    let searchAfter: unknown[] | undefined;
    for (;;) {
      const response = await this.client.search({
        index: this.alias,
        body: {
          size: batchSize,
          track_total_hits: total === null,
          track_scores: true,
          _source: ['logicalNumericId', `sortFields.${field}`],
          query,
          sort: [
            { logicalNumericId: { order: 'desc', missing: '_last' } },
            { id: { order: 'desc' } },
          ],
          ...(searchAfter ? { search_after: searchAfter } : {}),
        },
      });
      queryCount += 1;
      const body =
        (response as unknown as { body?: SearchResponseBody }).body ??
        (response as unknown as SearchResponseBody);
      tookMs += Number(body.took ?? 0);
      const batch = body.hits?.hits ?? [];
      if (total === null) {
        if (
          !Number.isSafeInteger(body.hits?.total?.value) ||
          body.hits?.total?.relation !== 'eq'
        )
          throw new Error('SEARCH_TOTAL_NOT_EXACT');
        total = body.hits?.total?.value as number;
      }
      hits.push(...batch);
      if (hits.length >= total) break;
      const lastSort = batch[batch.length - 1]?.sort;
      if (!batch.length || !lastSort)
        throw new Error('SEARCH_LOCALE_SORT_SCAN_INCOMPLETE');
      searchAfter = lastSort;
    }
    if (hits.length !== total)
      throw new Error('SEARCH_LOCALE_SORT_TOTAL_MISMATCH');
    const distinctHits = new Set(hits.map((hit) => hit._id)).size;
    if (distinctHits !== total)
      throw new Error('SEARCH_LOCALE_SORT_DUPLICATE_HITS');

    const sortStarted = performance.now();
    hits.sort((left, right) =>
      compareLocaleSortHits(left, right, field, order),
    );
    const inMemorySortMs = performance.now() - sortStarted;
    return {
      body: {
        took: tookMs,
        hits: {
          total: { value: total, relation: 'eq' },
          hits: hits.slice(from, from + pageSize),
        },
      },
      queryCount,
      inMemorySortMs,
      scannedHits: hits.length,
      distinctHits,
    };
  }

  private toHydrationId(engineId: string) {
    if (this.source === 'CORPUS') return engineId;
    const match = engineId.match(/^JURISPRUDENCIA:(SUMARIO|SENTENCIA):(\d+)$/u);
    if (!match) throw new Error('SEARCH_INDEX_ID_INVALID');
    return match[1] === 'SENTENCIA' ? `SENTENCIA:${match[2]}` : match[2];
  }

  private toEngineId(result: SearchResult) {
    return this.source === 'CORPUS'
      ? result.sourceId
      : `JURISPRUDENCIA:${result.sourceType}:${result.sourceId}`;
  }
}

export function compareLocaleSortHits(
  left: OpenSearchHit,
  right: OpenSearchHit,
  field: LocaleSortField,
  order: 'asc' | 'desc',
) {
  const leftValue = left._source?.sortFields?.[field] ?? '';
  const rightValue = right._source?.sortFields?.[field] ?? '';
  const direction = order === 'asc' ? 1 : -1;
  const primary = leftValue.localeCompare(rightValue) * direction;
  if (primary) return primary;
  const leftId = left._source?.logicalNumericId ?? Number.MIN_SAFE_INTEGER;
  const rightId = right._source?.logicalNumericId ?? Number.MIN_SAFE_INTEGER;
  if (leftId !== rightId) return rightId - leftId;
  return right._id.localeCompare(left._id);
}

function localeSortField(
  context: SearchContext,
  source: SearchableSource,
): LocaleSortField | null {
  if (source !== 'JURISPRUDENCIA') return null;
  if (context.sort?.field === 'sala') return 'sala';
  if (context.sort?.field === 'numeroSentencia') return 'numeroSentencia';
  return null;
}

export function searchSort(context: SearchContext, source: SearchableSource) {
  const requested = context.sort;
  if (source === 'JURISPRUDENCIA') {
    if (!requested || requested.field === 'relevancia') {
      return [
        { _score: { order: requested?.order ?? 'desc' } },
        legacyDateEpochSort('desc'),
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ];
    }
    const selected =
      requested.field === 'fecha'
        ? 'decisionDate'
        : requested.field === 'sala'
          ? 'sortFields.sala'
          : 'sortFields.numeroSentencia';
    if (requested.field === 'sala' || requested.field === 'numeroSentencia')
      return [
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ];
    if (requested.field === 'fecha')
      return [
        legacyDateEpochSort(requested.order),
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ];
    return [
      {
        [selected]: {
          order: requested.order,
          missing: requested.order === 'asc' ? '_first' : '_last',
        },
      },
      { _score: { order: 'desc' } },
      ...(selected === 'decisionDate'
        ? []
        : [{ decisionDate: { order: 'desc', missing: '_last' } }]),
      { logicalNumericId: { order: 'desc', missing: '_last' } },
      { id: { order: 'desc' } },
    ];
  }
  if (!requested || requested.field === 'relevancia') {
    return [
      { _score: { order: requested?.order ?? 'desc' } },
      { decisionDate: { order: 'desc', missing: '_last' } },
      { updatedAt: { order: 'desc', missing: '_last' } },
      { id: { order: 'asc' } },
    ];
  }

  const fields = {
    fecha: 'decisionDate',
    sala: 'chamber',
  } as const;
  const selected =
    requested.field === 'numeroSentencia'
      ? 'caseNumber'
      : fields[requested.field];
  const sort: Array<Record<string, unknown>> = [
    { [selected]: { order: requested.order, missing: '_last' } },
    { _score: { order: 'desc' } },
  ];
  if (selected !== 'decisionDate')
    sort.push({ decisionDate: { order: 'desc', missing: '_last' } });
  sort.push({ updatedAt: { order: 'desc', missing: '_last' } });
  sort.push({ id: { order: 'asc' } });
  return sort;
}

function legacyDateEpochSort(order: 'asc' | 'desc') {
  return {
    _script: {
      type: 'number',
      order,
      script: {
        lang: 'painless',
        source:
          "doc['decisionDate'].size() == 0 ? 0L : doc['decisionDate'].value.toInstant().toEpochMilli()",
      },
    },
  };
}
