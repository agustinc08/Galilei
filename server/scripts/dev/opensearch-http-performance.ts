import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { Client } from '@opensearch-project/opensearch';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { BusquedaService } from '../../src/busqueda/busqueda.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

type SearchBody = {
  data?: unknown[];
  meta?: { total?: number; totalExact?: boolean };
};

loadLocalEnvironment();
process.env.SEARCH_ENGINE = 'opensearch';
process.env.OPENSEARCH_INDEX_ALIAS = 'galilei-search-int151-cert';
process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  const root = resolve(process.cwd(), '..');
  const artifactRoot = resolve(
    root,
    '_recovery-work',
    'search-engine-integration1',
  );
  const app = await createHttpApp();
  try {
    app.app.get(BusquedaService).trackAdvancedV2 = () => undefined;
    const phrases = ['responsabilidad civil', 'falta de servicio'];
    const referenceCounts = await directReferenceCounts(phrases);
    const summaries: Array<Record<string, unknown>> = [];
    const warmupsPerQuery = 2;
    const measuredSamplesPerQuery = 20;
    for (const phrase of phrases) {
      const expectedTotal = referenceCounts[phrase];
      for (let warmup = 0; warmup < warmupsPerQuery; warmup += 1) {
        const response = await requestSearch(app.baseUrl, phrase);
        if (response.status !== 200) throw new Error('HTTP_PERF_WARMUP_FAILED');
      }
      const samplesMs: number[] = [];
      const statuses: number[] = [];
      const totals: number[] = [];
      const exact: boolean[] = [];
      for (let index = 0; index < measuredSamplesPerQuery; index += 1) {
        const started = performance.now();
        const response = await requestSearch(app.baseUrl, phrase);
        samplesMs.push(round(performance.now() - started));
        statuses.push(response.status);
        totals.push(response.total);
        exact.push(response.totalExact);
      }
      const result = {
        label: phrase,
        querySha256: sha256(phrase),
        referenceSource:
          'direct OpenSearch count with JURISPRUDENCIA/SENTENCIA/PUBLIC context',
        expectedTotal,
        total: totals[0] ?? null,
        samples: samplesMs.length,
        p50Ms: percentile(samplesMs, 0.5),
        p95Ms: percentile(samplesMs, 0.95),
        p99Ms: percentile(samplesMs, 0.99),
        maxMs: round(Math.max(...samplesMs, 0)),
        timeouts: statuses.filter((status) => status === 0).length,
        statuses,
        totalsStable: new Set(totals).size === 1,
        exactTotalAllSamples: exact.every(Boolean),
        pass:
          samplesMs.length === measuredSamplesPerQuery &&
          statuses.every((status) => status === 200) &&
          totals.every((total) => total === expectedTotal) &&
          exact.every(Boolean),
      };
      summaries.push(result);
    }

    const concurrency: Array<Record<string, unknown> & { pass: boolean }> = [];
    for (const concurrencySize of [5, 10]) {
      const started = performance.now();
      const responses = await Promise.all(
        Array.from({ length: concurrencySize }, () =>
          requestSearch(app.baseUrl, 'responsabilidad civil'),
        ),
      );
      concurrency.push({
        concurrentRequests: concurrencySize,
        statuses: responses.map((response) => response.status),
        totals: responses.map((response) => response.total),
        exactTotals: responses.map((response) => response.totalExact),
        elapsedMs: round(performance.now() - started),
        perRequestMs: responses.map((response) => response.elapsedMs),
        errors: responses.filter((response) => response.status !== 200).length,
        timeouts: responses.filter((response) => response.timedOut).length,
        pass:
          responses.length === concurrencySize &&
          responses.every(
            (response) =>
              response.status === 200 &&
              response.total === referenceCounts['responsabilidad civil'] &&
              response.totalExact,
          ),
      });
    }

    const result = {
      generatedAt: new Date().toISOString(),
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidateAlias: 'galilei-search-int151-cert',
      route: 'GET /api/public/busqueda',
      directReferenceTotals: referenceCounts,
      warmupsPerQuery,
      sequentialSamplesPerCriticalQuery: measuredSamplesPerQuery,
      critical: summaries,
      concurrency,
      pass:
        summaries.every((row) => row.pass === true) &&
        concurrency.every((row) => row.pass),
      queryTextPersisted: false,
    };
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      resolve(artifactRoot, 'http-performance-regression-1_5_1.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      resolve(artifactRoot, 'http-concurrency-1_5.json'),
      `${JSON.stringify({ generatedAt: result.generatedAt, route: result.route, concurrency, pass: concurrency.every((row) => row.pass) }, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
  } finally {
    await app.app.close();
  }
}

async function requestSearch(baseUrl: string, query: string) {
  const started = performance.now();
  try {
    const url = new URL('/api/public/busqueda', baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('page', '1');
    url.searchParams.set('pageSize', '100');
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = (await response.json()) as SearchBody;
    return {
      status: response.status,
      total: Number(body.meta?.total ?? -1),
      totalExact: body.meta?.totalExact === true,
      elapsedMs: round(performance.now() - started),
      timedOut: false,
    };
  } catch (error) {
    return {
      status: 0,
      total: -1,
      totalExact: false,
      elapsedMs: round(performance.now() - started),
      timedOut: error instanceof Error && error.name === 'TimeoutError',
    };
  }
}

async function directReferenceCounts(phrases: string[]) {
  const config = readOpenSearchConfig();
  const client = new Client(config.clientOptions);
  const context = {
    visibility: 'PUBLIC' as const,
    dialect: 'modern' as const,
    publicationPolicy: 'published-active-only' as const,
    page: 1,
    pageSize: 100,
    sourceSystems: ['JURISPRUDENCIA' as const],
    documentKinds: ['SENTENCIA' as const],
  };
  try {
    const counts: Record<string, number> = {};
    for (const phrase of phrases) {
      const response = await client.count({
        index: config.alias,
        body: {
          query: buildSearchQueryDsl(parseSearchQuery(phrase), context, {
            source: 'JURISPRUDENCIA',
          }),
        },
      });
      const body = responseBody<{ count?: number }>(response);
      if (!Number.isSafeInteger(body.count))
        throw new Error('HTTP_PERF_REFERENCE_COUNT_INVALID');
      counts[phrase] = body.count!;
    }
    return counts;
  } finally {
    await client.close();
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
  const server = app.getHttpServer() as unknown as {
    address(): { port?: number } | string | null;
  };
  const address = server.address();
  if (!address || typeof address === 'string' || !address.port)
    throw new Error('HTTP_TEST_SERVER_START_FAILED');
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
  )
    throw new Error('DEV_DB_GUARD_TARGET_INVALID');
}
function loadLocalEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
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
function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function responseBody<T>(response: unknown): T {
  const wrapped = response as { body?: T };
  return wrapped.body ?? (response as T);
}
function round(value: number) {
  return Math.round(value * 100) / 100;
}
function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return round(
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ??
      0,
  );
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'HTTP_PERFORMANCE_CERTIFICATION_FAILED';
  console.error(
    /^(?:HTTP|DEV|OPENSEARCH)_[A-Z0-9_]+$/u.test(message)
      ? message
      : 'HTTP_PERFORMANCE_CERTIFICATION_FAILED',
  );
  process.exitCode = 1;
});
