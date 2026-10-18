import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import { searchSort } from '../../src/busqueda/opensearch/opensearch-search-source.adapter';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

const candidate = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const pageSize = 100;
const query = 'responsabilidad civil';
const outputPath = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1/http-sort-pagination-1_5_1.json',
);
type Hit = { _id: string };
type SearchResponse = {
  hits?: { total?: { value?: number; relation?: string }; hits?: Hit[] };
};
type HttpBody = {
  federated?: {
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
    results?: Array<{ sourceId?: string }>;
  };
};

async function main() {
  const db = new URL(process.env.DATABASE_URL ?? '');
  if (
    db.protocol !== 'postgresql:' ||
    db.hostname !== '127.0.0.1' ||
    db.port !== '55432' ||
    db.pathname !== '/buscador_juridico_civil_dev' ||
    db.username !== 'bjc_dev'
  )
    throw new Error('DEV_DB_GUARD_REQUIRED');
  process.env.NODE_ENV = 'development';
  process.env.SEARCH_ENGINE = 'opensearch';
  process.env.OPENSEARCH_INDEX_ALIAS = candidate;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
  let app: INestApplication | undefined;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    const port = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address()?.port;
    if (!port) throw new Error('HTTP_PORT_MISSING');

    const runtime = app.get(OpenSearchRuntimeService);
    const context: SearchContext = {
      visibility: 'PUBLIC',
      dialect: 'modern',
      publicationPolicy: 'published-active-only',
      page: 1,
      pageSize,
      documentKinds: ['SENTENCIA'],
      sourceSystems: ['JURISPRUDENCIA'],
      sort: { field: 'fecha', order: 'desc' },
    };
    const referenceResponse = await runtime.client.search({
      index: candidate,
      body: {
        size: 10000,
        track_total_hits: true,
        _source: false,
        query: buildSearchQueryDsl(parseSearchQuery(query), context, {
          source: 'JURISPRUDENCIA',
        }),
        sort: searchSort(context, 'JURISPRUDENCIA'),
      },
    });
    const referenceBody = (
      referenceResponse as unknown as { body: SearchResponse }
    ).body;
    const referenceHits = referenceBody.hits?.hits ?? [];
    if (
      referenceBody.hits?.total?.relation !== 'eq' ||
      referenceBody.hits.total.value !== 4759 ||
      referenceBody.hits.total.value !== referenceHits.length
    )
      throw new Error('REFERENCE_TOTAL_MISMATCH');
    const expected = referenceHits.map(
      (hit) => hit._id.split(':').at(-1) ?? '',
    );

    const server = new URL(`http://127.0.0.1:${port}/api/public/busqueda`);
    server.searchParams.set('q', query);
    server.searchParams.set('pageSize', String(pageSize));
    server.searchParams.set('sortBy', 'fecha');
    server.searchParams.set('sortOrder', 'desc');
    const pageIds = new Map<number, string[]>();
    const actual: string[] = [];
    const latencies: number[] = [];
    let total: number | null = null;
    let pages = 0;
    for (let page = 1; page <= 100; page += 1) {
      server.searchParams.set('page', String(page));
      const started = performance.now();
      const response = await fetch(server, {
        signal: AbortSignal.timeout(30000),
      });
      latencies.push(performance.now() - started);
      if (response.status !== 200)
        throw new Error(`HTTP_STATUS_${response.status}`);
      const body = (await response.json()) as HttpBody;
      if (
        !body.federated?.totalExact ||
        !Number.isSafeInteger(body.federated.total)
      )
        throw new Error('HTTP_TOTAL_NOT_EXACT');
      if (total === null) total = body.federated.total!;
      if (total !== body.federated.total) throw new Error('HTTP_TOTAL_CHANGED');
      const ids = (body.federated.results ?? []).map((row) =>
        String(row.sourceId ?? ''),
      );
      pageIds.set(page, ids);
      actual.push(...ids);
      pages = page;
      if (!body.federated.hasMore) break;
      if (page === 100) throw new Error('HTTP_PAGE_LIMIT_REACHED');
    }
    if (total !== expected.length || actual.length !== expected.length)
      throw new Error('HTTP_TOTAL_DOES_NOT_MATCH_REFERENCE');
    const uniqueActual = new Set(actual);
    if (uniqueActual.size !== actual.length)
      throw new Error('HTTP_DUPLICATE_IDS');
    if (actual.some((id, index) => id !== expected[index]))
      throw new Error('HTTP_ORDER_OR_ID_SET_MISMATCH');

    const middlePage = Math.ceil(pages / 2);
    const samplePages = [...new Set([1, 2, middlePage, pages])];
    const repeat: Array<Record<string, unknown>> = [];
    for (const page of samplePages) {
      server.searchParams.set('page', String(page));
      const response = await fetch(server, {
        signal: AbortSignal.timeout(30000),
      });
      if (response.status !== 200)
        throw new Error(`REPEAT_HTTP_STATUS_${response.status}`);
      const body = (await response.json()) as HttpBody;
      const ids = (body.federated?.results ?? []).map((row) =>
        String(row.sourceId ?? ''),
      );
      const sameOrder = ids.join('\n') === (pageIds.get(page) ?? []).join('\n');
      repeat.push({ page, rows: ids.length, sameOrder });
      if (!sameOrder) throw new Error(`PAGE_ORDER_NOT_STABLE:${page}`);
    }
    const result = {
      generatedAt: new Date().toISOString(),
      candidate,
      route: 'GET /api/public/busqueda',
      queryHash: sha(query),
      sort: { field: 'fecha', order: 'desc' },
      pageSize,
      referenceTotal: expected.length,
      productTotal: total,
      pages,
      checkedPages: samplePages,
      duplicateRows: actual.length - uniqueActual.size,
      missingRows: expected.filter((id) => !uniqueActual.has(id)).length,
      referenceOrderHash: sha(expected.join('\n')),
      productOrderHash: sha(actual.join('\n')),
      repeatChecks: repeat,
      latencyMs: {
        min: Math.min(...latencies),
        max: Math.max(...latencies),
        mean:
          latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      },
      pass:
        actual.length === expected.length &&
        actual.every((id, index) => id === expected[index]) &&
        uniqueActual.size === actual.length &&
        repeat.every((row) => row.sameOrder === true),
    };
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
  } finally {
    if (app) await app.close();
  }
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'HTTP_SORT_PAGINATION_FAILED',
  );
  process.exitCode = 1;
});
