import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

const index = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const candidateAlias = 'galilei-search-int151-cert';
const activeAlias = 'galilei-search-active';
const artifactRoot = resolve(
  process.cwd(),
  '../_recovery-work/search-engine-integration1',
);
const outputPath = resolve(artifactRoot, 'publication-http-1_5_1.json');

type SearchBody = {
  federated?: {
    total?: number;
    totalExact?: boolean;
    results?: Array<{ sourceId?: string }>;
  };
};

type SearchDocument = {
  id: string;
  sourceSystem?: string;
  sourceType?: string;
  publicationStatus?: string;
  active?: boolean;
  lexicalTokens?: string[];
  publicLexicalTokens?: string[];
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
  process.env.OPENSEARCH_INDEX_ALIAS = candidateAlias;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let runtime: OpenSearchRuntimeService | undefined;
  let report: Record<string, unknown> = { pass: false, status: 'NOT_RUN' };
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
    app.setGlobalPrefix('api');
    const dbService = app.get(PrismaService);
    const searchRuntime = app.get(OpenSearchRuntimeService);
    prisma = dbService;
    runtime = searchRuntime;
    await dbService.$connect();

    const candidate = await searchRuntime.client.indices.getAlias({
      name: candidateAlias,
    });
    const active = await searchRuntime.client.indices.getAlias({
      name: activeAlias,
    });
    if (Object.keys(candidate.body).join(',') !== index)
      throw new Error('PUBLICATION_CANDIDATE_ALIAS_MISMATCH');
    if (
      Object.keys(active.body).length !== 1 ||
      !Object.keys(active.body)[0].startsWith('galilei-search-v004-')
    )
      throw new Error('PUBLICATION_ACTIVE_ALIAS_MUST_REMAIN_V4');

    searchRuntime.onModuleInit();
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address();
    if (!address?.port) throw new Error('PUBLICATION_HTTP_SERVER_NOT_READY');

    const initialOutbox = await searchRuntime.repository.outboxStatus();
    if (initialOutbox.pending || initialOutbox.failed)
      throw new Error('PUBLICATION_OUTBOX_NOT_CLEAN');

    const [activeSentencias, publishedSentencias] = await Promise.all([
      dbService.sentencia.count({ where: { activo: true } }),
      dbService.sentencia.count({
        where: { activo: true, publicado: true, estadoCarga: 'PUBLICADA' },
      }),
    ]);

    const publishedDocument = await searchRuntime.client.get({
      index,
      id: 'JURISPRUDENCIA:SENTENCIA:32470',
    });
    const publishedSource = publishedDocument.body._source as SearchDocument;
    if (publishedSource.publicationStatus !== 'PUBLISHED')
      throw new Error('KNOWN_PUBLISHED_SENTENCIA_NOT_PUBLIC');
    const publishedTokens = uniqueTokens(publishedSource.publicLexicalTokens);
    const publishedProbe = await findVisiblePublished(
      address.port,
      publishedTokens,
      '32470',
    );

    const unpublishedSearch = await searchRuntime.client.search({
      index,
      body: {
        size: 100,
        _source: [
          'id',
          'sourceSystem',
          'sourceType',
          'publicationStatus',
          'active',
          'lexicalTokens',
          'publicLexicalTokens',
        ],
        sort: [{ id: { order: 'asc' } }],
        query: {
          bool: {
            filter: [
              { term: { sourceSystem: 'JURISPRUDENCIA' } },
              { term: { sourceType: 'SENTENCIA' } },
              { term: { publicationStatus: 'UNPUBLISHED' } },
              { term: { active: true } },
            ],
          },
        },
      },
    });
    const unpublishedBody = unpublishedSearch.body as unknown as {
      hits?: { hits?: Array<{ _source?: SearchDocument }> };
    };
    const unpublishedHits = unpublishedBody.hits?.hits ?? [];
    const unpublishedProbe = await findAbsentUnpublished(
      address.port,
      unpublishedHits
        .slice(0, 20)
        .map((hit) => hit._source)
        .filter((source): source is SearchDocument => Boolean(source)),
      searchRuntime,
    );

    const finalOutbox = await searchRuntime.repository.outboxStatus();
    const reviewOrUnpublished = activeSentencias - publishedSentencias;
    const pass =
      publishedProbe.pass &&
      unpublishedProbe.pass &&
      activeSentencias === 27133 &&
      publishedSentencias === 6014 &&
      reviewOrUnpublished === 21119 &&
      finalOutbox.pending === 0 &&
      finalOutbox.failed === 0;
    report = {
      generatedAt: new Date().toISOString(),
      startedAt,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidate: index,
      alias: candidateAlias,
      mainAlias: { name: activeAlias, remainsV4: true },
      route: 'GET /api/public/busqueda',
      census: {
        activeSentencias,
        publishedSentencias,
        reviewOrUnpublished,
      },
      publishedProbe,
      unpublishedProbe,
      leaks: {
        resultLeaks: unpublishedProbe.resultCount,
        countLeaks: unpublishedProbe.total,
      },
      outbox: { before: initialOutbox, after: finalOutbox },
      pass,
      status: pass ? 'PASS' : 'FAIL',
    };
  } finally {
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (app) await app.close().catch(() => undefined);
    else if (runtime) await runtime.onModuleDestroy().catch(() => undefined);
    console.log(JSON.stringify(report, null, 2));
    if (report.pass !== true) process.exitCode = 1;
  }
}

async function findVisiblePublished(
  port: number,
  tokens: string[],
  expectedId: string,
) {
  for (const token of tokens) {
    const result = await publicSearch(port, token);
    const present = result.ids.includes(expectedId);
    if (result.status === 200 && result.totalExact && present) {
      return {
        status: result.status,
        querySha256: sha(token),
        total: result.total,
        totalExact: result.totalExact,
        expectedIdSha256: sha(expectedId),
        returnedIdsSha256: hashIds(result.ids),
        expectedIdPresent: true,
        pass: true,
      };
    }
  }
  return {
    status: 'NOT_FOUND',
    tokensTried: tokens.length,
    expectedIdSha256: sha(expectedId),
    pass: false,
  };
}

async function findAbsentUnpublished(
  port: number,
  documents: SearchDocument[],
  runtime: OpenSearchRuntimeService,
) {
  for (const document of documents) {
    if (
      document.publicationStatus !== 'UNPUBLISHED' ||
      document.active !== true
    )
      continue;
    const candidates = uniqueTokens(document.lexicalTokens).slice(0, 15);
    for (const token of candidates) {
      const indexed = await directUnpublishedHit(runtime, document.id, token);
      if (!indexed) continue;
      const result = await publicSearch(port, token);
      if (
        result.status === 200 &&
        result.totalExact &&
        result.total === 0 &&
        result.ids.length === 0
      ) {
        return {
          expectedIdSha256: sha(document.id),
          querySha256: sha(token),
          directIndexMatchCount: 1,
          directIndexMatchIdSha256: sha(document.id),
          status: result.status,
          total: result.total,
          totalExact: result.totalExact,
          resultCount: result.ids.length,
          returnedIdsSha256: hashIds(result.ids),
          pass: true,
        };
      }
    }
  }
  return {
    indexedUnpublishedCandidates: documents.length,
    tokenCounts: documents.slice(0, 5).map((document) => ({
      documentIdSha256: sha(document.id),
      lexicalTokenCount: document.lexicalTokens?.length ?? 0,
      publicLexicalTokenCount: document.publicLexicalTokens?.length ?? 0,
    })),
    pass: false,
  };
}

async function directUnpublishedHit(
  runtime: OpenSearchRuntimeService,
  id: string,
  token: string,
) {
  const response = await runtime.client.search({
    index,
    body: {
      size: 2,
      query: {
        bool: {
          filter: [
            { term: { id } },
            { term: { publicationStatus: 'UNPUBLISHED' } },
            { term: { active: true } },
            { term: { lexicalTokens: token } },
          ],
        },
      },
    },
  });
  const body = response.body as unknown as {
    hits?: { total?: { value?: number }; hits?: Array<{ _id?: string }> };
  };
  const hits = body.hits?.hits ?? [];
  return (
    Number(body.hits?.total?.value ?? 0) === 1 &&
    hits.length === 1 &&
    hits[0]._id === id
  );
}

async function publicSearch(port: number, query: string) {
  const url = new URL(`http://127.0.0.1:${port}/api/public/busqueda`);
  url.searchParams.set('q', query);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', '10');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = (await response.json()) as SearchBody;
  const ids = (body.federated?.results ?? [])
    .map((row) => String(row.sourceId ?? ''))
    .filter(Boolean)
    .sort();
  return {
    status: response.status,
    total: body.federated?.total ?? null,
    totalExact: body.federated?.totalExact === true,
    ids,
  };
}

function uniqueTokens(values: string[] | undefined) {
  return [...new Set(values ?? [])]
    .filter((token) => token.length >= 5)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function hashIds(ids: string[]) {
  return sha([...ids].sort().join('\n'));
}

function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'PUBLICATION_HTTP_FAILED',
  );
  process.exitCode = 1;
});
