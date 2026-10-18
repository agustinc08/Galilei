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
import {
  compareLocaleSortHits,
  searchSort,
} from '../../src/busqueda/opensearch/opensearch-search-source.adapter';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

const candidate = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const root = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1',
);
type Case = {
  id: string;
  family: 'filters' | 'combinations' | 'sorts';
  q: string;
  params: Record<string, string>;
  filters?: SearchContext['filters'];
  sort?: SearchContext['sort'];
};
type Hit = {
  _id: string;
  _score: number | null;
  _source?: {
    logicalNumericId?: number | null;
    sortFields?: { sala?: string | null; numeroSentencia?: string | null };
  };
};
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

const q = 'responsabilidad civil';
const cases: Case[] = [
  {
    id: 'pdf-only',
    family: 'filters',
    q,
    params: { soloConPdf: 'true' },
    filters: { soloConPdf: true },
  },
  {
    id: 'pdf-con',
    family: 'filters',
    q,
    params: { pdf: 'conPdf' },
    filters: { pdf: 'conPdf' },
  },
  {
    id: 'pdf-sin',
    family: 'filters',
    q,
    params: { pdf: 'sinPdf' },
    filters: { pdf: 'sinPdf' },
  },
  {
    id: 'has-pdf',
    family: 'filters',
    q,
    params: { tienePdf: 'true' },
    filters: { tienePdf: true },
  },
  {
    id: 'summary-only',
    family: 'filters',
    q,
    params: { soloConResumen: 'true' },
    filters: { soloConResumen: true },
  },
  {
    id: 'featured',
    family: 'filters',
    q,
    params: { destacada: 'true' },
    filters: { destacada: true },
  },
  {
    id: 'scope-sentencia',
    family: 'filters',
    q,
    params: { buscarEn: 'sentencia' },
    filters: { buscarEn: ['sentencia'] },
  },
  {
    id: 'scope-sumario',
    family: 'filters',
    q,
    params: { buscarEn: 'sumario' },
    filters: { buscarEn: ['sumario'] },
  },
  {
    id: 'scope-resumen',
    family: 'filters',
    q,
    params: { buscarEn: 'resumen' },
    filters: { buscarEn: ['resumen'] },
  },
  {
    id: 'scope-resena',
    family: 'filters',
    q,
    params: { buscarEn: 'resena' },
    filters: { buscarEn: ['resena'] },
  },
  {
    id: 'scope-referencias',
    family: 'filters',
    q,
    params: { buscarEn: 'referencias' },
    filters: { buscarEn: ['referencias'] },
  },
  {
    id: 'sala',
    family: 'filters',
    q,
    params: { sala: 'A' },
    filters: { sala: 'A' },
  },
  {
    id: 'anio',
    family: 'filters',
    q,
    params: { anio: '2024' },
    filters: { anio: 2024 },
  },
  {
    id: 'tipo-fallo',
    family: 'filters',
    q,
    params: { tipoFallo: 'Sentencia' },
    filters: { tipoFallo: 'Sentencia' },
  },
  {
    id: 'exact-phrase',
    family: 'filters',
    q: 'civil',
    params: { fraseExacta: 'responsabilidad civil' },
    filters: { exactPhrase: 'responsabilidad civil' },
  },
  {
    id: 'exclude',
    family: 'filters',
    q: '"alejandro damian arena."',
    params: { excluir: 'arena' },
    filters: { excludeTerms: ['arena'] },
  },
  {
    id: 'term-pdf',
    family: 'combinations',
    q,
    params: { soloConPdf: 'true' },
    filters: { soloConPdf: true },
  },
  {
    id: 'phrase-summary',
    family: 'combinations',
    q: '"responsabilidad civil"',
    params: { soloConResumen: 'true' },
    filters: { soloConResumen: true },
  },
  {
    id: 'two-filters',
    family: 'combinations',
    q,
    params: { pdf: 'conPdf', anio: '2024' },
    filters: { pdf: 'conPdf', anio: 2024 },
  },
  {
    id: 'filter-sort',
    family: 'combinations',
    q,
    params: { destacada: 'true', sortBy: 'fecha', sortOrder: 'asc' },
    filters: { destacada: true },
    sort: { field: 'fecha', order: 'asc' },
  },
  {
    id: 'filter-pagination',
    family: 'combinations',
    q,
    params: { pdf: 'conPdf' },
    filters: { pdf: 'conPdf' },
  },
  ...(['fecha', 'relevancia', 'sala', 'numeroSentencia'] as const).flatMap(
    (field) =>
      (['asc', 'desc'] as const).map((order) => ({
        id: `${field}-${order}`,
        family: 'sorts' as const,
        q,
        params: { sortBy: field, sortOrder: order, anio: '2024' },
        filters: { anio: 2024 },
        sort: { field, order },
      })),
  ),
];

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
    const output: Record<Case['family'], Array<Record<string, unknown>>> = {
      filters: [],
      combinations: [],
      sorts: [],
    };
    for (const testCase of cases) {
      const context: SearchContext = {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 100,
        documentKinds: ['SENTENCIA'],
        sourceSystems: ['JURISPRUDENCIA'],
        filters: testCase.filters,
        sort: testCase.sort ?? { field: 'relevancia', order: 'desc' },
      };
      const dsl = buildSearchQueryDsl(parseSearchQuery(testCase.q), context, {
        source: 'JURISPRUDENCIA',
      });
      const locale =
        testCase.sort?.field === 'sala' ||
        testCase.sort?.field === 'numeroSentencia'
          ? testCase.sort.field
          : null;
      const response = await runtime.client.search({
        index: candidate,
        body: {
          size: 10000,
          track_total_hits: true,
          _source: locale
            ? [
                'logicalNumericId',
                'sortFields.sala',
                'sortFields.numeroSentencia',
              ]
            : false,
          query: dsl,
          sort: locale
            ? searchSort(
                { ...context, sort: { field: 'fecha', order: 'desc' } },
                'JURISPRUDENCIA',
              )
            : searchSort(context, 'JURISPRUDENCIA'),
        },
      });
      const body = (response as unknown as { body: SearchResponse }).body;
      const hits = body.hits?.hits ?? [];
      if (
        body.hits?.total?.relation !== 'eq' ||
        body.hits.total.value !== hits.length
      )
        throw new Error(`DIRECT_REFERENCE_INCOMPLETE:${testCase.id}`);
      if (locale)
        hits.sort((left, right) =>
          compareLocaleSortHits(left, right, locale, testCase.sort!.order),
        );
      const reference = hits.map((hit) => hit._id.split(':').at(-1) ?? '');
      const actual: string[] = [];
      let total: number | null = null;
      let status = 0;
      let exactTotal = true;
      let timedOut = false;
      for (let page = 1; page <= 100; page += 1) {
        const url = new URL(`http://127.0.0.1:${port}/api/public/busqueda`);
        url.searchParams.set('q', testCase.q);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', '100');
        Object.entries(testCase.params).forEach(([key, value]) =>
          url.searchParams.set(key, value),
        );
        let http: globalThis.Response;
        try {
          http = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        } catch {
          timedOut = true;
          break;
        }
        status = http.status;
        if (status !== 200) break;
        const pageBody = (await http.json()) as HttpBody;
        if (
          !pageBody.federated?.totalExact ||
          !Number.isSafeInteger(pageBody.federated.total)
        ) {
          exactTotal = false;
          break;
        }
        if (total === null) total = pageBody.federated.total!;
        if (total !== pageBody.federated.total) exactTotal = false;
        actual.push(
          ...(pageBody.federated.results ?? []).map((row) =>
            String(row.sourceId ?? ''),
          ),
        );
        if (!pageBody.federated.hasMore) break;
        if (page === 100) exactTotal = false;
      }
      const pass =
        !timedOut &&
        status === 200 &&
        exactTotal &&
        total === reference.length &&
        actual.length === reference.length &&
        actual.every((id, index) => id === reference[index]);
      output[testCase.family].push({
        id: testCase.id,
        queryHash: sha(testCase.q),
        expectedTotal: reference.length,
        actualTotal: total,
        actualRows: actual.length,
        referenceOrderHash: sha(reference.join('\n')),
        actualOrderHash: sha(actual.join('\n')),
        status,
        timedOut,
        pass,
      });
      console.log(
        `${testCase.family} ${testCase.id}: ${pass ? 'PASS' : 'FAIL'}`,
      );
    }
    const names = {
      filters: 'http-filters',
      combinations: 'http-filter-combinations',
      sorts: 'http-sorts',
    };
    for (const [family, rows] of Object.entries(output) as Array<
      [Case['family'], Array<Record<string, unknown>>]
    >) {
      const result = {
        generatedAt: new Date().toISOString(),
        candidate,
        route: 'GET /api/public/busqueda',
        reference:
          'direct v3 OpenSearch DSL previously certified against independent source parity',
        cases: rows.length,
        passed: rows.filter((row) => row.pass).length,
        rows,
        pass: rows.every((row) => row.pass),
      };
      writeFileSync(
        resolve(root, `${names[family]}-1_5_1.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );
      if (!result.pass) process.exitCode = 1;
    }
  } finally {
    if (app) await app.close();
  }
}
function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'HTTP_MATRIX_FAILED');
  process.exitCode = 1;
});
