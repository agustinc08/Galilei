import type { Client } from '@opensearch-project/opensearch';
import { createHash } from 'node:crypto';
import type {
  SearchContext,
  SearchResult,
  SearchResultPage,
  SearchSourceAdapter,
} from '../adapters/search-source.adapter';
import type { SearchQueryAst } from '../utils/search-ast';
import { buildSearchQueryDsl } from './search-dsl';

type SearchableSource = 'CORPUS' | 'JURISPRUDENCIA';
type LocaleSortField = 'sala' | 'numeroSentencia';
export type SearchCandidateHydrator = (
  query: SearchQueryAst,
  context: SearchContext,
  candidateIds: string[],
) => Promise<SearchResultPage>;

type OpenSearchHit = {
  _id: string;
  _score: number | null;
  sort?: unknown[];
};
type LocaleSortHit = {
  _id: string;
  _source?: {
    logicalNumericId?: number | null;
    sortFields?: { sala?: string | null; numeroSentencia?: string | null };
  };
};
type SearchResponseBody = {
  took?: number;
  pit_id?: string;
  timed_out?: boolean;
  terminated_early?: boolean;
  _shards?: { failed?: number };
  hits?: {
    total?: { value?: number; relation?: 'eq' | 'gte' };
    hits?: OpenSearchHit[];
  };
};

type PrivateSortCriterion = {
  field: string;
  order: 'asc' | 'desc';
  missing: 'first' | 'last';
};

function compareUtf8OrderedStrings(left: string, right: string) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex)!;
    const rightPoint = right.codePointAt(rightIndex)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return leftIndex === left.length ? (rightIndex === right.length ? 0 : -1) : 1;
}

const MAX_PRIVATE_PIT_REQUESTS = 10_000;
const MAX_PRIVATE_PIT_CANDIDATES = (MAX_PRIVATE_PIT_REQUESTS - 1) * 500;
const MAX_PRIVATE_CURSOR_FINGERPRINT_LENGTH = 4096;

function privateSortCriteria(sort: unknown[]): PrivateSortCriterion[] {
  if (!Array.isArray(sort) || sort.length === 0)
    throw new Error('SEARCH_PRIVATE_SORT_INVALID');
  const criteria = sort.map((entry): PrivateSortCriterion => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new Error('SEARCH_PRIVATE_SORT_INVALID');
    const fields = Object.keys(entry);
    if (fields.length !== 1) throw new Error('SEARCH_PRIVATE_SORT_INVALID');
    const field = fields[0];
    const specification = (entry as Record<string, unknown>)[field];
    if (
      typeof specification !== 'object' ||
      specification === null ||
      Array.isArray(specification)
    ) {
      throw new Error('SEARCH_PRIVATE_SORT_INVALID');
    }
    const options = specification as Record<string, unknown>;
    const order = options.order;
    if (order !== 'asc' && order !== 'desc')
      throw new Error('SEARCH_PRIVATE_SORT_INVALID');
    return {
      field,
      order,
      missing: options.missing === '_first' ? 'first' : 'last',
    };
  });
  const tieBreaker = criteria[criteria.length - 1];
  if (tieBreaker.field !== 'id' || tieBreaker.order !== 'asc')
    throw new Error('SEARCH_PRIVATE_SORT_TIEBREAKER_INVALID');
  return criteria;
}

function privateCursorFingerprint(cursor: unknown, expectedLength: number) {
  if (!Array.isArray(cursor) || cursor.length !== expectedLength)
    throw new Error('SEARCH_PRIVATE_CANDIDATE_CURSOR_MISSING');
  const canonical = cursor.map((value) => {
    if (value === null) return ['null'];
    if (typeof value === 'string') return ['string', value];
    if (typeof value === 'boolean') return ['boolean', value];
    if (typeof value === 'number' && Number.isFinite(value))
      return ['number', Object.is(value, -0) ? '-0' : String(value)];
    throw new Error('SEARCH_PRIVATE_CANDIDATE_CURSOR_INVALID');
  });
  const fingerprint = JSON.stringify(canonical);
  if (fingerprint.length > MAX_PRIVATE_CURSOR_FINGERPRINT_LENGTH)
    throw new Error('SEARCH_PRIVATE_CANDIDATE_CURSOR_INVALID');
  return fingerprint;
}

function comparePrivateCursorValues(
  left: unknown[],
  right: unknown[],
  criteria: PrivateSortCriterion[],
) {
  for (let index = 0; index < criteria.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    const criterion = criteria[index];
    if (leftValue === null || rightValue === null) {
      if (leftValue === rightValue) continue;
      return leftValue === null
        ? criterion.missing === 'first'
          ? -1
          : 1
        : criterion.missing === 'first'
          ? 1
          : -1;
    }

    let comparison: number;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    } else if (
      typeof leftValue === 'string' &&
      typeof rightValue === 'string'
    ) {
      comparison = compareUtf8OrderedStrings(leftValue, rightValue);
    } else if (
      typeof leftValue === 'boolean' &&
      typeof rightValue === 'boolean'
    ) {
      comparison = Number(leftValue) - Number(rightValue);
    } else {
      throw new Error('SEARCH_PRIVATE_CANDIDATE_CURSOR_INVALID');
    }
    if (comparison !== 0)
      return criterion.order === 'asc' ? comparison : -comparison;
  }
  return 0;
}

function privateCandidateBatchFingerprint(ids: string[]) {
  const canonicalIds = [...ids].sort(compareUtf8OrderedStrings);
  return createHash('sha256')
    .update(JSON.stringify(canonicalIds))
    .digest('hex');
}

function unwrapSearchResponse(response: unknown): SearchResponseBody {
  if (typeof response !== 'object' || response === null) {
    throw new Error('SEARCH_PRIVATE_RESPONSE_INVALID');
  }
  const wrapped = response as { body?: unknown };
  if (typeof wrapped.body === 'object' && wrapped.body !== null) {
    return wrapped.body;
  }
  return response;
}
/** Private Corpus scopes authorize each ordered OpenSearch candidate batch in PostgreSQL before count/page selection. */
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
    const documentScope = context.documentScope;
    if (
      this.source === 'CORPUS' &&
      (documentScope?.kind === 'WORKSPACE' ||
        documentScope?.kind === 'PERSONAL')
    ) {
      const dslStarted = performance.now();
      const searchQuery = buildSearchQueryDsl(query, context, {
        source: this.source,
        livePrivateAcl: true,
      });
      const dslBuildMs = performance.now() - dslStarted;
      return this.searchPrivateScope(
        query,
        context,
        searchQuery,
        page,
        pageSize,
        from,
        started,
        dslBuildMs,
      );
    }
    const dslStarted = performance.now();
    const searchQuery = buildSearchQueryDsl(query, context, {
      source: this.source,
    });
    const dslBuildMs = performance.now() - dslStarted;
    const engineStarted = performance.now();
    const body = await this.searchPage(searchQuery, from, pageSize, context);
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
      queryCount: 1,
      candidateStrategy: 'opensearch-exact-id-page-postgresql-hydration',
      stageTimings: {
        dslBuildMs,
        openSearchClientWallMs: clientWallMs,
        openSearchTookMs: Number(body.took ?? 0),
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

  /**
   * Stream private Corpus hits in OpenSearch order and authorize each bounded
   * batch through the existing live PostgreSQL hydrator before counting or
   * selecting the requested page. The PIT gives the scan one stable snapshot.
   */
  private async searchPrivateScope(
    query: SearchQueryAst,
    context: SearchContext,
    searchQuery: Record<string, unknown>,
    page: number,
    pageSize: number,
    from: number,
    started: number,
    dslBuildMs: number,
  ): Promise<SearchResultPage> {
    const batchSize = 500;
    const sort = searchSort(context, this.source);
    const sortCriteria = privateSortCriteria(sort);
    const scanStarted = performance.now();
    let pitId: string | undefined;
    let searchAfter: unknown[] | undefined;
    let rawTotal: number | null = null;
    let rawScanned = 0;
    let authorizedTotal = 0;
    let searchQueryCount = 0;
    let authorizationBatchCount = 0;
    let authorizationMs = 0;
    let previousOutgoingCursorFingerprint: string | undefined;
    const seenCursorFingerprints = new Set<string>();
    const seenCandidateBatchFingerprints = new Set<string>();
    const results: SearchResult[] = [];

    try {
      const pitResponse = unwrapSearchResponse(
        await this.client.createPit({
          index: this.alias,
          keep_alive: '1m',
        }),
      );
      pitId = pitResponse.pit_id;
      if (!pitId) throw new Error('SEARCH_PRIVATE_PIT_CREATE_FAILED');

      while (true) {
        if (searchQueryCount >= MAX_PRIVATE_PIT_REQUESTS)
          throw new Error('SEARCH_PRIVATE_SCAN_LIMIT_EXCEEDED');
        const response = await this.client.search({
          body: {
            size: batchSize,
            track_total_hits: rawTotal === null,
            pit: { id: pitId, keep_alive: '1m' },
            _source: false,
            query: searchQuery,
            sort,
            ...(searchAfter ? { search_after: searchAfter } : {}),
          },
        });
        searchQueryCount += 1;
        const body = unwrapSearchResponse(response);
        pitId = body.pit_id ?? pitId;
        if (
          body.timed_out === true ||
          body.terminated_early === true ||
          (typeof body._shards?.failed === 'number' && body._shards.failed > 0)
        ) {
          throw new Error('SEARCH_PRIVATE_CANDIDATE_SCAN_INCOMPLETE');
        }
        if (rawTotal === null) {
          const totalValue = body.hits?.total?.value;
          if (
            typeof totalValue !== 'number' ||
            !Number.isSafeInteger(totalValue) ||
            totalValue < 0 ||
            body.hits?.total?.relation !== 'eq'
          )
            throw new Error('SEARCH_TOTAL_NOT_EXACT');
          rawTotal = totalValue;
          if (rawTotal > MAX_PRIVATE_PIT_CANDIDATES)
            throw new Error('SEARCH_PRIVATE_SCAN_LIMIT_EXCEEDED');
        }

        const hits = body.hits?.hits;
        if (!Array.isArray(hits))
          throw new Error('SEARCH_PRIVATE_RESPONSE_INVALID');
        if (!hits.length) {
          if (rawScanned !== rawTotal)
            throw new Error('SEARCH_PRIVATE_CANDIDATE_SCAN_INCOMPLETE');
          break;
        }
        if (hits.length > batchSize || rawScanned + hits.length > rawTotal)
          throw new Error('SEARCH_PRIVATE_CANDIDATE_SCAN_OVERFLOW');

        const ids = hits.map((hit) => {
          if (typeof hit?._id !== 'string' || !hit._id.length)
            throw new Error('SEARCH_PRIVATE_CANDIDATE_ID_INVALID');
          return this.toHydrationId(hit._id);
        });
        if (new Set(ids).size !== ids.length)
          throw new Error('SEARCH_PRIVATE_CANDIDATE_DUPLICATE');

        const lastSort = hits[hits.length - 1]?.sort;
        const lastCursorFingerprint = privateCursorFingerprint(
          lastSort,
          sortCriteria.length,
        );
        if (seenCursorFingerprints.has(lastCursorFingerprint)) {
          throw new Error(
            lastCursorFingerprint === previousOutgoingCursorFingerprint
              ? 'SEARCH_PRIVATE_CURSOR_NOT_PROGRESSING'
              : 'SEARCH_PRIVATE_CURSOR_CYCLE',
          );
        }

        let previousSort = searchAfter;
        for (let index = 0; index < hits.length; index += 1) {
          const hit = hits[index];
          const candidateSort = hit.sort;
          privateCursorFingerprint(candidateSort, sortCriteria.length);
          if (candidateSort?.[candidateSort.length - 1] !== hit._id)
            throw new Error('SEARCH_PRIVATE_SORT_TIEBREAKER_INVALID');
          if (
            previousSort &&
            comparePrivateCursorValues(
              previousSort,
              candidateSort,
              sortCriteria,
            ) >= 0
          ) {
            throw new Error('SEARCH_PRIVATE_CURSOR_NOT_PROGRESSING');
          }
          previousSort = candidateSort;
        }

        const batchFingerprint = privateCandidateBatchFingerprint(ids);
        if (seenCandidateBatchFingerprints.has(batchFingerprint))
          throw new Error('SEARCH_PRIVATE_CANDIDATE_BATCH_DUPLICATE');

        const nextRawScanned = rawScanned + hits.length;
        if (nextRawScanned < rawTotal && hits.length < batchSize)
          throw new Error('SEARCH_PRIVATE_CANDIDATE_SCAN_INCOMPLETE');

        const authorizationStarted = performance.now();
        const hydrated = await this.hydrate(
          query,
          { ...context, page: 1, pageSize: ids.length },
          ids,
        );
        authorizationMs += performance.now() - authorizationStarted;
        authorizationBatchCount += 1;
        const hydratedById = new Map(
          hydrated.results.map((result) => [result.sourceId, result]),
        );
        for (const hit of hits) {
          const id = this.toHydrationId(hit._id);
          const authorizedResult = hydratedById.get(id);
          if (!authorizedResult) continue;
          const authorizedOrdinal = authorizedTotal;
          authorizedTotal += 1;
          if (authorizedOrdinal >= from && results.length < pageSize) {
            results.push({
              ...authorizedResult,
              score: hit._score ?? authorizedResult.score,
            });
          }
        }

        rawScanned = nextRawScanned;
        seenCandidateBatchFingerprints.add(batchFingerprint);

        // A short, complete page proves exhaustion. If an exact multiple of
        // batchSize was reported, request one more page and require OpenSearch
        // to return empty before accepting the exact total.
        if (rawScanned === rawTotal && hits.length < batchSize) break;

        const cursorFingerprint = privateCursorFingerprint(
          lastSort,
          sortCriteria.length,
        );
        if (seenCursorFingerprints.has(cursorFingerprint))
          throw new Error('SEARCH_PRIVATE_CURSOR_NOT_PROGRESSING');
        seenCursorFingerprints.add(cursorFingerprint);
        previousOutgoingCursorFingerprint = cursorFingerprint;
        searchAfter = lastSort;
      }

      if (rawTotal === null || rawScanned !== rawTotal)
        throw new Error('SEARCH_PRIVATE_CANDIDATE_SCAN_INCOMPLETE');
      const elapsed = performance.now() - started;
      this.lastProfile = {
        countMs: 0,
        resultPageMs: Math.round(elapsed * 100) / 100,
        resultRows: results.length,
        queryCount: searchQueryCount,
        candidateStrategy:
          'opensearch-ordered-batched-live-acl-before-count-and-page',
        stageTimings: {
          dslBuildMs,
          openSearchPITScanMs:
            Math.round((performance.now() - scanStarted) * 100) / 100,
          rawCandidateCount: rawTotal,
          authorizedTotal,
          openSearchQueryCount: searchQueryCount,
          postgresAuthorizationBatchCount: authorizationBatchCount,
          postgresAuthorizationMs: Math.round(authorizationMs * 100) / 100,
          totalAdapterMs: Math.round(elapsed * 100) / 100,
        },
      };
      return {
        total: authorizedTotal,
        totalExact: true,
        hasMore: authorizedTotal > from + results.length,
        page,
        pageSize,
        results,
      };
    } finally {
      if (pitId) {
        await this.client
          .deletePit({ body: { pit_id: [pitId] } })
          .catch(() => undefined);
      }
    }
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

/** Shared by offline diagnostics that compare the legacy locale collation with indexed keyword order. */
export function compareLocaleSortHits(
  left: LocaleSortHit,
  right: LocaleSortHit,
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
        {
          [selected]: {
            order: requested.order,
            missing: requested.order === 'asc' ? '_first' : '_last',
          },
        },
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
