import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import {
  lexicalTokens,
  phraseBigramSequence,
  phraseSequence,
} from '../../src/busqueda/opensearch/opensearch-mapping';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

const index = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const certAlias = 'galilei-search-int151-cert';
const activeAlias = 'galilei-search-active';
const runId = `${Date.now()}_${process.pid}`;
const boundarySourceId = `boundary-${runId}`;
const boundaryIndexId = `CORPUS:${boundarySourceId}`;
const artifactRoot = resolve(
  process.cwd(),
  '../_recovery-work/search-engine-integration1',
);
const outputPath = resolve(artifactRoot, 'http-adversarial22-1_5_1.json');

type Fixture = { name: string; document: string; phrase: string };
type HttpBody = {
  federated?: {
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
    results?: Array<{ sourceId?: string }>;
  };
};
type SearchBody = {
  hits?: { total?: { value?: number }; hits?: Array<{ _id: string }> };
};

const long301 = Array.from({ length: 301 }, (_, i) => `palabra${i}`).join(' ');
const long1000 = Array.from({ length: 125 }, (_, i) => `termino${i}`).join(' ');
const long301Chars = Array.from({ length: 28 }, (_, i) => `concepto${i}`).join(
  ' ',
);
const fixtures: Fixture[] = [
  { name: 'two words', document: 'a b c', phrase: 'a b' },
  { name: 'three contiguous words', document: 'a b c', phrase: 'a b c' },
  { name: 'intervening word', document: 'a b x b c', phrase: 'a b c' },
  {
    name: 'separate occurrences',
    document: 'a b expediente x b c',
    phrase: 'a b c',
  },
  { name: 'four contiguous words', document: 'a b c d', phrase: 'a b c d' },
  { name: 'interior phrase', document: 'a b c d', phrase: 'b c d' },
  { name: 'skipped token', document: 'a b c', phrase: 'a c' },
  { name: 'repeated tokens', document: 'a a a', phrase: 'a a a' },
  {
    name: 'repeated tokens cannot skip',
    document: 'a a x a a',
    phrase: 'a a a',
  },
  { name: 'punctuation differs', document: 'a-b', phrase: 'a b' },
  { name: 'punctuation exact', document: 'a-b', phrase: 'a-b' },
  {
    name: 'slash and periods',
    document: 'c/ s.a. expediente',
    phrase: 'c/ s.a.',
  },
  {
    name: 'line boundary normalized as space',
    document: 'a\nb',
    phrase: 'a b',
  },
  {
    name: 'accent normalization',
    document: 'acción civil',
    phrase: 'accion civil',
  },
  {
    name: 'enye remains distinct',
    document: 'niño civil',
    phrase: 'nino civil',
  },
  { name: 'enye exact', document: 'niño civil', phrase: 'niño civil' },
  {
    name: 'numbers remain lexical',
    document: 'ley 123/2024 civil',
    phrase: '123/2024 civil',
  },
  {
    name: 'large document',
    document: `${'antecedente '.repeat(8000)}responsabilidad civil contractual${' cierre'.repeat(8000)}`,
    phrase: 'responsabilidad civil contractual',
  },
  { name: '301 word phrase', document: `${long301} final`, phrase: long301 },
  {
    name: 'about 301 character phrase',
    document: `${long301Chars} final`,
    phrase: long301Chars,
  },
  {
    name: 'about 1000 character phrase',
    document: `${long1000} final`,
    phrase: long1000,
  },
];

function oldExact(document: string, phrase: string): boolean {
  const sequence = phraseSequence(normalizeSearchText(document))
    .split(' ')
    .filter(Boolean);
  const query = phraseSequence(normalizeSearchText(phrase))
    .split(' ')
    .filter(Boolean);
  for (let start = 0; start <= sequence.length - query.length; start += 1) {
    if (query.every((token, offset) => sequence[start + offset] === token))
      return true;
  }
  return false;
}

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
  process.env.OPENSEARCH_INDEX_ALIAS = certAlias;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  const docIds = fixtures.map(
    (_, i) => `int151_adv_${runId}_${String(i).padStart(2, '0')}`,
  );
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let runtime: OpenSearchRuntimeService | undefined;
  let runtimeStarted = false;
  let collectionId: string | undefined;
  let baselineCount = 0;
  const rows: Array<Record<string, unknown>> = [];
  let boundary: Record<string, unknown> = { pass: false, error: 'NOT_RUN' };
  let recoveredResiduals: Record<string, unknown> = {};
  let cleanup: Record<string, unknown> = { pass: false, error: 'NOT_RUN' };
  const startedAt = new Date().toISOString();

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    const dbService = app.get(PrismaService);
    const searchRuntime = app.get(OpenSearchRuntimeService);
    prisma = dbService;
    runtime = searchRuntime;
    await dbService.$connect();
    const cert = await searchRuntime.client.indices.getAlias({
      name: certAlias,
    });
    const active = await searchRuntime.client.indices.getAlias({
      name: activeAlias,
    });
    if (Object.keys(cert.body).join(',') !== index)
      throw new Error('CERT_ALIAS_TARGET_MISMATCH');
    if (
      Object.keys(active.body).length !== 1 ||
      !Object.keys(active.body)[0].startsWith('galilei-search-v001-')
    )
      throw new Error('ACTIVE_ALIAS_MUST_REMAIN_V1');

    const staleDocuments = await dbService.corpusDocument.findMany({
      where: { id: { startsWith: 'int151_adv_' } },
      select: { id: true },
    });
    const staleCollections = await dbService.digestoCollection.findMany({
      where: { normalized: { startsWith: 'int151-adversarial-' } },
      select: { id: true },
    });
    const staleBoundaryResponse = await searchRuntime.client.search({
      index,
      body: {
        size: 10,
        _source: ['id', 'title', 'sourceSystem'],
        query: {
          bool: {
            filter: [
              { term: { title: 'INT151 field boundary' } },
              { term: { sourceSystem: 'JURISPRUDENCIA' } },
            ],
          },
        },
      },
    });
    const staleBoundaryHits =
      (
        staleBoundaryResponse.body as {
          hits?: { hits?: Array<{ _id: string; _source?: { id?: string } }> };
        }
      ).hits?.hits ?? [];
    for (const hit of staleBoundaryHits) {
      if (
        !hit._source?.id?.startsWith('boundary-') ||
        hit._id !== `CORPUS:${hit._source.id}`
      )
        throw new Error('UNEXPECTED_BOUNDARY_FIXTURE_MATCH');
      await searchRuntime.client.delete({ index, id: hit._id });
    }
    if (staleCollections.length)
      await dbService.digestoCollection.deleteMany({
        where: { id: { in: staleCollections.map((row) => row.id) } },
      });
    if (staleDocuments.length)
      await dbService.corpusDocument.deleteMany({
        where: { id: { in: staleDocuments.map((row) => row.id) } },
      });
    searchRuntime.onModuleInit();
    runtimeStarted = true;
    await waitForOutbox(searchRuntime);
    const staleIndexedDocuments =
      await removeIndexedAdversarialFixtures(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    recoveredResiduals = {
      documentsRemoved: staleDocuments.length,
      collectionsRemoved: staleCollections.length,
      boundaryDocumentsRemoved: staleBoundaryHits.length,
      indexedDocumentsRemoved: staleIndexedDocuments,
    };

    const before = await searchRuntime.client.count({ index });
    baselineCount = Number(before.body.count ?? 0);
    if (baselineCount !== 69313)
      throw new Error('CANDIDATE_COUNT_PRECONDITION_FAILED');
    const backlog = await searchRuntime.repository.outboxStatus();
    if (backlog.pending || backlog.failed)
      throw new Error('OUTBOX_PRECONDITION_FAILED');

    await dbService.corpusDocument.createMany({
      data: fixtures.map((fixture, i) => ({
        id: docIds[i],
        title: `INT151 adversarial ${String(i + 1).padStart(2, '0')}`,
        documentType: 'INT151_ADVERSARIAL',
        jurisdiction: 'CIVIL',
        visibility: 'INTERNAL',
        documentScope: 'GENERAL',
        status: 'INDEXED',
        searchText: normalizeSearchText(fixture.document),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      })),
    });
    const collection = await dbService.digestoCollection.create({
      data: {
        name: `INT151 adversarial ${runId}`,
        normalized: `int151-adversarial-${runId}`.toLowerCase(),
      },
    });
    collectionId = collection.id;
    await dbService.digestoCollectionMembership.createMany({
      data: docIds.map((documentId) => ({
        collectionId: collection.id,
        documentId,
      })),
    });
    await waitForOutbox(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });

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
    const port = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address()?.port;
    if (!port) throw new Error('HTTP_PORT_MISSING');

    for (let i = 0; i < fixtures.length; i += 1) {
      const fixture = fixtures[i];
      const query = `"${fixture.phrase}"`;
      const expectedIds = fixtures
        .flatMap((candidate, j) =>
          oldExact(candidate.document, fixture.phrase) ? [docIds[j]] : [],
        )
        .sort();
      const url = new URL(`http://127.0.0.1:${port}/api/busqueda/avanzada`);
      url.searchParams.set('q', query);
      url.searchParams.set('digestoCollectionId', collection.id);
      url.searchParams.set('page', '1');
      url.searchParams.set('pageSize', '100');
      const started = performance.now();
      let status = 0;
      let actualIds: string[] = [];
      let total: number | null = null;
      let totalExact = false;
      let timedOut = false;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        });
        status = response.status;
        const body = (await response.json()) as HttpBody;
        actualIds = (body.federated?.results ?? [])
          .map((row) => String(row.sourceId ?? ''))
          .sort();
        total = body.federated?.total ?? null;
        totalExact = body.federated?.totalExact === true;
      } catch (error) {
        timedOut = error instanceof Error && error.name === 'TimeoutError';
      }
      const pass =
        status === 200 &&
        totalExact &&
        total === expectedIds.length &&
        JSON.stringify(actualIds) === JSON.stringify(expectedIds) &&
        new Set(actualIds).size === actualIds.length;
      rows.push({
        id: fixture.name,
        queryHash: sha(query),
        phraseChars: fixture.phrase.length,
        expectedTotal: expectedIds.length,
        actualTotal: total,
        expectedIdSetHash: sha(expectedIds.join('\n')),
        actualIdSetHash: sha(actualIds.join('\n')),
        status,
        totalExact,
        timedOut,
        latencyMs: round(performance.now() - started),
        pass,
      });
      console.log(
        `adversarial ${i + 1}/${fixtures.length}: ${pass ? 'PASS' : 'FAIL'}`,
      );
    }

    boundary = await runBoundaryDslCheck(searchRuntime);
  } finally {
    if (runtime) {
      await runtime.client
        .delete({ index, id: boundaryIndexId, refresh: true })
        .catch(() => undefined);
      if (prisma && collectionId)
        await prisma.digestoCollection
          .deleteMany({ where: { id: collectionId } })
          .catch(() => undefined);
      if (prisma && docIds.length)
        await prisma.corpusDocument
          .deleteMany({ where: { id: { in: docIds } } })
          .catch(() => undefined);
      if (runtimeStarted) await waitForOutbox(runtime).catch(() => undefined);
      let indexedDocumentsRemoved = -1;
      let indexedDocumentsCleanupError: string | undefined;
      if (runtimeStarted) {
        try {
          indexedDocumentsRemoved =
            await removeIndexedAdversarialFixtures(runtime);
        } catch (error) {
          indexedDocumentsCleanupError =
            error instanceof Error ? error.message : 'UNKNOWN_CLEANUP_ERROR';
        }
      }
      await runtime.client.indices.refresh({ index }).catch(() => undefined);
      let after = await runtime.client
        .count({ index })
        .catch(() => ({ body: { count: -1 } }));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (Number(after.body.count ?? -1) === baselineCount) break;
        if (runtimeStarted) await waitForOutbox(runtime).catch(() => undefined);
        await runtime.client.indices.refresh({ index }).catch(() => undefined);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
        after = await runtime.client
          .count({ index })
          .catch(() => ({ body: { count: -1 } }));
      }
      const residual = await runtime.client
        .count({ index, body: { query: { terms: { id: docIds } } } })
        .catch(() => ({ body: { count: -1 } }));
      const boundaryResidual = await runtime.client
        .count({
          index,
          body: { query: { ids: { values: [boundaryIndexId] } } },
        })
        .catch(() => ({ body: { count: -1 } }));
      const finalBacklog = await runtime.repository
        .outboxStatus()
        .catch(() => ({ pending: -1, failed: -1 }));
      const active = await runtime.client.indices
        .getAlias({ name: activeAlias })
        .catch(() => ({ body: {} }) as never);
      const activeTargets = Object.keys(active.body);
      cleanup = {
        usersResidual: 0,
        dependenciesResidual: 0,
        documentsCreated: docIds.length,
        documentsResidual: prisma
          ? await prisma.corpusDocument
              .count({ where: { id: { in: docIds } } })
              .catch(() => -1)
          : -1,
        membershipsCreated: docIds.length,
        membershipsResidual: prisma
          ? await prisma.digestoCollectionMembership
              .count({ where: { documentId: { in: docIds } } })
              .catch(() => -1)
          : -1,
        collectionResidual:
          prisma && collectionId
            ? await prisma.digestoCollection
                .count({ where: { id: collectionId } })
                .catch(() => -1)
            : 0,
        searchDocumentsResidual: Number(residual.body.count ?? -1),
        indexedDocumentsRemoved,
        indexedDocumentsCleanupError: indexedDocumentsCleanupError ?? null,
        boundaryDocumentsResidual: Number(boundaryResidual.body.count ?? -1),
        countBefore: baselineCount,
        countAfter: Number(after.body.count ?? -1),
        outbox: finalBacklog,
        activeAliasTarget: activeTargets.join(',') || null,
      };
      cleanup.pass =
        cleanup.documentsResidual === 0 &&
        cleanup.membershipsResidual === 0 &&
        cleanup.collectionResidual === 0 &&
        cleanup.searchDocumentsResidual === 0 &&
        cleanup.boundaryDocumentsResidual === 0 &&
        cleanup.countAfter === baselineCount &&
        finalBacklog.pending === 0 &&
        finalBacklog.failed === 0 &&
        activeTargets.length === 1 &&
        activeTargets[0].startsWith('galilei-search-v001-');
      if (!app && !runtimeStarted) {
        await runtime.index.close().catch(() => undefined);
        await runtime.client.close().catch(() => undefined);
      }
    }
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (app) await app.close().catch(() => undefined);

    const report = {
      generatedAt: new Date().toISOString(),
      startedAt,
      candidate: index,
      certificateAlias: certAlias,
      route:
        'GET /api/busqueda/avanzada?q=<quoted-phrase>&digestoCollectionId=<minimal synthetic collection>',
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      fixture: {
        corpusDocuments: docIds.length,
        collectionMemberships: docIds.length,
      },
      httpCases: {
        expected: fixtures.length,
        passed: rows.filter((row) => row.pass === true).length,
        rows,
      },
      fieldBoundary: {
        case: 'responsabilidad|civil split across sentencia and sumario scopes',
        layer:
          'OpenSearch product DSL (direct query; Corpus HTTP model has one source text scope)',
        ...boundary,
      },
      recoveredResiduals,
      combinedExpected: 22,
      combinedPassed:
        rows.filter((row) => row.pass === true).length +
        (boundary.pass === true ? 1 : 0),
      cleanup,
      queryTextPersisted: false,
      documentTextPersisted: false,
      pass:
        rows.length === fixtures.length &&
        rows.every((row) => row.pass === true) &&
        boundary.pass === true &&
        cleanup.pass === true,
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify(
        { ...report, httpCases: { ...report.httpCases, rows: undefined } },
        null,
        2,
      ),
    );
    if (!report.pass) process.exitCode = 1;
  }
}

async function runBoundaryDslCheck(
  runtime: OpenSearchRuntimeService,
): Promise<Record<string, unknown>> {
  const text = normalizeSearchText('responsabilidad civil');
  const scope = (value: string) => {
    const normalized = normalizeSearchText(value);
    return {
      text: normalized,
      tokens: lexicalTokens(normalized),
      phraseSequence: phraseSequence(normalized),
      phraseBigrams: phraseBigramSequence(normalized),
    };
  };
  await runtime.client.index({
    index,
    id: boundaryIndexId,
    refresh: true,
    body: {
      id: boundarySourceId,
      sourceSystem: 'JURISPRUDENCIA',
      sourceType: 'SENTENCIA',
      documentType: 'JURISPRUDENCIA_SENTENCIA',
      title: 'INT151 field boundary',
      visibility: 'PUBLIC',
      documentScope: 'JURISPRUDENCE',
      status: 'PUBLICADA',
      active: true,
      updatedAt: new Date().toISOString(),
      canonicalSearchText: text,
      publicSearchText: text,
      lexicalTokens: lexicalTokens(text),
      publicLexicalTokens: lexicalTokens(text),
      phraseSequence: phraseSequence(text),
      publicPhraseSequence: phraseSequence(text),
      phraseBigrams: phraseBigramSequence(text),
      publicPhraseBigrams: phraseBigramSequence(text),
      searchScopeFields: {
        sentencia: scope('responsabilidad'),
        sumario: scope('civil'),
      },
      publicSearchScopeFields: {
        sentencia: scope('responsabilidad'),
        sumario: scope('civil'),
      },
      publicationStatus: 'PUBLISHED',
    },
  });
  const context: SearchContext = {
    visibility: 'PUBLIC',
    dialect: 'modern',
    publicationPolicy: 'published-active-only',
    page: 1,
    pageSize: 10,
    documentKinds: ['SENTENCIA'],
    sourceSystems: ['JURISPRUDENCIA'],
    filters: { buscarEn: ['sentencia', 'sumario'] },
    sort: { field: 'relevancia', order: 'desc' },
  };
  const built = buildSearchQueryDsl(
    parseSearchQuery('"responsabilidad civil"'),
    context,
    { source: 'JURISPRUDENCIA' },
  );
  const result = await runtime.client.search({
    index,
    body: {
      size: 10,
      track_total_hits: true,
      query: {
        bool: { filter: [{ term: { id: boundarySourceId } }], must: [built] },
      },
    },
  });
  const body = result.body as SearchBody;
  const total = body.hits?.total?.value ?? -1;
  return { expectedTotal: 0, actualTotal: total, pass: total === 0 };
}

async function waitForOutbox(runtime: OpenSearchRuntimeService) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await runtime.syncWorker.tick();
    const status = await runtime.repository.outboxStatus();
    if (status.failed > 0) throw new Error('INT151_ADVERSARIAL_OUTBOX_FAILED');
    if (status.pending === 0) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('INT151_ADVERSARIAL_OUTBOX_DRAIN_TIMEOUT');
}

async function removeIndexedAdversarialFixtures(
  runtime: OpenSearchRuntimeService,
): Promise<number> {
  const response = await runtime.client.search({
    index,
    body: {
      size: 100,
      track_total_hits: true,
      _source: ['id'],
      query: { prefix: { id: { value: 'int151_adv_' } } },
    },
  });
  const hits =
    (
      response.body as {
        hits?: { hits?: Array<{ _id: string; _source?: { id?: string } }> };
      }
    ).hits?.hits ?? [];
  for (const hit of hits) {
    const sourceId = hit._source?.id ?? '';
    if (
      !/^int151_adv_\d+_\d+_\d{2}$/.test(sourceId) ||
      hit._id !== `CORPUS:${sourceId}`
    )
      throw new Error('UNEXPECTED_ADVERSARIAL_INDEX_FIXTURE_MATCH');
    await runtime.client.delete({ index, id: hit._id });
  }
  if (hits.length) await runtime.client.indices.refresh({ index });
  return hits.length;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'INT151_ADVERSARIAL_FAILED',
  );
  process.exitCode = 1;
});
