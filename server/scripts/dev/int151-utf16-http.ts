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
import { CorpusModule } from '../../src/corpus/corpus.module';
import type { AuthenticatedUser } from '../../src/auth/types/authenticated-user.type';
import type { NextFunction, Request, Response } from 'express';

const index = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const candidateAlias = 'galilei-search-int151-cert';
const activeAlias = 'galilei-search-active';
const artifactRoot = resolve(
  process.cwd(),
  '../_recovery-work/search-engine-integration1',
);
const outputPath = resolve(artifactRoot, 'utf16-1_5_1.json');
const runId = `${Date.now()}_${process.pid}`;
const documentId = `int151_utf16_${runId}`;
const marker = `zzint151utf16${Date.now()}`;
const rawPage = '📚 Daño y responsabilidad. Acción, niño. Expediente 123/2024.';

type HttpResult = {
  status: number;
  total: number;
  matches: Array<{ start: number; end: number; text: string; context: string }>;
};
type RequestWithUser = Request & { user?: AuthenticatedUser };

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
  let collectionId: string | undefined;
  let fileId: string | undefined;
  let extractionId: string | undefined;
  let baselineCount = -1;
  let port: number | undefined;
  const rows: Array<Record<string, unknown>> = [];
  let searchRow: Record<string, unknown> = { pass: false };
  let cleanup: Record<string, unknown> = { pass: false };
  let report: Record<string, unknown> = { status: 'NOT_RUN', pass: false };
  const startedAt = new Date().toISOString();

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
        CorpusModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(
      (request: RequestWithUser, _response: Response, next: NextFunction) => {
        request.user = {
          id: 7,
          nombre: 'INT151 UTF16 administrator',
          apellido: null,
          email: 'int151-utf16@example.invalid',
          activo: true,
          rol: { id: 1, nombre: 'ADMIN', descripcion: null },
          createdAt: new Date('2020-01-01T00:00:00.000Z'),
          updatedAt: new Date('2020-01-01T00:00:00.000Z'),
        };
        next();
      },
    );
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
      throw new Error('UTF16_CANDIDATE_ALIAS_MISMATCH');
    if (
      Object.keys(active.body).length !== 1 ||
      !Object.keys(active.body)[0].startsWith('galilei-search-v001-')
    )
      throw new Error('UTF16_ACTIVE_ALIAS_MUST_REMAIN_V1');

    searchRuntime.onModuleInit();
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address();
    port = address?.port;
    if (!port) throw new Error('UTF16_HTTP_PORT_MISSING');
    const before = await searchRuntime.client.count({ index });
    baselineCount = Number(before.body.count ?? -1);
    if (baselineCount !== 69313)
      throw new Error('UTF16_CANDIDATE_BASELINE_MISMATCH');
    const outboxBefore = await searchRuntime.repository.outboxStatus();
    if (outboxBefore.pending || outboxBefore.failed)
      throw new Error('UTF16_OUTBOX_PRECONDITION_FAILED');

    await dbService.corpusDocument.create({
      data: {
        id: documentId,
        title: `INT151 UTF16 ${marker}`,
        documentType: 'INT151_UTF16',
        jurisdiction: 'CIVIL',
        visibility: 'PUBLIC',
        documentScope: 'GENERAL',
        status: 'INDEXED',
        searchText: marker,
      },
    });
    const collection = await dbService.digestoCollection.create({
      data: {
        name: `INT151 UTF16 ${runId}`,
        normalized: `int151-utf16-${runId}`,
      },
    });
    collectionId = collection.id;
    await dbService.digestoCollectionMembership.create({
      data: { collectionId: collection.id, documentId },
    });
    const file = await dbService.corpusDocumentFile.create({
      data: {
        documentId,
        originalFilename: 'utf16-fixture.txt',
        mimeType: 'text/plain',
        storageKey: `int151/utf16/${runId}`,
        sizeBytes: BigInt(Buffer.byteLength(rawPage, 'utf8')),
        sha256: 'a'.repeat(64),
      },
      select: { id: true },
    });
    fileId = file.id;
    const extraction = await dbService.corpusExtraction.create({
      data: {
        documentId,
        fileId,
        extractor: 'INT151_UTF16_FIXTURE',
        extractorVersion: '1',
        status: 'COMPLETE',
        text: rawPage,
        pages: {
          create: {
            pageNumber: 1,
            text: rawPage,
            textKind: 'NATIVE',
            processingStatus: 'TEXT_NATIVE',
          },
        },
      },
      select: { id: true },
    });
    extractionId = extraction.id;
    await dbService.corpusDocument.update({
      where: { id: documentId },
      data: { latestExtractionId: extraction.id },
    });
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });

    const searchUrl = new URL(`http://127.0.0.1:${port}/api/busqueda/avanzada`);
    searchUrl.searchParams.set('q', marker);
    searchUrl.searchParams.set('digestoCollectionId', collection.id);
    searchUrl.searchParams.set('page', '1');
    searchUrl.searchParams.set('pageSize', '10');
    const searchResponse = await fetch(searchUrl, {
      signal: AbortSignal.timeout(15000),
    });
    const searchBody = (await searchResponse.json()) as {
      federated?: {
        total?: number;
        totalExact?: boolean;
        results?: Array<{ sourceId?: string }>;
      };
    };
    const searchIds = (searchBody.federated?.results ?? []).map((row) =>
      String(row.sourceId ?? ''),
    );
    searchRow = {
      status: searchResponse.status,
      total: searchBody.federated?.total ?? null,
      totalExact: searchBody.federated?.totalExact === true,
      idFound: searchIds.includes(documentId),
      pass:
        searchResponse.status === 200 &&
        searchBody.federated?.total === 1 &&
        searchBody.federated?.totalExact === true &&
        searchIds.length === 1 &&
        searchIds[0] === documentId,
    };

    const cases = [
      {
        id: 'prefix-after-astral-symbol',
        q: 'respons%',
        expectedText: 'respons',
      },
      { id: 'suffix-match', q: '%bilidad', expectedText: 'bilidad' },
      {
        id: 'quoted-exact-phrase',
        q: '"daño y responsabilidad"',
        expectedText: 'Daño y responsabilidad',
      },
      { id: 'accent-tolerance', q: 'accion', expectedText: 'Acción' },
      { id: 'enye-distinct-from-n', q: 'nino', expectedText: null },
      { id: 'enye-exact', q: 'niño', expectedText: 'niño' },
      { id: 'numeric-token', q: '123/2024', expectedText: '123/2024' },
    ];
    for (const testCase of cases) {
      const url = new URL(
        `http://127.0.0.1:${port}/api/corpus/documents/${documentId}/matches`,
      );
      url.searchParams.set('q', testCase.q);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const body = (await response.json()) as HttpResult;
      const expectedStart = testCase.expectedText
        ? rawPage.indexOf(testCase.expectedText)
        : -1;
      const match = testCase.expectedText
        ? body.matches.find((row) => row.text === testCase.expectedText)
        : undefined;
      const allTextWellFormed = body.matches.every(
        (row) => isWellFormed(row.text) && isWellFormed(row.context),
      );
      const pass =
        response.status === 200 &&
        (testCase.expectedText === null
          ? body.total === 0 && body.matches.length === 0
          : body.total >= 1 &&
            match !== undefined &&
            match.start === expectedStart &&
            match.end === expectedStart + testCase.expectedText.length) &&
        allTextWellFormed;
      rows.push({
        id: testCase.id,
        querySha256: sha(testCase.q),
        status: response.status,
        expectedStart,
        actualStart: match?.start ?? null,
        expectedEnd: testCase.expectedText
          ? expectedStart + testCase.expectedText.length
          : null,
        actualEnd: match?.end ?? null,
        expectedTextSha256: testCase.expectedText
          ? sha(testCase.expectedText)
          : null,
        actualTextSha256: match ? sha(match.text) : null,
        total: body.total,
        noUnpairedSurrogates: allTextWellFormed,
        pass,
      });
      console.log(`utf16 ${testCase.id}: ${pass ? 'PASS' : 'FAIL'}`);
    }
    const outbox = await searchRuntime.repository.outboxStatus();
    report = {
      generatedAt: new Date().toISOString(),
      startedAt,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidate: index,
      route:
        'GET /api/busqueda/avanzada → GET /api/corpus/documents/:id/matches',
      fixture: {
        documentId,
        markerSha256: sha(marker),
        pageSha256: sha(rawPage),
        astralCodePointAtStart: 'U+1F4DA',
      },
      search: searchRow,
      expectedCases: cases.length,
      passedCases: rows.filter((row) => row.pass === true).length,
      rows,
      outbox,
      pass:
        searchRow.pass === true &&
        rows.length === cases.length &&
        rows.every((row) => row.pass === true) &&
        outbox.pending === 0 &&
        outbox.failed === 0,
    };
  } finally {
    if (prisma) {
      if (collectionId)
        await prisma.digestoCollection
          .deleteMany({ where: { id: collectionId } })
          .catch(() => undefined);
      await prisma.corpusDocument
        .deleteMany({ where: { id: documentId } })
        .catch(() => undefined);
    }
    if (runtime) {
      await drain(runtime).catch(() => undefined);
      await runtime.client.indices.refresh({ index }).catch(() => undefined);
      const residual = await runtime.client
        .count({
          index,
          body: { query: { ids: { values: [`CORPUS:${documentId}`] } } },
        })
        .catch(() => ({ body: { count: -1 } }));
      const after = await runtime.client
        .count({ index })
        .catch(() => ({ body: { count: -1 } }));
      const finalOutbox = await runtime.repository
        .outboxStatus()
        .catch(() => ({ pending: -1, failed: -1 }));
      cleanup = {
        documentResidual: prisma
          ? await prisma.corpusDocument
              .count({ where: { id: documentId } })
              .catch(() => -1)
          : -1,
        membershipResidual: prisma
          ? await prisma.digestoCollectionMembership
              .count({ where: { documentId } })
              .catch(() => -1)
          : -1,
        collectionResidual:
          prisma && collectionId
            ? await prisma.digestoCollection
                .count({ where: { id: collectionId } })
                .catch(() => -1)
            : 0,
        extractionFixtureCreated: extractionId !== undefined,
        fileFixtureCreated: fileId !== undefined,
        searchDocumentResidual: Number(residual.body.count ?? -1),
        countBefore: baselineCount,
        countAfter: Number(after.body.count ?? -1),
        outbox: finalOutbox,
      };
      cleanup.pass =
        cleanup.documentResidual === 0 &&
        cleanup.membershipResidual === 0 &&
        cleanup.collectionResidual === 0 &&
        cleanup.searchDocumentResidual === 0 &&
        cleanup.countAfter === baselineCount &&
        finalOutbox.pending === 0 &&
        finalOutbox.failed === 0;
      report.cleanup = cleanup;
      report.pass = report.pass === true && cleanup.pass === true;
      report.status = report.pass ? 'PASS' : 'FAIL';
    } else {
      report.pass = false;
      report.status = 'FAIL';
    }
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (app) await app.close().catch(() => undefined);
    else if (runtime) await runtime.onModuleDestroy().catch(() => undefined);
    console.log(JSON.stringify(report, null, 2));
    if (report.pass !== true) process.exitCode = 1;
  }
}

async function drain(runtime: OpenSearchRuntimeService) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await runtime.syncWorker.tick();
    const status = await runtime.repository.outboxStatus();
    if (status.failed > 0) throw new Error('UTF16_OUTBOX_FAILED');
    if (status.pending === 0) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('UTF16_OUTBOX_TIMEOUT');
}

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'UTF16_HTTP_FAILED');
  process.exitCode = 1;
});
