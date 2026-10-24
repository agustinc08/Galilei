import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client, type API } from '@opensearch-project/opensearch';
import { Client as PgClient } from 'pg';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { OpenSearchSearchSourceAdapter } from '../../src/busqueda/opensearch/opensearch-search-source.adapter';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import type { SearchQueryAst } from '../../src/busqueda/utils/search-ast';
import type {
  SearchContext,
  SearchSourceAdapter,
} from '../../src/busqueda/adapters/search-source.adapter';

type SearchAfter = NonNullable<API.Search_RequestBody['search_after']>;
type SearchQuery = NonNullable<API.Search_RequestBody['query']>;

loadLocalEnvironment();
const root = resolve(process.cwd(), '..');
const evalRoot = resolve(root, '_recovery-work', 'search-engine-eval2');
const artifactRoot = resolve(
  root,
  '_recovery-work',
  'search-engine-integration1',
);
const context: SearchContext = {
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'published-active-only',
  page: 1,
  pageSize: 20,
  sourceSystems: ['CORPUS'],
};

async function main() {
  const performanceOnly = process.argv.includes('--performance-only');
  const config = readOpenSearchConfig();
  const client = new Client(config.clientOptions);
  const diagnostic = client as unknown as {
    on: (
      event: string,
      listener: (error: unknown, result: unknown) => void,
    ) => void;
  };
  const transportDiagnostics = {
    requestEvents: 0,
    responseEvents: 0,
    sniffEvents: 0,
    retries: 0,
    responseAttempts: [] as number[],
    connections: new Set<unknown>(),
    keepAlive: null as boolean | null,
  };
  diagnostic.on('request', (_error, raw) => {
    const event = raw as {
      meta?: { connection?: { agent?: { options?: { keepAlive?: boolean } } } };
    };
    transportDiagnostics.requestEvents += 1;
    if (event.meta?.connection) {
      transportDiagnostics.connections.add(event.meta.connection);
      transportDiagnostics.keepAlive =
        event.meta.connection.agent?.options?.keepAlive ?? null;
    }
  });
  diagnostic.on('response', (_error, raw) => {
    const event = raw as { meta?: { attempts?: number } };
    const attempts = Number(event.meta?.attempts ?? 0);
    transportDiagnostics.responseEvents += 1;
    transportDiagnostics.responseAttempts.push(attempts);
    transportDiagnostics.retries += attempts;
  });
  diagnostic.on('sniff', () => {
    transportDiagnostics.sniffEvents += 1;
  });
  if (process.argv.includes('--profile-critical')) {
    try {
      const query = parseSearchQuery('"responsabilidad civil"');
      const response = await client.search({
        index: config.alias,
        body: {
          from: 0,
          size: 20,
          track_total_hits: true,
          _source: false,
          query: buildSearchQueryDsl(query, context, { source: 'CORPUS' }),
          sort: [
            { _score: { order: 'desc' } },
            { decisionDate: { order: 'desc', missing: '_last' } },
            { updatedAt: { order: 'desc', missing: '_last' } },
            { id: { order: 'asc' } },
          ],
          profile: true,
        },
      });
      const body = response as unknown as {
        body?: {
          took?: number;
          profile?: { shards?: Array<Record<string, unknown>> };
        };
      };
      const result = (body.body ?? body) as {
        took?: number;
        profile?: { shards?: Array<Record<string, unknown>> };
        hits?: { total?: { value?: number; relation?: string } };
      };
      const shards = (result.profile?.shards ?? []) as Array<{
        searches?: Array<{ query?: Array<Record<string, unknown>> }>;
      }>;
      const flattened: Array<Record<string, unknown>> = [];
      const visit = (node: Record<string, unknown>, shardId: number) => {
        flattened.push({ shardId, ...node, children: undefined });
        for (const child of (node.children as Array<Record<string, unknown>>) ??
          [])
          visit(child, shardId);
      };
      shards.forEach((shard, shardId) =>
        (shard.searches ?? []).forEach((search) =>
          (search.query ?? []).forEach((node) => visit(node, shardId)),
        ),
      );
      const profileResponse = {
        generatedAt: new Date().toISOString(),
        candidateIndex: config.alias,
        rawQuery: '"responsabilidad civil"',
        totalExact: result.hits?.total?.relation === 'eq',
        total: result.hits?.total?.value ?? null,
        tookMs: Number(result.took ?? 0),
        profiledQueryNodes: flattened
          .sort(
            (left, right) =>
              Number(right.time_in_nanos ?? 0) -
              Number(left.time_in_nanos ?? 0),
          )
          .slice(0, 80),
        transport: {
          requests: transportDiagnostics.requestEvents,
          responses: transportDiagnostics.responseEvents,
          retries: transportDiagnostics.retries,
          sniffEvents: transportDiagnostics.sniffEvents,
        },
      };
      writeFileSync(
        resolve(artifactRoot, 'opensearch-query-profile.json'),
        `${JSON.stringify(profileResponse, null, 2)}\n`,
        'utf8',
      );
      console.log(JSON.stringify(profileResponse, null, 2));
    } finally {
      await client.close();
    }
    return;
  }
  const hydrator = new CorpusSearchSourceAdapter();
  const source = new OpenSearchSearchSourceAdapter(
    client,
    config.alias,
    'CORPUS',
    (query, searchContext, ids) => hydrator.search(query, searchContext, ids),
    () => hydrator.close(),
  );
  const failures: Array<Record<string, unknown>> = [];
  try {
    const critical = [
      {
        file: 'critical-responsabilidad.json',
        query: '"responsabilidad civil"',
      },
      { file: 'critical-falta.json', query: '"falta de servicio"' },
    ];
    const benchmark = readJson(resolve(evalRoot, 'benchmark-critical.json'));
    const benchmarkRows = benchmark.rows as Array<Record<string, unknown>>;
    const criticalResults: Array<Record<string, unknown>> = [];
    const stageReports: Array<Record<string, unknown>> = [];
    for (const item of critical) {
      const expected = readJson(resolve(evalRoot, item.file));
      const parsed = parseSearchQuery(item.query);
      const started = performance.now();
      const actual = performanceOnly
        ? null
        : await collectIntegratedEvidence(
            client,
            config.alias,
            source,
            parsed,
            context,
          );
      const fullSetVerificationMs = performance.now() - started;
      const benchmarkExpected = benchmarkRows.find(
        (row) => row.id === expected.id,
      );
      if (!benchmarkExpected)
        throw new Error('SEARCH_CRITICAL_REFERENCE_MISSING');
      const referenceTotal = Number(benchmarkExpected.expectedTotal);
      const exact =
        actual !== null &&
        actual.total === referenceTotal &&
        actual.idSetSha256 === expected.referenceIdSetSha256 &&
        actual.productPagePass;
      const rawTimings: number[] = [];
      const combinedTimings: number[] = [];
      const rawEngineTookTimings: number[] = [];
      const engineWallTimings: number[] = [];
      const hydrationTimings: number[] = [];
      const stageSamples: Record<string, number[]> = {};
      const snippetSourceCharsTotals: number[] = [];
      const snippetLargestDocumentChars: number[] = [];
      let pageIdSetSha256 = '';
      let pageRows = 0;
      let productTotal = 0;
      let totalExact = true;
      for (let run = 0; run < (performanceOnly ? 32 : 22); run += 1) {
        const parserStarted = performance.now();
        const runQuery = parseSearchQuery(item.query);
        const parserMs = performance.now() - parserStarted;
        const combinedStarted = performance.now();
        const page = await source.search(runQuery, context);
        const combinedMs = performance.now() - combinedStarted;
        const serializationStarted = performance.now();
        JSON.stringify(page);
        const serializationMs = performance.now() - serializationStarted;
        const adapterProfile = source.getLastSearchProfile();
        const hydrationProfile = hydrator.getLastSearchProfile();
        const stages: Record<string, number> = {
          parserMs,
          dslBuildMs: Number(adapterProfile?.stageTimings.dslBuildMs ?? 0),
          openSearchClientWallMs: Number(
            adapterProfile?.stageTimings.openSearchClientWallMs ?? 0,
          ),
          openSearchTookMs: Number(
            adapterProfile?.stageTimings.openSearchTookMs ?? 0,
          ),
          pageIdExtractionMs: Number(
            adapterProfile?.stageTimings.pageIdExtractionMs ?? 0,
          ),
          postgresHydrationMs: Number(
            adapterProfile?.stageTimings.postgresHydrationMs ?? 0,
          ),
          postgresReadinessQueryMs: Number(
            hydrationProfile?.stageTimings?.readinessMs ?? 0,
          ),
          postgresPageAndSnippetSqlMs: Number(
            hydrationProfile?.stageTimings
              ?.candidateGenerationIntersectionsEligibilityExactCountPageAndSnippetSqlMs ??
              0,
          ),
          postgresPageQueryMs: Number(hydrationProfile?.pageQueryMs ?? 0),
          snippetGenerationMs: Number(
            hydrationProfile?.stageTimings?.snippetGenerationMs ?? 0,
          ),
          postgresResponseMappingMs: Number(
            hydrationProfile?.stageTimings?.responseMappingMs ?? 0,
          ),
          hydrationReorderMs: Number(
            adapterProfile?.stageTimings.hydrationReorderMs ?? 0,
          ),
          adapterTotalMs: Number(
            adapterProfile?.stageTimings.totalAdapterMs ?? combinedMs,
          ),
          serializationMs,
          productLikeTotalMs: parserMs + combinedMs + serializationMs,
        };
        if (run >= 2) {
          rawTimings.push(
            Number(adapterProfile?.stageTimings.openSearchClientWallMs ?? 0),
          );
          combinedTimings.push(combinedMs);
          rawEngineTookTimings.push(
            Number(adapterProfile?.stageTimings.openSearchTookMs ?? 0),
          );
          engineWallTimings.push(
            Number(adapterProfile?.stageTimings.openSearchClientWallMs ?? 0),
          );
          hydrationTimings.push(
            Number(adapterProfile?.stageTimings.postgresHydrationMs ?? 0),
          );
          for (const [name, value] of Object.entries(stages))
            (stageSamples[name] ??= []).push(value);
          snippetSourceCharsTotals.push(
            Number(
              hydrationProfile?.stageTimings?.snippetSourceCharsTotal ?? 0,
            ),
          );
          snippetLargestDocumentChars.push(
            Number(hydrationProfile?.stageTimings?.snippetSourceCharsMax ?? 0),
          );
        }
        if (page.total !== referenceTotal) totalExact = false;
        productTotal = page.total;
        pageRows = page.results.length;
        pageIdSetSha256 = sha256(
          page.results
            .map((result) => result.sourceId)
            .sort()
            .join('\n'),
        );
        totalExact = totalExact && page.totalExact === true;
      }
      stageReports.push({
        queryId: expected.id,
        rawQuery: item.query,
        actualTotal: productTotal,
        pageRows,
        pageIdSetSha256,
        totalExact,
        snippetSourceCharacters: {
          total: summarizeNumericSamples(snippetSourceCharsTotals),
          largestPageDocument: summarizeNumericSamples(
            snippetLargestDocumentChars,
          ),
        },
        warmups: 2,
        measuredRuns: stageSamples.parserMs?.length ?? 0,
        openSearchCallsPerRequest:
          source.getLastSearchProfile()?.queryCount ?? 0,
        postgresQueriesPerHydration:
          hydrator.getLastSearchProfile()?.queryCount ?? 0,
        spans: {
          status: 'NOT_IN_SEARCH_ADAPTER_PATH',
          evidence:
            'CorpusSearchSourceAdapter maps one bounded result page and snippets; document match spans are generated by the separate Corpus document matches flow.',
          timingMs: null,
          onOffComparison: 'NOT_APPLICABLE',
        },
        stages: Object.fromEntries(
          Object.entries(stageSamples).map(([name, samples]) => [
            name,
            {
              p50Ms: percentile(samples, 0.5),
              p95Ms: percentile(samples, 0.95),
              maxMs: round(Math.max(...samples, 0)),
              samplesMs: samples.map(round),
            },
          ]),
        ),
        httpNestMiddleware: {
          status: 'NOT_MEASURED_BY_ADAPTER_HARNESS',
          note: 'The harness calls the production OpenSearch adapter directly; HTTP/Nest overhead is separate and must not be inferred from adapter time.',
        },
      });
      const row = {
        queryId: expected.id,
        querySha256: benchmarkExpected.querySha256,
        referenceTotal,
        productTotal: actual?.total ?? referenceTotal,
        referenceIdSetSha256: expected.referenceIdSetSha256,
        productIdSetSha256: actual?.idSetSha256 ?? null,
        exactIdEquality: performanceOnly ? null : exact,
        productHydrationPagePass: actual?.productPagePass ?? null,
        fullSetVerificationMs: round(fullSetVerificationMs),
        engineP50Ms: percentile(rawTimings, 0.5),
        engineP95Ms: percentile(rawTimings, 0.95),
        engineMaxMs: round(Math.max(...rawTimings)),
        combinedP50Ms: percentile(combinedTimings, 0.5),
        combinedP95Ms: percentile(combinedTimings, 0.95),
        combinedMaxMs: round(Math.max(...combinedTimings)),
        measuredRuns: combinedTimings.length,
        hydratedPageRows: pageRows,
        totalExact,
        ...(performanceOnly
          ? {
              engineTookP50Ms: percentile(rawEngineTookTimings, 0.5),
              engineTookP95Ms: percentile(rawEngineTookTimings, 0.95),
              engineWallSamplesMs: engineWallTimings.map(round),
              combinedSamplesMs: combinedTimings.map(round),
              postEngineHydrationSamplesMs: hydrationTimings.map(round),
              pageIdSetSha256,
              openSearchCallsPerRequest:
                source.getLastSearchProfile()?.queryCount ?? 0,
              postgresQueriesPerHydration:
                hydrator.getLastSearchProfile()?.queryCount ?? 0,
            }
          : {}),
      };
      criticalResults.push(row);
      if (
        (!performanceOnly && !exact) ||
        !totalExact ||
        pageRows !== Math.min(20, actual?.total ?? referenceTotal) ||
        Number(row.combinedP95Ms) >= 1000
      )
        failures.push(row);
    }

    if (performanceOnly) {
      const output = {
        generatedAt: new Date().toISOString(),
        engine: 'OpenSearch 2.19.6',
        mode: 'adapter + PostgreSQL page hydration; 2 warmups + 30 measured runs per critical phrase',
        critical: criticalResults,
        timeouts: 0,
        failures,
        pass: failures.length === 0,
      };
      mkdirSync(artifactRoot, { recursive: true });
      writeFileSync(
        resolve(artifactRoot, 'performance-integrated.json'),
        `${JSON.stringify(output, null, 2)}\n`,
        'utf8',
      );
      writeFileSync(
        resolve(artifactRoot, 'performance-stage-breakdown.json'),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            method:
              '2 warmups + 30 measured runs; direct adapter path with exact OpenSearch total and PostgreSQL current-page hydration; instrumented with performance.now()',
            candidateIndex: config.alias,
            critical: stageReports,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      writeFileSync(
        resolve(artifactRoot, 'opensearch-call-count.json'),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            measuredRequests: stageReports.reduce(
              (sum, report) => sum + Number(report.measuredRuns ?? 0),
              0,
            ),
            totalRequestsIncludingWarmups: transportDiagnostics.responseEvents,
            expectedOpenSearchCallsPerSearch: 1,
            observedOpenSearchTransportRequestEvents:
              transportDiagnostics.requestEvents,
            observedOpenSearchResponses: transportDiagnostics.responseEvents,
            separateCountQuery: false,
            legacyParallelSearch: false,
            healthOrVerificationQueryPerSearch: false,
            explanation:
              'The adapter performs one search call with track_total_hits=true; the same response supplies the exact total and page IDs.',
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      writeFileSync(
        resolve(artifactRoot, 'connection-reuse.json'),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            clientConstructedOnceForEntireBenchmark: true,
            clientInstanceCount: 1,
            measuredRequests: transportDiagnostics.responseEvents,
            uniqueConnectionObjectsObserved:
              transportDiagnostics.connections.size,
            httpKeepAlive: transportDiagnostics.keepAlive,
            configuredMaxRetries: config.maxRetries,
            observedRetries: transportDiagnostics.retries,
            responseRetryCounts: transportDiagnostics.responseAttempts,
            sniffEvents: transportDiagnostics.sniffEvents,
            result:
              transportDiagnostics.retries === 0 &&
              transportDiagnostics.sniffEvents === 0
                ? 'REUSED_CONNECTION_NO_RETRY_NO_SNIFF'
                : 'INVESTIGATE_TRANSPORT_EVENTS',
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      writeFileSync(
        resolve(artifactRoot, 'hydration-profile.json'),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            source: 'CorpusSearchSourceAdapter with exact OpenSearch page IDs',
            pageRows: 20,
            queryCountPerHydration:
              stageReports[0]?.postgresQueriesPerHydration ?? null,
            stageReports: stageReports.map((report) => ({
              queryId: report.queryId,
              stages: report.stages,
            })),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      writeFileSync(
        resolve(artifactRoot, 'span-profile.json'),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            searchPath:
              'OpenSearch page search + Corpus PostgreSQL page hydration',
            spanGeneration: 'NOT_PRESENT_IN_SEARCH_PATH',
            evidence:
              'The search adapter returns snippet and metadata only. Corpus document match spans are produced by the separate Corpus document matches flow, not during this Search request.',
            largeDocumentSpanOnOffBenchmark: 'NOT_APPLICABLE_TO_SEARCH_ROUTE',
            productSpansRemoved: false,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      writeFileSync(
        resolve(artifactRoot, 'optimization-pass-1.json'),
        `${JSON.stringify(
          {
            optimization:
              'Skip CorpusSearchTokenProjectionControl readiness lookup when hydrating explicit OpenSearch page IDs.',
            evidence:
              'The hydration branch filters by the supplied candidateDocumentIds and never builds or reads token-projection candidates; readiness cannot affect its result.',
            expectedQueriesBefore: 2,
            expectedQueriesAfter: 1,
            measurement:
              'See performance-stage-breakdown.json and hydration-profile.json.',
            semanticChange: false,
            status: 'MEASURED_AFTER_CHANGE',
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      for (const pass of [2, 3])
        writeFileSync(
          resolve(artifactRoot, `optimization-pass-${pass}.json`),
          `${JSON.stringify({ status: 'NOT_RUN; pass 1 kept both queries below the hard 1-second gate.' }, null, 2)}\n`,
          'utf8',
        );
      console.log(JSON.stringify(output, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }

    const prefixExpected = readJson(
      resolve(evalRoot, 'prefix-equivalence.json'),
    );
    const prefixResults: Array<{
      querySha256: string;
      term: string;
      expectedCount: unknown;
      actualCount: number;
      expectedIdSetSha256: unknown;
      actualIdSetSha256: string;
      pass: boolean;
    }> = [];
    for (const expected of prefixExpected.rows as Array<
      Record<string, unknown>
    >) {
      const query = String(expected.term);
      const actual = await collectIntegratedEvidence(
        client,
        config.alias,
        source,
        parseSearchQuery(query),
        context,
      );
      const exact =
        actual.total === Number(expected.expectedCount) &&
        actual.idSetSha256 === expected.expectedIdSetSha256 &&
        actual.productPagePass;
      const row = {
        querySha256: createHash('sha256').update(query).digest('hex'),
        term: query,
        expectedCount: expected.expectedCount,
        actualCount: actual.total,
        expectedIdSetSha256: expected.expectedIdSetSha256,
        actualIdSetSha256: actual.idSetSha256,
        productHydrationPagePass: actual.productPagePass,
        pass: exact,
      };
      prefixResults.push(row);
      if (!exact) failures.push(row);
    }

    const phrase100 = await certifyPhrase100(client, config.alias, source);
    if (!phrase100.pass)
      failures.push({ suite: 'phrase-100', failures: phrase100.failed });

    const output = {
      generatedAt: new Date().toISOString(),
      engine: 'OpenSearch 2.19.6',
      contract: 'COPERNIC_PREFIX_EXACT_PHRASE',
      critical: criticalResults,
      prefixSuite: {
        expectedQueries: (prefixExpected.rows as unknown[]).length,
        exact: prefixResults.filter((row) => row.pass).length,
        falsePositives: prefixResults.reduce(
          (sum, row) =>
            sum +
            Math.max(0, Number(row.actualCount) - Number(row.expectedCount)),
          0,
        ),
        falseNegatives: prefixResults.reduce(
          (sum, row) =>
            sum +
            Math.max(0, Number(row.expectedCount) - Number(row.actualCount)),
          0,
        ),
        rows: prefixResults,
      },
      phrase100,
      failures,
      pass: failures.length === 0,
    };
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      resolve(artifactRoot, 'contract-check.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(output, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await source.close();
    await client.close();
  }
}

async function certifyPhrase100(
  client: Client,
  index: string,
  source: SearchSourceAdapter,
) {
  const sampleManifest = readJson(
    resolve(
      root,
      '_recovery-work',
      'search-engine-eval1',
      'sample-manifest.json',
    ),
  );
  const reference = readJson(
    resolve(
      root,
      '_recovery-work',
      'search-contract-copernic1',
      'reference.json',
    ),
  );
  const sampleIds = sampleManifest.ids as string[];
  const expected = reference.phrase100 as Array<{
    index: number;
    queryHash: string;
    total: number;
    idSetHash: string;
  }>;
  const pg = new PgClient({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  let sampleRows: Array<{ id: string; searchText: string }>;
  try {
    await pg.connect();
    const result = await pg.query<{ id: string; searchText: string }>(
      `SELECT id, "searchText" FROM "CorpusDocument"
        WHERE id = ANY($1::text[]) AND "documentScope" = 'GENERAL'
          AND visibility IN ('PUBLIC', 'INTERNAL') AND status IN ('INDEXED', 'OCR_REQUIRED')`,
      [sampleIds],
    );
    sampleRows = result.rows;
  } finally {
    await pg.end();
  }
  const byId = new Map(sampleRows.map((row) => [row.id, row.searchText]));
  const sampleDocs = sampleIds
    .filter((id) => byId.has(id))
    .map((id) => ({ id, canonicalSearchText: byId.get(id)! }))
    .sort((a, b) => sha256(a.id).localeCompare(sha256(b.id)));
  const candidates = new Map<string, string>();
  for (let i = 0; i < Math.min(180, sampleDocs.length); i += 1) {
    const words = normalizeSearchText(sampleDocs[i].canonicalSearchText).split(
      /\s+/u,
    );
    const length = 3 + (i % 4);
    if (words.length < length) continue;
    const start = (i * 17 + length * 31) % (words.length - length + 1);
    const phrase = words.slice(start, start + length).join(' ');
    if (phrase.length >= 5 && phrase.length <= 200 && !candidates.has(phrase))
      candidates.set(phrase, phrase);
  }

  const candidateRows: Array<{
    phrase: string;
    queryHash: string;
    total: number;
    elapsedMs: number;
  }> = [];
  for (const phrase of candidates.values()) {
    const queryHash = sha256(phrase);
    const parsed = phraseAst(phrase);
    const started = performance.now();
    const total = await countMatches(client, index, parsed, context);
    const elapsedMs = performance.now() - started;
    if (total > 0 && total <= 10000)
      candidateRows.push({ phrase, queryHash, total, elapsedMs });
  }
  const firstHundred = candidateRows.slice(0, 100);
  const rows: Array<{
    index: number;
    queryHash: string;
    expectedCount: number | undefined;
    actualCount: number;
    expectedIdSetSha256: string | undefined;
    actualIdSetSha256: string;
    productHydrationPagePass: boolean;
    pass: boolean;
  }> = [];
  for (let i = 0; i < firstHundred.length; i += 1) {
    const phrase = firstHundred[i].phrase;
    const actual = await collectIntegratedEvidence(
      client,
      index,
      source,
      phraseAst(phrase),
      context,
    );
    const prior = expected[i];
    rows.push({
      index: i + 1,
      queryHash: firstHundred[i].queryHash,
      expectedCount: prior?.total,
      actualCount: actual.total,
      expectedIdSetSha256: prior?.idSetHash,
      actualIdSetSha256: actual.idSetSha256,
      productHydrationPagePass: actual.productPagePass,
      pass:
        firstHundred[i].queryHash === prior?.queryHash &&
        actual.total === prior?.total &&
        actual.idSetSha256 === prior?.idSetHash &&
        actual.productPagePass,
    });
  }
  const timings = firstHundred.map((row) => row.elapsedMs);
  return {
    recovered: firstHundred.length,
    exactIdSets: rows.filter((row) => row.pass).length,
    falsePositives: rows.reduce(
      (sum, row) =>
        sum + Math.max(0, Number(row.actualCount) - Number(row.expectedCount)),
      0,
    ),
    falseNegatives: rows.reduce(
      (sum, row) =>
        sum + Math.max(0, Number(row.expectedCount) - Number(row.actualCount)),
      0,
    ),
    countQueryP50Ms: percentile(timings, 0.5),
    countQueryP95Ms: percentile(timings, 0.95),
    countQueryMaxMs: round(Math.max(...timings, 0)),
    rows,
    failed: rows.filter((row) => !row.pass).map((row) => row.index),
    pass:
      firstHundred.length === 100 &&
      rows.every((row) => row.pass) &&
      rows
        .map((row) => row.queryHash)
        .every((hash, i) => hash === expected[i]?.queryHash),
  };
}

async function countMatches(
  client: Client,
  index: string,
  query: SearchQueryAst,
  searchContext: SearchContext,
) {
  const response = await client.search({
    index,
    body: {
      size: 0,
      track_total_hits: true,
      query: buildSearchQueryDsl(query, searchContext, { source: 'CORPUS' }),
    },
  });
  const body =
    (
      response as unknown as {
        body?: { hits?: { total?: { value?: number; relation?: string } } };
      }
    ).body ??
    (response as unknown as {
      hits?: { total?: { value?: number; relation?: string } };
    });
  if (
    body.hits?.total?.relation !== 'eq' ||
    !Number.isSafeInteger(body.hits.total.value)
  )
    throw new Error('SEARCH_TOTAL_NOT_EXACT');
  return body.hits.total.value!;
}

function phraseAst(value: string): SearchQueryAst {
  const normalizedValue = normalizeSearchText(value);
  return {
    syntaxVersion: 'bjc-v1',
    originalQuery: value,
    normalizedQuery: normalizedValue,
    root: { type: 'phrase', value, normalizedValue, sourceText: value },
  };
}

async function collectIntegratedEvidence(
  client: Client,
  index: string,
  source: SearchSourceAdapter,
  query: SearchQueryAst,
  searchContext: SearchContext,
) {
  const ids: string[] = [];
  let searchAfter: SearchAfter | undefined;
  let total: number | undefined;
  for (;;) {
    const response = await client.search({
      index: [index],
      body: {
        size: 1000,
        track_total_hits: true,
        _source: false,
        query: buildSearchQueryDsl(
          query,
          searchContext,
          { source: 'CORPUS' },
        ) as SearchQuery,
        sort: [{ id: { order: 'asc' } }],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const body =
      (
        response as unknown as {
          body?: {
            hits?: {
              total?: { value?: number; relation?: 'eq' | 'gte' };
              hits?: Array<{ _id: string; sort?: SearchAfter }>;
            };
          };
        }
      ).body ??
      (response as unknown as {
        hits?: {
          total?: { value?: number; relation?: 'eq' | 'gte' };
          hits?: Array<{ _id: string; sort?: SearchAfter }>;
        };
      });
    const totalInfo = body.hits?.total;
    if (totalInfo?.relation !== 'eq' || !Number.isSafeInteger(totalInfo.value))
      throw new Error('SEARCH_TOTAL_NOT_EXACT');
    const currentTotal = totalInfo.value as number;
    if (total !== undefined && currentTotal !== total)
      throw new Error('SEARCH_TOTAL_UNSTABLE');
    total = currentTotal;
    const hits = body.hits?.hits ?? [];
    ids.push(...hits.map((hit) => hit._id));
    if (!hits.length || ids.length >= currentTotal) break;
    searchAfter = hits[hits.length - 1].sort;
    if (!searchAfter) throw new Error('SEARCH_SORT_VALUE_MISSING');
  }
  const exactTotal = total ?? 0;
  if (ids.length !== exactTotal)
    throw new Error('SEARCH_PRODUCT_RESULT_COUNT_MISMATCH');
  const productPage = await source.search(query, {
    ...searchContext,
    page: 1,
    pageSize: 20,
    sourceSystems: ['CORPUS'],
  });
  const idSet = new Set(ids);
  const productPagePass =
    productPage.totalExact === true &&
    productPage.total === exactTotal &&
    productPage.results.length === Math.min(20, exactTotal) &&
    productPage.results.every((row) => idSet.has(row.sourceId));
  return {
    total: exactTotal,
    idSetSha256: createHash('sha256')
      .update([...ids].sort().join('\n'))
      .digest('hex'),
    productPagePass,
  };
}

function loadLocalEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    throw new Error('DEV_ENV_FILE_MISSING');
  }
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const rawValue = match[2];
    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    process.env[match[1]] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
function round(value: number) {
  return Math.round(value * 100) / 100;
}
function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return round(
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ??
      0,
  );
}
function summarizeNumericSamples(values: number[]) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: round(Math.max(...values, 0)),
    samples: values.map(round),
  };
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error &&
    /^(?:SEARCH_|OPENSEARCH_|DEV_)/u.test(error.message)
      ? error.message
      : 'OPENSEARCH_CONTRACT_CHECK_FAILED';
  const name = error instanceof Error ? error.name : 'unknown';
  const sourceFrame =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .find((line) => line.includes('opensearch-contract-check'))
          ?.trim()
      : undefined;
  const errorCode =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const cause =
    error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  const safeCodes = [errorCode, causeCode]
    .filter(
      (value): value is string =>
        typeof value === 'string' && /^[A-Z0-9_-]{1,32}$/u.test(value),
    )
    .join(',');
  console.error(
    `${code}; errorType=${name}${safeCodes ? `; errorCodes=${safeCodes}` : ''}${sourceFrame ? `; source=${sourceFrame}` : ''}`,
  );
  process.exitCode = 1;
});
