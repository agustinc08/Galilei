import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import type { SearchQueryAst } from '../../src/busqueda/utils/search-ast';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../../src/busqueda/opensearch/opensearch-index.service';

type ReferencePhrase = {
  index: number;
  queryHash: string;
  total: number;
  idSetHash: string;
};

type HttpPage = {
  federated?: {
    results?: Array<{ sourceId?: string }>;
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
  };
};

loadLocalEnvironment();

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  if (process.env.OPENSEARCH_INDEX_ALIAS !== 'galilei-search-int15-cert')
    throw new Error('OPENSEARCH_CERT_ALIAS_REQUIRED');
  if (process.argv.includes('--recover-temp-collection')) {
    await recoverInterruptedCollection();
    return;
  }

  const root = resolve(process.cwd(), '..');
  const artifactRoot = resolve(
    root,
    '_recovery-work',
    'search-engine-integration1',
  );
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
  const expected = reference.phrase100 as ReferencePhrase[];
  const context = {
    visibility: 'INTERNAL' as const,
    dialect: 'modern' as const,
    publicationPolicy: 'published-active-only' as const,
    page: 1,
    pageSize: 100,
    sourceSystems: ['CORPUS' as const],
  };
  const prisma = new PrismaService();
  const runtime = new OpenSearchRuntimeService();
  let app: INestApplication | undefined;
  let collectionId: string | undefined;
  let runtimeStarted = false;
  let queryCount = 0;
  let candidateIndex = '';
  const initialFreeBytes = getFreeBytes(root);
  const startedAt = new Date().toISOString();

  try {
    await prisma.$connect();
    const config = readOpenSearchConfig();
    const os = new Client(config.clientOptions);
    try {
      const aliases = responseBody<Record<string, unknown>>(
        await os.indices.getAlias({ index: 'galilei-search-*' }),
      );
      const certAlias = responseBody<Record<string, unknown>>(
        await os.indices.getAlias({ name: 'galilei-search-int15-cert' }),
      );
      const mainAlias = responseBody<Record<string, unknown>>(
        await os.indices.getAlias({ name: 'galilei-search-active' }),
      );
      candidateIndex = Object.keys(certAlias)[0] ?? '';
      const mainTargets = Object.keys(mainAlias);
      if (
        candidateIndex !== 'galilei-search-v003-20261017t232432555z-a6af18cb' ||
        Object.keys(aliases).length < 1 ||
        mainTargets.length !== 1 ||
        !mainTargets[0].startsWith('galilei-search-v001-')
      )
        throw new Error('OPENSEARCH_ALIAS_PRECONDITION_FAILED');
      const mapping = await os.indices.getMapping({ index: candidateIndex });
      const mappingBody =
        responseBody<
          Record<
            string,
            { mappings?: { _meta?: { galileiSearchSchemaVersion?: number } } }
          >
        >(mapping);
      const schemaVersion = Number(
        mappingBody[candidateIndex]?.mappings?._meta
          ?.galileiSearchSchemaVersion,
      );
      if (schemaVersion !== 3)
        throw new Error('OPENSEARCH_CANDIDATE_SCHEMA_INVALID');
    } finally {
      await os.close();
    }

    const eligible = await prisma.corpusDocument.findMany({
      where: {
        documentScope: 'GENERAL',
        visibility: { in: ['PUBLIC', 'INTERNAL'] },
        status: { in: ['INDEXED', 'OCR_REQUIRED'] },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (eligible.length !== 17077)
      throw new Error('CORPUS_ELIGIBILITY_COUNT_CHANGED');

    const sample = await prisma.corpusDocument.findMany({
      where: {
        id: { in: sampleIds },
        documentScope: 'GENERAL',
        visibility: { in: ['PUBLIC', 'INTERNAL'] },
        status: { in: ['INDEXED', 'OCR_REQUIRED'] },
      },
      select: { id: true, searchText: true },
    });
    const byId = new Map(sample.map((row) => [row.id, row.searchText]));
    const sampleDocs = sampleIds
      .filter((id) => byId.has(id))
      .map((id) => ({ id, text: byId.get(id)! }))
      .sort((left, right) => sha256(left.id).localeCompare(sha256(right.id)));
    const phraseCandidates = new Map<string, string>();
    for (let i = 0; i < Math.min(180, sampleDocs.length); i += 1) {
      const words = normalizeSearchText(sampleDocs[i].text).split(/\s+/u);
      const length = 3 + (i % 4);
      if (words.length < length) continue;
      const start = (i * 17 + length * 31) % (words.length - length + 1);
      const phrase = words.slice(start, start + length).join(' ');
      if (
        phrase.length >= 5 &&
        phrase.length <= 200 &&
        !phraseCandidates.has(phrase)
      )
        phraseCandidates.set(phrase, phrase);
    }

    runtime.onModuleInit();
    runtimeStarted = true;
    const corpusIds = eligible.map((row) => row.id);
    const collection = await prisma.digestoCollection.create({
      data: {
        name: `INT-1.5 phrase100 ${Date.now()}`,
        normalized: `int15-phrase100-${Date.now()}`,
      },
    });
    collectionId = collection.id;
    for (let offset = 0; offset < corpusIds.length; offset += 500) {
      await prisma.digestoCollectionMembership.createMany({
        data: corpusIds.slice(offset, offset + 500).map((documentId) => ({
          collectionId: collection.id,
          documentId,
        })),
      });
    }
    await waitForOutbox(runtime, 45 * 60 * 1000);

    const client = runtime.client;
    const phrases: Array<{ phrase: string; queryHash: string }> = [];
    for (const phrase of phraseCandidates.values()) {
      const queryHash = sha256(phrase);
      const count = await countMatches(
        client,
        process.env.OPENSEARCH_INDEX_ALIAS,
        phraseAst(phrase),
        context,
      );
      if (count > 0 && count <= 10000) phrases.push({ phrase, queryHash });
      if (phrases.length === 100) break;
    }
    if (phrases.length !== 100 || expected.length !== 100)
      throw new Error('PHRASE100_REFERENCE_SET_INCOMPLETE');
    if (
      phrases.some((row, index) => row.queryHash !== expected[index]?.queryHash)
    )
      throw new Error('PHRASE100_REFERENCE_SET_MISMATCH');

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
    app = moduleRef.createNestApplication();
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
    app.get(BusquedaService).trackAdvancedV2 = () => undefined;
    const server = app.getHttpServer() as unknown as {
      address(): { port?: number } | string | null;
    };
    const address = server.address();
    if (!address || typeof address === 'string' || !address.port)
      throw new Error('HTTP_TEST_SERVER_START_FAILED');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const rows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < phrases.length; index += 1) {
      const { phrase, queryHash } = phrases[index];
      const expectedRow = expected[index];
      const started = performance.now();
      const ids: string[] = [];
      let page = 1;
      let total: number | undefined;
      let exact = true;
      let status = 0;
      let pages = 0;
      let timedOut = false;
      for (;;) {
        const url = new URL('/api/busqueda/avanzada', baseUrl);
        url.searchParams.set('q', `"${phrase}"`);
        url.searchParams.set('digestoCollectionId', collection.id);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', '100');
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(30000),
          });
          status = response.status;
          if (status !== 200) break;
          const body = (await response.json()) as HttpPage;
          const federated = body.federated;
          if (!federated || federated.totalExact !== true) {
            exact = false;
            break;
          }
          total = federated.total;
          ids.push(
            ...(federated.results ?? []).map((item) =>
              String(item.sourceId ?? ''),
            ),
          );
          pages += 1;
          queryCount += 1;
          if (!federated.hasMore) break;
          page += 1;
          if (page > Math.ceil((total ?? 0) / 100)) {
            exact = false;
            break;
          }
        } catch (error) {
          timedOut = error instanceof Error && error.name === 'TimeoutError';
          exact = false;
          break;
        }
      }

      const actualHash = sha256([...ids].sort().join('\n'));
      const pass =
        status === 200 &&
        exact &&
        total === expectedRow.total &&
        ids.length === expectedRow.total &&
        new Set(ids).size === ids.length &&
        actualHash === expectedRow.idSetHash &&
        queryHash === expectedRow.queryHash;
      rows.push({
        index: index + 1,
        queryHash,
        responseStatus: status,
        expectedTotal: expectedRow.total,
        actualTotal: total ?? null,
        expectedIdSetSha256: expectedRow.idSetHash,
        actualIdSetSha256: actualHash,
        returned: ids.length,
        unique: new Set(ids).size,
        pages,
        elapsedMs: round(performance.now() - started),
        timedOut,
        pass,
      });
      if (!pass && process.env.INT15_STOP_ON_FIRST_PHRASE_MISMATCH === 'true')
        break;
    }

    const failures = rows.filter((row) => row.pass !== true);
    const timings = rows.map((row) => Number(row.elapsedMs));
    const output = {
      generatedAt: new Date().toISOString(),
      suite: 'actual NestJS GET /api/busqueda/avanzada phrase reference set',
      route:
        'GET /api/busqueda/avanzada?q=<quoted-phrase>&digestoCollectionId=<temporary-all-general-corpus>',
      candidateIndex,
      certificateAlias: process.env.OPENSEARCH_INDEX_ALIAS,
      mainAliasTouched: false,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      temporaryCollection: {
        created: true,
        membershipCount: eligible.length,
        removed: false,
      },
      expected: 100,
      attempted: rows.length,
      passed: rows.filter((row) => row.pass === true).length,
      failed: failures.length,
      falsePositives: failures.reduce(
        (sum, row) =>
          sum +
          Math.max(0, Number(row.actualTotal) - Number(row.expectedTotal)),
        0,
      ),
      falseNegatives: failures.reduce(
        (sum, row) =>
          sum +
          Math.max(0, Number(row.expectedTotal) - Number(row.actualTotal)),
        0,
      ),
      pagesRequested: queryCount,
      latencyMs: {
        p50: percentile(timings, 0.5),
        p95: percentile(timings, 0.95),
        p99: percentile(timings, 0.99),
        max: round(Math.max(...timings, 0)),
      },
      timeoutCount: rows.filter((row) => row.timedOut === true).length,
      queryTextPersisted: false,
      documentTextPersisted: false,
      generatedAtStart: startedAt,
      rows,
      pass: rows.length === 100 && failures.length === 0,
    };
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      resolve(artifactRoot, 'http-phrase-100-1_5.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
    if (!output.pass) process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => undefined);
    if (collectionId)
      await prisma.digestoCollection
        .deleteMany({ where: { id: collectionId } })
        .catch(() => undefined);
    if (runtimeStarted) {
      await waitForOutbox(runtime, 45 * 60 * 1000).catch(() => undefined);
      await runtime.onModuleDestroy().catch(() => undefined);
    }
    const final = {
      generatedAt: new Date().toISOString(),
      cleanup: {
        temporaryCollectionRemoved: collectionId
          ? (await prisma.digestoCollection
              .count({ where: { id: collectionId } })
              .catch(() => -1)) === 0
          : true,
      },
      freeBytesBefore: initialFreeBytes,
      freeBytesAfter: getFreeBytes(root),
    };
    writeFileSync(
      resolve(artifactRoot, 'http-phrase-100-cleanup-1_5.json'),
      `${JSON.stringify(final, null, 2)}\n`,
      'utf8',
    );
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function recoverInterruptedCollection() {
  const root = resolve(process.cwd(), '..');
  const artifactRoot = resolve(
    root,
    '_recovery-work',
    'search-engine-integration1',
  );
  const prisma = new PrismaService();
  const config = readOpenSearchConfig();
  const client = new Client(config.clientOptions);
  const repository = new OpenSearchDocumentRepository();
  const index = new OpenSearchIndexService(client, repository, config.alias);
  const freeBefore = getFreeBytes(root);
  const startedAt = new Date().toISOString();
  try {
    await prisma.$connect();
    const aliases = responseBody<Record<string, unknown>>(
      await client.indices.getAlias({ name: 'galilei-search-int15-cert' }),
    );
    const mainAliases = responseBody<Record<string, unknown>>(
      await client.indices.getAlias({ name: 'galilei-search-active' }),
    );
    const candidate = Object.keys(aliases)[0];
    if (
      candidate !== 'galilei-search-v003-20261017t232432555z-a6af18cb' ||
      Object.keys(mainAliases).length !== 1 ||
      !Object.keys(mainAliases)[0].startsWith('galilei-search-v001-')
    )
      throw new Error('OPENSEARCH_ALIAS_PRECONDITION_FAILED');

    const collection = await prisma.digestoCollection.findFirst({
      where: { name: { startsWith: 'INT-1.5 phrase100 ' } },
      select: { id: true, name: true },
    });
    if (!collection) throw new Error('TEMP_COLLECTION_NOT_FOUND');
    const membershipCount = await prisma.digestoCollectionMembership.count({
      where: { collectionId: collection.id },
    });
    const preStatus = await repository.outboxStatus();
    const foreignPending = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM "SearchIndexOutbox"
       WHERE "processedAt" IS NULL AND "failedAt" IS NULL
         AND "documentKey" NOT LIKE 'CORPUS:%'
    `;
    if (preStatus.failed || Number(foreignPending[0]?.count ?? 0) !== 0)
      throw new Error('TEMP_RECOVERY_OUTBOX_PRECONDITION_FAILED');

    const indexedIds = await collectCollectionIndexedIds(
      client,
      candidate,
      collection.id,
    );
    await prisma.digestoCollection.delete({ where: { id: collection.id } });

    let processedIds = 0;
    const errors: Array<{ id: string; code: string }> = [];
    for (let offset = 0; offset < indexedIds.length; offset += 8) {
      const batch = indexedIds.slice(offset, offset + 8);
      const results = await Promise.allSettled(
        batch.map((id) => index.indexKey(`CORPUS:${id}`)),
      );
      results.forEach((result, position) => {
        if (result.status === 'fulfilled') processedIds += 1;
        else
          errors.push({
            id: batch[position],
            code: safeErrorCode(result.reason),
          });
      });
      if (errors.length) throw new Error('TEMP_RECOVERY_REINDEX_FAILED');
    }
    await client.indices.refresh({ index: candidate });

    const staleCollectionHits = await countCollectionHits(
      client,
      candidate,
      collection.id,
    );
    if (staleCollectionHits !== 0)
      throw new Error('TEMP_COLLECTION_INDEX_VALUES_REMAIN');

    const acknowledged = await prisma.searchIndexOutbox.updateMany({
      where: {
        processedAt: null,
        failedAt: null,
        documentKey: { startsWith: 'CORPUS:' },
      },
      data: {
        processedAt: new Date(),
        leaseUntil: null,
        failedAt: null,
        lastError: null,
      },
    });
    const finalOutbox = await repository.outboxStatus();
    const countResponse = responseBody<{ count: number }>(
      await client.count({
        index: candidate,
        body: { query: { match_all: {} } },
      }),
    );
    if (finalOutbox.pending !== 0 || finalOutbox.failed !== 0)
      throw new Error('TEMP_RECOVERY_OUTBOX_NOT_CLEAR');

    const output = {
      generatedAt: new Date().toISOString(),
      recovery: 'interrupted phrase100 temporary collection cleanup',
      startedAt,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidate,
      mainAliasUnchanged: Object.keys(mainAliases)[0],
      temporaryCollection: {
        idPersisted: false,
        membershipCountBeforeCleanup: membershipCount,
        indexedTemporaryDocsReverted: processedIds,
        priorOutboxFailed: preStatus.failed,
      },
      outbox: {
        acknowledgedByDocumentState: acknowledged.count,
        pending: finalOutbox.pending,
        failed: finalOutbox.failed,
      },
      indexCount: countResponse.count,
      staleTemporaryCollectionHits: staleCollectionHits,
      freeBytesBefore: freeBefore,
      freeBytesAfter: getFreeBytes(root),
      exactCandidateIdSetReverified: false,
      pass:
        processedIds === indexedIds.length &&
        staleCollectionHits === 0 &&
        finalOutbox.pending === 0 &&
        finalOutbox.failed === 0 &&
        countResponse.count === 69313,
      caveat:
        'Rows never projected into OpenSearch were already at their pre-test source state; pending no-op outbox events were acknowledged after all indexed temporary IDs were reverted via the production indexKey projection path.',
    };
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      resolve(artifactRoot, 'http-phrase-100-cleanup-1_5.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(output, null, 2));
    if (!output.pass) process.exitCode = 1;
  } finally {
    await index.close().catch(() => undefined);
    await client.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function collectCollectionIndexedIds(
  client: Client,
  index: string,
  collectionId: string,
) {
  const ids: string[] = [];
  let searchAfter: unknown[] | undefined;
  for (;;) {
    const response = responseBody<{
      hits?: {
        hits?: Array<{ _id: string; sort?: unknown[] }>;
      };
    }>(
      await client.search({
        index,
        body: {
          size: 1000,
          track_total_hits: true,
          _source: false,
          query: { term: { digestoCollectionIds: collectionId } },
          sort: [{ id: 'asc' }],
          ...(searchAfter ? { search_after: searchAfter } : {}),
        },
      }),
    );
    const hits = response.hits?.hits ?? [];
    ids.push(...hits.map((hit) => hit._id));
    if (hits.length < 1000) break;
    searchAfter = hits[hits.length - 1].sort;
    if (!searchAfter) throw new Error('TEMP_RECOVERY_SEARCH_AFTER_MISSING');
  }
  return ids;
}

async function countCollectionHits(
  client: Client,
  index: string,
  collectionId: string,
) {
  const response = responseBody<{ count: number }>(
    await client.count({
      index,
      body: { query: { term: { digestoCollectionIds: collectionId } } },
    }),
  );
  return response.count;
}

function safeErrorCode(error: unknown) {
  const value = (error as { code?: unknown })?.code;
  return typeof value === 'string' && /^[A-Z0-9_]+$/u.test(value)
    ? value
    : 'OPENSEARCH_INDEX_UPDATE_FAILED';
}

async function countMatches(
  client: Client,
  index: string,
  query: SearchQueryAst,
  context: {
    visibility: 'INTERNAL';
    dialect: 'modern';
    publicationPolicy: 'published-active-only';
    page: number;
    pageSize: number;
    sourceSystems: Array<'CORPUS'>;
  },
) {
  const response = await client.search({
    index,
    body: {
      size: 0,
      track_total_hits: true,
      query: buildSearchQueryDsl(query, context, { source: 'CORPUS' }),
    },
  });
  const body =
    (
      response as unknown as {
        body?: { hits?: { total?: { value?: number; relation?: string } } };
        hits?: { total?: { value?: number; relation?: string } };
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

async function waitForOutbox(runtime: OpenSearchRuntimeService, maxMs: number) {
  const started = Date.now();
  let status = await runtime.repository.outboxStatus();
  while (status.pending > 0 && Date.now() - started < maxMs) {
    if (status.failed > 0) throw new Error('OPENSEARCH_OUTBOX_FAILED');
    await runtime.syncWorker.tick();
    status = await runtime.repository.outboxStatus();
    if (status.pending > 0) await new Promise((done) => setTimeout(done, 50));
  }
  if (status.failed > 0) throw new Error('OPENSEARCH_OUTBOX_FAILED');
  if (status.pending > 0) throw new Error('OPENSEARCH_OUTBOX_DRAIN_TIMEOUT');
  return status;
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
  const contents = readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
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

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
function responseBody<T>(response: unknown): T {
  const wrapped = response as { body?: T };
  return wrapped.body ?? (response as T);
}
function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
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
function getFreeBytes(path: string) {
  const root = path.slice(0, 2);
  const value = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-PSDrive -Name ${root[0]}).Free`],
    { encoding: 'utf8' },
  ).trim();
  return Number(value);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'OPENSEARCH_HTTP_PHRASE100_FAILED';
  console.error(
    /^(?:OPENSEARCH|DEV|CORPUS|PHRASE|HTTP|SEARCH)_[A-Z0-9_]+$/u.test(message)
      ? message
      : 'OPENSEARCH_HTTP_PHRASE100_FAILED',
  );
  process.exitCode = 1;
});
