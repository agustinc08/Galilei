import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { BusquedaService } from '../../src/busqueda/busqueda.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';

type GoldenCase = {
  id: string;
  query: string;
  expectedDocumentIds: string[];
  forbiddenDocumentIds: string[];
  expectedOrdering: string[];
};

type GoldenHttpBody = {
  federated?: {
    results?: Array<{ sourceId?: string }>;
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
  };
};

const grammarDocuments = [
  {
    label: 'acción niño',
    text: 'zzspraccion acción zzsprniño niño zzsprresponsabilidad zzsprcivil responsabilidad civil zzspralpha primero',
  },
  {
    label: 'accion nino',
    text: 'zzspraccion accion zzsprnino nino zzsprresponsabilidad zzsprcivil responsabilidad civil zzsprbeta segundo',
  },
  {
    label: 'niño daño',
    text: 'zzsprniño niño zzsprdaño daño zzsprzero 0 zzspra a zzsprarticulo artículo 12345/2026',
  },
  {
    label: 'nino daños',
    text: 'zzsprnino nino zzsprdanos daños zzsprzero 0 zzspra a zzspradministrativo derecho',
  },
  {
    label: 'responsabilidad civil repeated',
    text: 'zzsprresponsabilidad zzsprcivil responsabilidad civil zzsprresponsabilidad responsabilidad',
  },
  {
    label: 'acción apelación',
    text: 'zzspraccion acción zzsprcivil civil zzsprnarrow apelación 2026 111',
  },
  {
    label: 'responsabilidad penal',
    text: 'zzsprresponsabilidad responsabilidad zzsprpenal penal zzspraudiencia audiencia',
  },
  {
    label: 'OCR text',
    text: 'zzsprocr zzsprreconocido texto reconocido automáticamente',
  },
  {
    label: 'phrase native',
    text: 'zzsprphrase zzsprresponsabilidad zzsprcivil responsabilidad civil',
  },
  {
    label: 'punctuated phrase',
    text: 'zzsprpunct zzsprresponsabilidad responsabilidad, civil',
  },
  {
    label: 'line break phrase',
    text: 'zzsprline zzsprlinebreak line\nbreak phrase target',
  },
  {
    label: 'case and numeric identifiers',
    text: 'zzsprcase zzsprciv12345 CIV 12345/2026 Sala H artículo 1 111 2026',
  },
  { label: 'civilización prefix positive', text: 'civilización' },
  { label: 'incivil boundary negative', text: 'incivil' },
  { label: 'responsabilidades prefix positive', text: 'responsabilidades' },
  { label: 'irresponsabilidad boundary negative', text: 'irresponsabilidad' },
  { label: 'exact responsibility civil phrase', text: 'responsabilidad civil' },
  {
    label: 'embedded phrase boundary negative',
    text: 'superresponsabilidad civilizado',
  },
] as const;

loadLocalEnvironment();

async function main() {
  const prisma = new PrismaService();
  const runtime = new OpenSearchRuntimeService();
  let hydrator: CorpusSearchSourceAdapter | undefined;
  const runId = `${Date.now()}_${process.pid}`;
  const ids = grammarDocuments.map(
    (_, index) => `opensearch_int1_${runId}_g${String(index).padStart(3, '0')}`,
  );
  const paginationIds = Array.from(
    { length: 325 },
    (_, index) => `opensearch_int1_${runId}_p${String(index).padStart(3, '0')}`,
  );
  const allIds = [...ids, ...paginationIds];
  const artifactRoot = resolve(
    process.env.BJC_SEARCH_V4_ARTIFACT_ROOT ??
      resolve(
        process.cwd(),
        '..',
        '..',
        '_recovery-work',
        'search-engine-integration1',
      ),
  );
  const context: SearchContext = {
    visibility: 'INTERNAL',
    dialect: 'modern',
    publicationPolicy: 'published-active-only',
    page: 1,
    pageSize: 100,
    sourceSystems: ['CORPUS'],
    filters: { tipoFallo: 'OPENSEARCH-INT1-SYNTHETIC' },
  };
  let runtimeStarted = false;
  let collectionId: string | undefined;
  let httpApp: { app: INestApplication; baseUrl: string } | undefined;
  try {
    assertDevDatabase(process.env.DATABASE_URL);
    await prisma.$connect();
    const goldenTokensByDocument = ids.map(() => [] as string[]);
    for (let tokenIndex = 0; tokenIndex < 300; tokenIndex += 1) {
      const token = `zzsprintgoldtoken${alphaCode(tokenIndex)}`;
      for (
        let documentIndex = 0;
        documentIndex < ids.length;
        documentIndex += 1
      ) {
        if ((tokenIndex * 7 + documentIndex * 5) % 12 < 1 + (tokenIndex % 5))
          goldenTokensByDocument[documentIndex].push(token);
      }
    }
    const timestamp = new Date('2020-01-01T00:00:00.000Z');
    const data = [
      ...grammarDocuments.map((document, index) => ({
        id: ids[index],
        title: `Synthetic OpenSearch INT-1 ${document.label}`,
        documentType: 'OPENSEARCH-INT1-SYNTHETIC',
        jurisdiction: 'CIVIL',
        visibility: 'INTERNAL',
        documentScope: 'GENERAL' as const,
        status: 'INDEXED',
        searchText: normalizeSearchText(
          document.text,
          ...goldenTokensByDocument[index],
        ),
        decisionDate: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      ...paginationIds.map((id, index) => ({
        id,
        title: `Synthetic OpenSearch INT-1 pagination ${index}`,
        documentType: 'OPENSEARCH-INT1-SYNTHETIC',
        jurisdiction: 'CIVIL',
        visibility: 'INTERNAL',
        documentScope: 'GENERAL' as const,
        status: 'INDEXED',
        searchText: `zzsprpagination stable synthetic result ${String(index).padStart(3, '0')}`,
        decisionDate: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    ];
    await prisma.corpusDocument.createMany({ data });
    const collection = await prisma.digestoCollection.create({
      data: {
        name: `OpenSearch INT-1 ${runId}`,
        normalized: `opensearch-int1-${runId}`.toLowerCase(),
      },
    });
    collectionId = collection.id;
    await prisma.digestoCollectionMembership.createMany({
      data: allIds.map((documentId) => ({
        collectionId: collection.id,
        documentId,
      })),
    });

    runtime.onModuleInit();
    runtimeStarted = true;
    const corpusHydrator = new CorpusSearchSourceAdapter();
    hydrator = corpusHydrator;
    const productSearch = runtime.createSource(
      'CORPUS',
      (query, searchContext, candidateIds) =>
        corpusHydrator.search(query, searchContext, candidateIds),
      () => corpusHydrator.close(),
    );
    await waitForOutbox(runtime);
    httpApp = await createHttpApp();
    httpApp.app.get(BusquedaService).trackAdvancedV2 = () => undefined;

    const cases = buildGoldenCases(ids);
    const rows: Array<Record<string, unknown>> = [];
    const failures: Array<Record<string, unknown>> = [];
    const timings: number[] = [];
    for (const testCase of cases) {
      const started = performance.now();
      const result = await productSearch.search(
        parseSearchQuery(testCase.query),
        context,
      );
      const elapsedMs = round(performance.now() - started);
      timings.push(elapsedMs);
      const actualIds = result.results.map((row) => row.sourceId).sort();
      const orderedIds = result.results.map((row) => row.sourceId);
      const pass =
        JSON.stringify(actualIds) ===
          JSON.stringify(testCase.expectedDocumentIds) &&
        result.total === testCase.expectedDocumentIds.length &&
        result.totalExact === true;
      const row = {
        id: testCase.id,
        querySha256: sha256(testCase.query),
        expectedCount: testCase.expectedDocumentIds.length,
        actualCount: result.total,
        expectedIdSetSha256: idHash(testCase.expectedDocumentIds),
        actualIdSetSha256: idHash(actualIds),
        orderMatches:
          JSON.stringify(orderedIds) ===
          JSON.stringify(testCase.expectedOrdering),
        forbiddenIdsReturned: orderedIds.filter((id) =>
          testCase.forbiddenDocumentIds.includes(id),
        ).length,
        totalExact: result.totalExact,
        elapsedMs,
        pass,
      };
      rows.push(row);
      if (!pass) failures.push(row);
    }

    const httpRows: Array<Record<string, unknown>> = [];
    const httpFailures: Array<Record<string, unknown>> = [];
    const httpTimings: number[] = [];
    for (const testCase of cases) {
      const started = performance.now();
      let responseStatus = 0;
      let result: GoldenHttpBody['federated'] | undefined;
      let timedOut = false;
      try {
        const url = new URL('/api/busqueda/avanzada', httpApp.baseUrl);
        url.searchParams.set('q', testCase.query);
        url.searchParams.set('digestoCollectionId', collection.id);
        url.searchParams.set('page', '1');
        url.searchParams.set('pageSize', '100');
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        responseStatus = response.status;
        const body = (await response.json()) as GoldenHttpBody;
        result = body.federated;
      } catch (error) {
        timedOut = error instanceof Error && error.name === 'TimeoutError';
      }
      const elapsedMs = round(performance.now() - started);
      httpTimings.push(elapsedMs);
      const actualIds = (result?.results ?? [])
        .map((row) => String(row.sourceId ?? ''))
        .sort();
      const pass =
        responseStatus === 200 &&
        result?.totalExact === true &&
        result.total === testCase.expectedDocumentIds.length &&
        JSON.stringify(actualIds) ===
          JSON.stringify(testCase.expectedDocumentIds);
      const row = {
        id: testCase.id,
        querySha256: sha256(testCase.query),
        responseStatus,
        expectedCount: testCase.expectedDocumentIds.length,
        actualCount: result?.total ?? null,
        expectedIdSetSha256: idHash(testCase.expectedDocumentIds),
        actualIdSetSha256: idHash(actualIds),
        totalExact: result?.totalExact ?? false,
        elapsedMs,
        timedOut,
        pass,
      };
      httpRows.push(row);
      if (!pass) httpFailures.push(row);
    }

    const pagination: string[] = [];
    const pageTotals: number[] = [];
    const pageMore: boolean[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const result = await productSearch.search(
        parseSearchQuery('zzsprpagination'),
        { ...context, page, pageSize: 100 },
      );
      pagination.push(...result.results.map((row) => row.sourceId));
      pageTotals.push(result.total);
      pageMore.push(result.hasMore === true);
    }
    const paginationPass =
      pageTotals.every((total) => total === 325) &&
      JSON.stringify(pageMore) === JSON.stringify([true, true, true, false]) &&
      pagination.length === 325 &&
      new Set(pagination).size === 325 &&
      JSON.stringify(pagination) === JSON.stringify([...paginationIds].sort());
    const paginationArtifact = {
      pages: 4,
      pageSize: 100,
      totalByPage: pageTotals,
      hasMoreByPage: pageMore,
      returned: pagination.length,
      distinctIds: new Set(pagination).size,
      exactTotal: pageTotals.every((total) => total === 325),
      pass: paginationPass,
    };
    if (!paginationPass)
      failures.push({ suite: 'pagination', ...paginationArtifact });

    const stableOrderRows: Array<{ querySha256: string; pass: boolean }> = [];
    for (const query of [
      'zzsprresponsabilidad',
      '"zzsprresponsabilidad zzsprcivil"',
      'zzspraccion + zzsprpenal',
      'civil',
    ]) {
      const parsed = parseSearchQuery(query);
      const [first, second] = await Promise.all([
        productSearch.search(parsed, { ...context, pageSize: 20 }),
        productSearch.search(parsed, { ...context, pageSize: 20 }),
      ]);
      const pass =
        JSON.stringify(first.results.map((row) => row.sourceId)) ===
        JSON.stringify(second.results.map((row) => row.sourceId));
      stableOrderRows.push({ querySha256: sha256(query), pass });
    }
    const stableOrderPass = stableOrderRows.every((row) => row.pass);
    if (!stableOrderPass)
      failures.push({ suite: 'stable-order', rows: stableOrderRows });

    const httpPaginationIds: string[] = [];
    const httpPaginationTotals: number[] = [];
    const httpPaginationHasMore: boolean[] = [];
    let httpPaginationStatusPass = true;
    for (let page = 1; page <= 4; page += 1) {
      const url = new URL('/api/busqueda/avanzada', httpApp.baseUrl);
      url.searchParams.set('q', 'zzsprpagination');
      url.searchParams.set('digestoCollectionId', collection.id);
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', '100');
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      httpPaginationStatusPass &&= response.status === 200;
      const body = (await response.json()) as GoldenHttpBody;
      httpPaginationTotals.push(body.federated?.total ?? -1);
      httpPaginationHasMore.push(body.federated?.hasMore === true);
      httpPaginationIds.push(
        ...(body.federated?.results ?? []).map((row) =>
          String(row.sourceId ?? ''),
        ),
      );
    }
    const expectedPaginationIds = [...paginationIds].sort();
    const httpPaginationDistinct = new Set(httpPaginationIds);
    const httpPaginationPass =
      httpPaginationStatusPass &&
      httpPaginationTotals.every((total) => total === 325) &&
      JSON.stringify(httpPaginationHasMore) ===
        JSON.stringify([true, true, true, false]) &&
      httpPaginationIds.length === 325 &&
      httpPaginationDistinct.size === 325 &&
      JSON.stringify(httpPaginationIds) ===
        JSON.stringify(expectedPaginationIds);
    const httpPaginationArtifact = {
      route: 'GET /api/busqueda/avanzada',
      pages: 4,
      pageSize: 100,
      totalByPage: httpPaginationTotals,
      hasMoreByPage: httpPaginationHasMore,
      returned: httpPaginationIds.length,
      distinctIds: httpPaginationDistinct.size,
      duplicates: httpPaginationIds.length - httpPaginationDistinct.size,
      missing: expectedPaginationIds.filter(
        (id) => !httpPaginationIds.includes(id),
      ).length,
      stableOrdering: httpPaginationPass,
      pass: httpPaginationPass,
    };
    if (!httpPaginationPass)
      httpFailures.push({ suite: 'pagination', ...httpPaginationArtifact });

    const output = {
      generatedAt: new Date().toISOString(),
      suite:
        'OpenSearch product adapter and GET /api/busqueda/avanzada + PostgreSQL hydration; 319 baseline + 6 new product contract goldens',
      engine: 'OpenSearch 2.19.6',
      queryCases: cases.length,
      baselineCases: 319,
      newProductContractCases: cases.length - 319,
      passed: rows.filter((row) => row.pass === true).length,
      failed: failures.length,
      falsePositives: rows.reduce(
        (sum, row) =>
          sum +
          Math.max(0, Number(row.actualCount) - Number(row.expectedCount)),
        0,
      ),
      falseNegatives: rows.reduce(
        (sum, row) =>
          sum +
          Math.max(0, Number(row.expectedCount) - Number(row.actualCount)),
        0,
      ),
      latencyMs: {
        p50: percentile(timings, 0.5),
        p95: percentile(timings, 0.95),
        max: round(Math.max(...timings)),
      },
      pagination: paginationArtifact,
      stableOrdering: {
        queries: stableOrderRows.length,
        passed: stableOrderRows.filter((row) => row.pass).length,
        rows: stableOrderRows,
        pass: stableOrderPass,
      },
      http: {
        route: 'GET /api/busqueda/avanzada?digestoCollectionId=<synthetic>',
        queryCases: httpRows.length,
        passed: httpRows.filter((row) => row.pass === true).length,
        failed: httpFailures.length,
        falsePositives: httpRows.reduce(
          (sum, row) =>
            sum +
            Math.max(0, Number(row.actualCount) - Number(row.expectedCount)),
          0,
        ),
        falseNegatives: httpRows.reduce(
          (sum, row) =>
            sum +
            Math.max(0, Number(row.expectedCount) - Number(row.actualCount)),
          0,
        ),
        latencyMs: {
          p50: percentile(httpTimings, 0.5),
          p95: percentile(httpTimings, 0.95),
          max: round(Math.max(...httpTimings)),
        },
        timeouts: httpRows.filter((row) => row.timedOut === true).length,
        pagination: httpPaginationArtifact,
        rows: httpRows,
        failures: httpFailures,
        pass:
          httpRows.length === 325 &&
          httpFailures.length === 0 &&
          httpRows.every((row) => row.pass === true),
      },
      timeouts: 0,
      failures,
      queryTextPersisted: false,
      documentTextPersisted: false,
      rows,
      pass:
        failures.length === 0 &&
        rows.length === 325 &&
        httpFailures.length === 0 &&
        httpRows.length === 325,
    };
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      resolve(artifactRoot, 'product-golden.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      resolve(artifactRoot, 'http-golden-1_5.json'),
      `${JSON.stringify(
        {
          generatedAt: output.generatedAt,
          candidateAlias: process.env.OPENSEARCH_INDEX_ALIAS,
          route: output.http.route,
          queryCases: output.http.queryCases,
          passed: output.http.passed,
          failed: output.http.failed,
          falsePositives: output.http.falsePositives,
          falseNegatives: output.http.falseNegatives,
          timeouts: output.http.timeouts,
          latencyMs: output.http.latencyMs,
          pagination: output.http.pagination,
          failures: output.http.failures,
          rows: output.http.rows,
          pass: output.http.pass,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(
      JSON.stringify(
        {
          generatedAt: output.generatedAt,
          suite: output.suite,
          queryCases: output.queryCases,
          passed: output.passed,
          failed: output.failed,
          falsePositives: output.falsePositives,
          falseNegatives: output.falseNegatives,
          latencyMs: output.latencyMs,
          pagination: output.pagination,
          stableOrdering: output.stableOrdering,
          timeouts: output.timeouts,
          http: {
            queryCases: output.http.queryCases,
            passed: output.http.passed,
            failed: output.http.failed,
            falsePositives: output.http.falsePositives,
            falseNegatives: output.http.falseNegatives,
            timeouts: output.http.timeouts,
            latencyMs: output.http.latencyMs,
            pagination: output.http.pagination,
            pass: output.http.pass,
          },
          pass: output.pass,
        },
        null,
        2,
      ),
    );
    if (!output.pass) process.exitCode = 1;
  } finally {
    if (httpApp) await httpApp.app.close().catch(() => undefined);
    await prisma.corpusDocument
      .deleteMany({ where: { id: { in: allIds } } })
      .catch(() => undefined);
    if (collectionId)
      await prisma.digestoCollection
        .deleteMany({ where: { id: collectionId } })
        .catch(() => undefined);
    if (hydrator) await hydrator.close().catch(() => undefined);
    if (runtimeStarted) {
      await waitForOutbox(runtime).catch(() => undefined);
      await runtime.onModuleDestroy().catch(() => undefined);
    } else {
      await runtime.index.close().catch(() => undefined);
      await runtime.client.close().catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function createHttpApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: ['.env.development.local', '.env'],
      }),
      PrismaModule,
      BusquedaModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use((request: Request, _response: Response, next: NextFunction) => {
    (request as Request & { user?: unknown }).user = {
      id: 7,
      rol: { nombre: 'ADMIN' },
    };
    next();
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  const httpServer = app.getHttpServer() as unknown as {
    address(): { port?: number } | string | null;
  };
  const address = httpServer.address();
  if (!address || typeof address === 'string' || !('port' in address))
    throw new Error('HTTP_CERT_TEST_SERVER_START_FAILED');
  if (!address.port) throw new Error('HTTP_CERT_TEST_SERVER_START_FAILED');
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

function assertDevDatabase(databaseUrl?: string) {
  if (!databaseUrl) throw new Error('DEV_DB_GUARD_DATABASE_URL_REQUIRED');
  const target = new URL(databaseUrl);
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev'
  ) {
    throw new Error('DEV_DB_GUARD_TARGET_INVALID');
  }
}

function buildGoldenCases(documentIds: string[]): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const add = (id: string, query: string, expected: number[]) => {
    const expectedDocumentIds = expected
      .map((index) => documentIds[index])
      .sort();
    cases.push({
      id,
      query,
      expectedDocumentIds,
      forbiddenDocumentIds: documentIds.filter(
        (documentId) => !expectedDocumentIds.includes(documentId),
      ),
      expectedOrdering: expectedDocumentIds,
    });
  };
  for (let index = 0; index < 300; index += 1) {
    const token = `zzsprintgoldtoken${alphaCode(index)}`;
    const expected = documentIds
      .map((_, documentIndex) => documentIndex)
      .filter(
        (documentIndex) =>
          (index * 7 + documentIndex * 5) % 12 < 1 + (index % 5),
      );
    add(`G-${String(index + 1).padStart(3, '0')}`, token, expected);
  }
  add('C-TERM', 'zzsprresponsabilidad', [0, 1, 4, 6, 8, 9]);
  add('C-CASE', 'ZZSPRRESPONSABILIDAD', [0, 1, 4, 6, 8, 9]);
  add('C-ACCENT', 'zzspracción', [0, 1, 5]);
  add('C-ACCENT-FOLDED', 'zzspraccion', [0, 1, 5]);
  add('C-ENYE', 'zzsprniño', [0, 2]);
  add('C-N', 'zzsprnino', [1, 3]);
  add('C-AND', 'zzspraccion * zzsprcivil', [0, 1, 5]);
  add('C-OR', 'zzspraccion + zzsprpenal', [0, 1, 5, 6]);
  add('C-NOT', 'zzsprresponsabilidad - zzsprpenal', [0, 1, 4, 8, 9]);
  add(
    'C-PRECEDENCE',
    'zzspraccion + zzsprresponsabilidad * zzsprpenal',
    [0, 1, 5, 6],
  );
  add('C-PARENS', '(zzspraccion + zzsprresponsabilidad) * zzsprpenal', [6]);
  add('C-PHRASE', '"zzsprresponsabilidad zzsprcivil"', [0, 1, 4, 8]);
  add('C-PHRASE-LINE', '"zzsprlinebreak line break"', [10]);
  add('C-PREFIX', 'zzsprrespons%', [0, 1, 4, 6, 8, 9]);
  add('C-SUFFIX', '%zzsprresponsabilidad', [0, 1, 4, 6, 8, 9]);
  add('C-NUMBER', 'zzsprciv12345', [11]);
  add('C-REPEAT-AND', 'zzspraccion * zzspraccion', [0, 1, 5]);
  add('C-REPEAT-OR', 'zzspraccion + zzspraccion', [0, 1, 5]);
  add('C-WS', '  zzsprresponsabilidad\t ', [0, 1, 4, 6, 8, 9]);
  add('NEW-CIVIL-PREFIX-BOUNDARIES', 'civil', [0, 1, 4, 5, 8, 9, 12, 16, 17]);
  add(
    'NEW-RESPONSABILIDAD-PREFIX-BOUNDARIES',
    'responsabilidad',
    [0, 1, 4, 6, 8, 9, 14, 16],
  );
  add('NEW-QUOTED-WORD-CIVIL-EXACT', '"civil"', [0, 1, 4, 5, 8, 9, 16]);
  add(
    'NEW-EXACT-PHRASE-BOUNDARIES',
    '"responsabilidad civil"',
    [0, 1, 4, 8, 9, 16],
  );
  add('NEW-ACCENT-CASE', 'ACCION', [0, 1, 5]);
  add('NEW-ENYE-DISTINCT', 'niño', [0, 2]);
  return cases;
}

function alphaCode(value: number) {
  let remaining = value;
  let result = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let position = 0; position < 3; position += 1) {
    result = alphabet[remaining % alphabet.length] + result;
    remaining = Math.floor(remaining / alphabet.length);
  }
  return result;
}

async function waitForOutbox(runtime: OpenSearchRuntimeService) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await runtime.syncWorker.tick();
    const status = await runtime.repository.outboxStatus();
    if (status.failed > 0) throw new Error('OPENSEARCH_FIXTURE_OUTBOX_FAILED');
    if (status.pending === 0) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('OPENSEARCH_FIXTURE_OUTBOX_DRAIN_TIMEOUT');
}

function loadLocalEnvironment() {
  const file = resolve(
    process.env.BJC_DEV_DB_GUARD_ENV_FILE ??
      resolve(process.cwd(), '.env.development.local'),
  );
  const contents = readFileSync(file, 'utf8');
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

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function idHash(ids: string[]) {
  return sha256([...ids].sort().join('\n'));
}
function round(value: number) {
  return Math.round(value * 100) / 100;
}
function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return round(
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ??
      0,
  );
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'OPENSEARCH_FIXTURE_GOLDEN_FAILED';
  console.error(
    message.startsWith('OPENSEARCH_') || message.startsWith('DEV_')
      ? message
      : 'OPENSEARCH_FIXTURE_GOLDEN_FAILED',
  );
  process.exitCode = 1;
});
