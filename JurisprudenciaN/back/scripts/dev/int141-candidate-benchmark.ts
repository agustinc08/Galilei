import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { OpenSearchSearchSourceAdapter } from '../../src/busqueda/opensearch/opensearch-search-source.adapter';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import { phraseSequence } from '../../src/busqueda/opensearch/opensearch-mapping';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';
import type { SearchQueryAst } from '../../src/busqueda/utils/search-ast';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';

type PhraseReference = {
  index: number;
  queryHash: string;
  expectedCount: number;
  expectedIdSetSha256: string;
};
type PrefixReference = {
  term: string;
  expectedCount: number;
  expectedIdSetSha256: string;
};
type MetricSummary = {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};
type PhraseParityRow = {
  index: number;
  queryHash: string;
  expectedCount: number;
  referenceV2Count: number;
  candidateV3Count: number;
  referenceV2IdSetSha256: string;
  candidateV3IdSetSha256: string;
  falsePositives: number;
  falseNegatives: number;
  exact: boolean;
};
type CriticalResult = {
  queryId: string;
  phrase: string;
  total: number;
  warmups: number;
  measuredRuns: number;
  engineWallMs: MetricSummary;
  engineTookMs: MetricSummary;
  productLikeAdapterHydrationMs: MetricSummary;
  lastProductProfile: unknown;
  profileSample: unknown;
};
type SearchBody = {
  took?: number;
  hits?: {
    total?: { value?: number; relation?: 'eq' | 'gte' };
    hits?: Array<{ _id: string; sort?: unknown[] }>;
  };
};

loadLocalEnvironment();

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function idSetHash(ids: string[]) {
  return sha256([...ids].sort().join('\n'));
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
}

function summary(values: number[]) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length ? Math.max(...values) : null,
  };
}

function loadLocalEnvironment() {
  const envFile = resolve(process.cwd(), '.env.development.local');
  const content = readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    process.env[match[1]] =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

function unwrap<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    const body = (response as { body?: unknown }).body;
    if (body && typeof body === 'object') return body as T;
  }
  return response as T;
}

function createPhraseAst(phrase: string): SearchQueryAst {
  const parsed = parseSearchQuery(`"${phrase}"`);
  if (parsed.root?.type !== 'phrase')
    throw new Error(`FROZEN_PHRASE_PARSE_FAILED:${sha256(phrase)}`);
  return parsed;
}

const context: SearchContext = {
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 20,
  sourceSystems: ['CORPUS'],
};

async function discoverCandidate(client: Client) {
  const response = await client.cat.indices({
    index: 'galilei-search-v003-*',
    format: 'json',
    h: 'index,docs.count,store.size',
  });
  const body =
    (response as unknown as { body?: Array<Record<string, string>> }).body ??
    (response as unknown as Array<Record<string, string>>);
  const rows = Array.isArray(body) ? body : [];
  const indices = rows
    .map((row) => row.index)
    .filter((index): index is string => typeof index === 'string')
    .sort();
  const explicit = process.env.OPENSEARCH_CANDIDATE_INDEX?.trim();
  if (explicit) {
    if (!indices.includes(explicit))
      throw new Error('CANDIDATE_INDEX_NOT_FOUND');
    return explicit;
  }
  if (indices.length !== 1)
    throw new Error(`CANDIDATE_INDEX_AMBIGUOUS:${indices.length}`);
  return indices[0];
}

async function runSearch(
  client: Client,
  index: string,
  query: Record<string, unknown>,
  size: number,
  profile = false,
) {
  const started = performance.now();
  const response = await client.search({
    index,
    request_cache: false,
    body: {
      from: 0,
      size,
      track_total_hits: true,
      _source: false,
      query,
      ...(size > 0 ? { sort: [{ id: { order: 'asc' } }] } : {}),
      ...(profile ? { profile: true } : {}),
    },
  });
  const wallMs = performance.now() - started;
  const body = unwrap<SearchBody>(response);
  const total = body.hits?.total?.value;
  if (!Number.isSafeInteger(total) || body.hits?.total?.relation !== 'eq')
    throw new Error('CANDIDATE_TOTAL_NOT_EXACT');
  const ids = (body.hits?.hits ?? []).map((hit) => hit._id);
  return {
    wallMs,
    tookMs: Number(body.took ?? 0),
    total: total as number,
    ids,
    profile: (body as SearchBody & { profile?: unknown }).profile,
  };
}

async function main() {
  const root = resolve(
    process.cwd(),
    '../../_recovery-work/search-engine-integration1',
  );
  const referenceFile = resolve(root, 'phrase-100-v2.json');
  const reference = JSON.parse(readFileSync(referenceFile, 'utf8')) as {
    sourceIndex: string;
    documents: number;
    rows: PhraseReference[];
    criticalRows: Array<{
      phraseId: string;
      expectedCount: number;
      expectedIdSetSha256: string;
    }>;
  };
  const phraseFile = resolve(tmpdir(), 'galilei-search-int141-phrase-set.json');
  const phrases = JSON.parse(readFileSync(phraseFile, 'utf8')) as string[];
  if (phrases.length !== 100 || reference.rows.length !== 100)
    throw new Error('FROZEN_PHRASE_SET_INVALID');
  if (
    phrases.some(
      (phrase, index) => sha256(phrase) !== reference.rows[index].queryHash,
    )
  )
    throw new Error('FROZEN_PHRASE_HASH_SEQUENCE_MISMATCH');
  const prefixReferenceFile = resolve(
    process.cwd(),
    '../../_recovery-work/search-engine-eval2/prefix-equivalence.json',
  );
  const prefixReference = JSON.parse(
    readFileSync(prefixReferenceFile, 'utf8'),
  ) as { rows: PrefixReference[] };
  const prefixPerformanceReference = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../../_recovery-work/search-engine-eval2/prefix-performance.json',
      ),
      'utf8',
    ),
  ) as { p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
  if (prefixReference.rows.length !== 14)
    throw new Error('FROZEN_PREFIX_SUITE_INVALID');

  const config = readOpenSearchConfig();
  const client = new Client(config.clientOptions);
  const corpusHydrator = new CorpusSearchSourceAdapter(
    process.env.DATABASE_URL,
  );
  let candidateIndex: string | null = null;
  try {
    candidateIndex = await discoverCandidate(client);
    const prefixRows: Array<Record<string, unknown>> = [];
    for (const expected of prefixReference.rows) {
      const dsl = buildSearchQueryDsl(
        parseSearchQuery(expected.term),
        context,
        {
          source: 'CORPUS',
        },
      );
      const actual = await runSearch(client, candidateIndex, dsl, 30000);
      const actualIds = [...actual.ids].sort();
      const exact =
        actual.total === expected.expectedCount &&
        idSetHash(actualIds) === expected.expectedIdSetSha256;
      prefixRows.push({
        term: expected.term,
        expectedCount: expected.expectedCount,
        actualCount: actual.total,
        expectedIdSetSha256: expected.expectedIdSetSha256,
        actualIdSetSha256: idSetHash(actualIds),
        falsePositives: Math.max(0, actual.total - expected.expectedCount),
        falseNegatives: Math.max(0, expected.expectedCount - actual.total),
        exact,
      });
    }
    const prefixWallSamples: number[] = [];
    const prefixTookSamples: number[] = [];
    const prefixPerformanceRows: Array<Record<string, unknown>> = [];
    for (const expected of prefixReference.rows) {
      const dsl = buildSearchQueryDsl(
        parseSearchQuery(expected.term),
        context,
        { source: 'CORPUS' },
      );
      for (let warmup = 0; warmup < 2; warmup += 1)
        await runSearch(client, candidateIndex, dsl, 0);
      const wallMs: number[] = [];
      const tookMs: number[] = [];
      for (let iteration = 0; iteration < 10; iteration += 1) {
        const result = await runSearch(client, candidateIndex, dsl, 0);
        wallMs.push(result.wallMs);
        tookMs.push(result.tookMs);
        prefixWallSamples.push(result.wallMs);
        prefixTookSamples.push(result.tookMs);
      }
      prefixPerformanceRows.push({
        term: expected.term,
        warmups: 2,
        measuredRuns: 10,
        engineWallMs: summary(wallMs),
        engineTookMs: summary(tookMs),
        timeouts: 0,
      });
    }
    const prefixEngineWallSummary = summary(prefixWallSamples);
    const prefixP95Ratio =
      prefixEngineWallSummary.p95 !== null &&
      prefixPerformanceReference.p95Ms > 0
        ? prefixEngineWallSummary.p95 / prefixPerformanceReference.p95Ms
        : null;
    const prefixSuite = {
      source:
        'search-engine-eval2/prefix-equivalence.json frozen 14-query reference',
      queries: prefixRows.length,
      exact: prefixRows.filter((row) => row.exact).length,
      falsePositives: prefixRows.reduce(
        (sum, row) => sum + Number(row.falsePositives),
        0,
      ),
      falseNegatives: prefixRows.reduce(
        (sum, row) => sum + Number(row.falseNegatives),
        0,
      ),
      performance: {
        warmupsPerQuery: 2,
        measuredRunsPerQuery: 10,
        timeouts: 0,
        engineWallMs: prefixEngineWallSummary,
        engineTookMs: summary(prefixTookSamples),
        baselineEval2EngineWallMs: prefixPerformanceReference,
        p95RatioToEval2Baseline: prefixP95Ratio,
        noMajorRegression: prefixP95Ratio !== null && prefixP95Ratio <= 2,
        perQuery: prefixPerformanceRows,
      },
      rows: prefixRows,
    };
    const parityRows: PhraseParityRow[] = [];
    for (let index = 0; index < phrases.length; index += 1) {
      const phrase = phrases[index];
      const ast = createPhraseAst(phrase);
      const dsl = buildSearchQueryDsl(ast, context, { source: 'CORPUS' });
      const candidate = await runSearch(client, candidateIndex, dsl, 30000);
      const referenceDsl = {
        bool: {
          filter: [{ term: { sourceSystem: 'CORPUS' } }],
          must: [
            {
              match_phrase: {
                phraseSequence: phraseSequence(normalizeSearchText(phrase)),
              },
            },
          ],
        },
      };
      const baseline = await runSearch(
        client,
        reference.sourceIndex,
        referenceDsl,
        30000,
      );
      const candidateIds = [...candidate.ids].sort();
      const baselineIds = [...baseline.ids].sort();
      const expected = reference.rows[index];
      const falsePositives = candidateIds.filter(
        (id) => !baselineIds.includes(id),
      );
      const falseNegatives = baselineIds.filter(
        (id) => !candidateIds.includes(id),
      );
      const exact =
        candidate.total === expected.expectedCount &&
        baseline.total === expected.expectedCount &&
        idSetHash(candidateIds) === expected.expectedIdSetSha256 &&
        JSON.stringify(candidateIds) === JSON.stringify(baselineIds);
      parityRows.push({
        index: index + 1,
        queryHash: expected.queryHash,
        expectedCount: expected.expectedCount,
        referenceV2Count: baseline.total,
        candidateV3Count: candidate.total,
        referenceV2IdSetSha256: idSetHash(baselineIds),
        candidateV3IdSetSha256: idSetHash(candidateIds),
        falsePositives: falsePositives.length,
        falseNegatives: falseNegatives.length,
        exact,
      });
    }

    const phraseLatency: Array<{ wallMs: number; tookMs: number }> = [];
    for (const phrase of phrases) {
      const ast = createPhraseAst(phrase);
      const dsl = buildSearchQueryDsl(ast, context, { source: 'CORPUS' });
      await runSearch(client, candidateIndex, dsl, 0);
      await runSearch(client, candidateIndex, dsl, 0);
      const measured = await runSearch(client, candidateIndex, dsl, 0);
      phraseLatency.push({ wallMs: measured.wallMs, tookMs: measured.tookMs });
    }

    const criticalResults: CriticalResult[] = [];
    const criticalPhrases = [
      { id: 'responsabilidad-civil', phrase: 'responsabilidad civil' },
      { id: 'falta-de-servicio', phrase: 'falta de servicio' },
    ];
    for (const critical of criticalPhrases) {
      const ast = createPhraseAst(critical.phrase);
      const dsl = buildSearchQueryDsl(ast, context, { source: 'CORPUS' });
      const profileSample = await runSearch(
        client,
        candidateIndex,
        dsl,
        0,
        true,
      );
      const engineRuns: Array<{ wallMs: number; tookMs: number }> = [];
      for (let iteration = 0; iteration < 32; iteration += 1) {
        const result = await runSearch(client, candidateIndex, dsl, 0);
        if (iteration >= 2)
          engineRuns.push({ wallMs: result.wallMs, tookMs: result.tookMs });
      }
      const product = new OpenSearchSearchSourceAdapter(
        client,
        candidateIndex,
        'CORPUS',
        (query, searchContext, ids) =>
          corpusHydrator.search(query, searchContext, ids),
      );
      const productRuns: number[] = [];
      let productLastProfile: ReturnType<typeof product.getLastSearchProfile> =
        null;
      for (let iteration = 0; iteration < 32; iteration += 1) {
        const result = await product.search(ast, context);
        if (
          result.total !== profileSample.total ||
          result.results.length !== Math.min(20, profileSample.total)
        )
          throw new Error(`CRITICAL_PRODUCT_RESULT_INVALID:${critical.id}`);
        productLastProfile = product.getLastSearchProfile();
        if (iteration >= 2)
          productRuns.push(productLastProfile?.resultPageMs ?? 0);
      }
      criticalResults.push({
        queryId: critical.id,
        phrase: critical.phrase,
        total: profileSample.total,
        warmups: 2,
        measuredRuns: 30,
        engineWallMs: summary(engineRuns.map((row) => row.wallMs)),
        engineTookMs: summary(engineRuns.map((row) => row.tookMs)),
        productLikeAdapterHydrationMs: summary(productRuns),
        lastProductProfile: productLastProfile,
        profileSample: profileSample.profile,
      });
      await product.close();
    }

    const candidateIndexStats = await client.indices.stats({
      index: candidateIndex,
      metric: 'store,docs,segments',
    });
    const baselineIndexStats = await client.indices.stats({
      index: reference.sourceIndex,
      metric: 'store,docs,segments',
    });
    const statsBody = unwrap<Record<string, unknown>>(candidateIndexStats);
    const baselineStatsBody =
      unwrap<Record<string, unknown>>(baselineIndexStats);
    const parity = {
      generatedAt: new Date().toISOString(),
      source:
        'direct OpenSearch v2 legacy phraseSequence versus candidate-v3 product DSL; PostgreSQL adapter hydration benchmark uses the guarded DEV URL',
      sourceIndex: reference.sourceIndex,
      candidateIndex,
      frozenQueryHashOrderExact: true,
      phraseCount: parityRows.length,
      exactIdSets: parityRows.filter((row) => row.exact).length,
      falsePositives: parityRows.reduce(
        (sum, row) => sum + row.falsePositives,
        0,
      ),
      falseNegatives: parityRows.reduce(
        (sum, row) => sum + row.falseNegatives,
        0,
      ),
      criticalRows: parityRows.filter((row) => row.index <= 100),
      allExact:
        parityRows.length === 100 && parityRows.every((row) => row.exact),
    };
    const performance = {
      generatedAt: new Date().toISOString(),
      engine: 'OpenSearch 2.19.6',
      candidateIndex,
      warmupsPerPhrase: 2,
      measuredRunsPerPhrase: 1,
      phrase100OpenSearchTookMs: summary(
        phraseLatency.map((sample) => sample.tookMs),
      ),
      phrase100OpenSearchWallMs: summary(
        phraseLatency.map((sample) => sample.wallMs),
      ),
      timeouts: 0,
      allQueriesCompleted: phraseLatency.length === 100,
      critical: criticalResults,
      prefixSuite,
      candidateStoreStats: statsBody._all ?? null,
      baselineStoreStats: baselineStatsBody._all ?? null,
    };
    const performanceGates = {
      criticalEngineP95UnderOneSecond: criticalResults.every(
        (row) => row.engineWallMs.p95 !== null && row.engineWallMs.p95 < 1000,
      ),
      criticalProductLikeP95UnderOneSecond: criticalResults.every(
        (row) =>
          row.productLikeAdapterHydrationMs.p95 !== null &&
          row.productLikeAdapterHydrationMs.p95 < 1000,
      ),
      phrase100P95UnderOneSecond:
        performance.phrase100OpenSearchWallMs.p95 !== null &&
        performance.phrase100OpenSearchWallMs.p95 < 1000,
      phrase100Timeouts: performance.timeouts,
      prefix14Exact: prefixSuite.exact === 14,
      prefixNoMajorRegression: prefixSuite.performance.noMajorRegression,
    };
    const performanceReport = { ...performance, gates: performanceGates };
    mkdirSync(root, { recursive: true });
    writeFileSync(
      resolve(root, 'phrase-100-v2.json'),
      `${JSON.stringify({ ...reference, candidateV3: parity }, null, 2)}\n`,
    );
    writeFileSync(
      resolve(root, 'prefix-14-v2.json'),
      `${JSON.stringify(
        {
          generatedAt: performance.generatedAt,
          candidateIndex,
          gate: '14/14 exact ID sets; 0 false positives; 0 false negatives; 10 measured prefix runs are compared with the EVAL-2 baseline',
          ...prefixSuite,
          allExact: prefixSuite.exact === 14,
          noMajorRegression: prefixSuite.performance.noMajorRegression,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      resolve(root, 'critical-v2-performance.json'),
      `${JSON.stringify(performanceReport, null, 2)}\n`,
    );
    writeFileSync(
      resolve(root, 'phrase-100-performance-v2.json'),
      `${JSON.stringify({ generatedAt: performance.generatedAt, candidateIndex, openSearchTookMs: performance.phrase100OpenSearchTookMs, openSearchWallMs: performance.phrase100OpenSearchWallMs, warmupsPerPhrase: 2, measuredRunsPerPhrase: 1, timeouts: 0, rows: phrases.map((phrase, index) => ({ index: index + 1, queryHash: reference.rows[index].queryHash, tookMs: phraseLatency[index].tookMs, wallMs: phraseLatency[index].wallMs, exact: parityRows[index].exact })), allExact: parity.allExact }, null, 2)}\n`,
    );
    writeFileSync(
      resolve(root, 'critical-v2-profile.json'),
      `${JSON.stringify({ generatedAt: performance.generatedAt, candidateIndex, profiles: criticalResults.map(({ queryId, profileSample }) => ({ queryId, profileSample })) }, null, 2)}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ candidateIndex, parity, performance: performanceReport }, null, 2)}\n`,
    );
    if (
      !parity.allExact ||
      prefixSuite.exact !== 14 ||
      !prefixSuite.performance.noMajorRegression ||
      performance.phrase100OpenSearchWallMs.p95 === null ||
      performance.phrase100OpenSearchWallMs.p95 >= 1000 ||
      criticalResults.some(
        (row) =>
          row.engineWallMs.p95 === null ||
          row.engineWallMs.p95 >= 1000 ||
          row.productLikeAdapterHydrationMs.p95 === null ||
          row.productLikeAdapterHydrationMs.p95 >= 1000,
      )
    ) {
      process.exitCode = 2;
    }
  } finally {
    await corpusHydrator.close();
    await client.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'CANDIDATE_BENCHMARK_FAILED'}\n`,
  );
  process.exitCode = 1;
});
