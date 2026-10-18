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
import { SentenciasModule } from '../../src/sentencias/sentencias.module';
import { SentenciasService } from '../../src/sentencias/sentencias.service';

const index = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const candidateAlias = 'galilei-search-int151-cert';
const activeAlias = 'galilei-search-active';
const artifactRoot = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1',
);
const outputPath = resolve(artifactRoot, 'publication-transition-1_5_1.json');

type SearchBody = {
  federated?: {
    total?: number;
    totalExact?: boolean;
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
  process.env.OPENSEARCH_INDEX_ALIAS = candidateAlias;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let runtime: OpenSearchRuntimeService | undefined;
  let sentenceId: number | undefined;
  let baselineCount = -1;
  let report: Record<string, unknown> = { pass: false, status: 'NOT_RUN' };
  const marker = `zzint151publication${Date.now()}`;
  const startedAt = new Date().toISOString();

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
        SentenciasModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const dbService = app.get(PrismaService);
    const searchRuntime = app.get(OpenSearchRuntimeService);
    prisma = dbService;
    runtime = searchRuntime;
    const sentencias = app.get(SentenciasService);
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
      !Object.keys(active.body)[0].startsWith('galilei-search-v001-')
    )
      throw new Error('PUBLICATION_ACTIVE_ALIAS_MUST_REMAIN_V1');

    searchRuntime.onModuleInit();
    await app.listen(0, '127.0.0.1');
    const before = await searchRuntime.client.count({ index });
    baselineCount = Number(before.body.count ?? -1);
    if (baselineCount !== 69313)
      throw new Error('PUBLICATION_CANDIDATE_BASELINE_MISMATCH');
    const initialOutbox = await searchRuntime.repository.outboxStatus();
    if (initialOutbox.pending || initialOutbox.failed)
      throw new Error('PUBLICATION_OUTBOX_NOT_CLEAN');

    const sentence = await dbService.sentencia.create({
      data: {
        caratula: `INT151 publication transition ${marker}`,
        textoBusquedaNormalizado: marker,
        estadoCarga: 'BORRADOR',
        publicado: false,
        activo: true,
      },
      select: { id: true, publicado: true, estadoCarga: true },
    });
    sentenceId = sentence.id;
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    const beforePublish = await publicSearch(app, marker, sentence.id);

    await sentencias.setPublicado(sentence.id, true);
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    const afterPublish = await publicSearch(app, marker, sentence.id);

    await sentencias.setPublicado(sentence.id, false);
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    const afterUnpublish = await publicSearch(app, marker, sentence.id);
    const publishedCensus = await dbService.$queryRaw<
      Array<{ activeSentencias: bigint; published: bigint; other: bigint }>
    >`
      SELECT count(*) FILTER (WHERE "activo" = TRUE) AS "activeSentencias",
             count(*) FILTER (WHERE "activo" = TRUE AND "publicado" = TRUE AND "estadoCarga" = 'PUBLICADA') AS published,
             count(*) FILTER (WHERE "activo" = TRUE AND NOT ("publicado" = TRUE AND "estadoCarga" = 'PUBLICADA')) AS other
        FROM "Sentencia"
       WHERE "id" <> ${sentence.id}`;
    const census = publishedCensus[0];
    const transitionPass =
      beforePublish.status === 200 &&
      beforePublish.total === 0 &&
      beforePublish.ids.length === 0 &&
      afterPublish.status === 200 &&
      afterPublish.total === 1 &&
      afterPublish.totalExact &&
      JSON.stringify(afterPublish.ids) ===
        JSON.stringify([String(sentence.id)]) &&
      afterUnpublish.status === 200 &&
      afterUnpublish.total === 0 &&
      afterUnpublish.totalExact &&
      afterUnpublish.ids.length === 0;
    report = {
      generatedAt: new Date().toISOString(),
      startedAt,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidate: index,
      aliasUntouched: activeAlias,
      fixture: { sentenceId: sentence.id, markerSha256: sha(marker) },
      publicRoute: 'GET /api/public/busqueda?q=<synthetic unique marker>',
      transition: {
        draftAbsent: beforePublish.total === 0,
        publishOutboxSynced: true,
        publishedVisible: afterPublish.total === 1,
        unpublishOutboxSynced: true,
        unpublishedAbsent: afterUnpublish.total === 0,
        beforePublish,
        afterPublish,
        afterUnpublish,
        pass: transitionPass,
      },
      census: {
        activeSentencias: Number(census?.activeSentencias ?? 0),
        published: Number(census?.published ?? 0),
        reviewOrUnpublished: Number(census?.other ?? 0),
      },
      expectedBaseCount: baselineCount,
      pass: transitionPass,
    };
  } finally {
    if (prisma && sentenceId !== undefined) {
      await prisma.sentencia
        .delete({ where: { id: sentenceId } })
        .catch(() => undefined);
      if (runtime) await drain(runtime).catch(() => undefined);
    }
    if (runtime && baselineCount >= 0) {
      await runtime.client.indices.refresh({ index }).catch(() => undefined);
      const residual =
        sentenceId === undefined
          ? { body: { count: -1 } }
          : await runtime.client
              .count({
                index,
                body: {
                  query: {
                    ids: { values: [`JURISPRUDENCIA:SENTENCIA:${sentenceId}`] },
                  },
                },
              })
              .catch(() => ({ body: { count: -1 } }));
      const finalCount = await runtime.client
        .count({ index })
        .catch(() => ({ body: { count: -1 } }));
      const outbox = await runtime.repository
        .outboxStatus()
        .catch(() => ({ pending: -1, failed: -1 }));
      const cleanupPass =
        Number(residual.body.count ?? -1) === 0 &&
        Number(finalCount.body.count ?? -1) === baselineCount &&
        outbox.pending === 0 &&
        outbox.failed === 0;
      report.cleanup = {
        sentenceDeleted: sentenceId !== undefined,
        searchDocumentResidual: Number(residual.body.count ?? -1),
        countBefore: baselineCount,
        countAfter: Number(finalCount.body.count ?? -1),
        outbox,
        pass: cleanupPass,
      };
      report.pass = report.pass === true && cleanupPass;
      report.status = report.pass ? 'PASS' : 'FAIL';
    } else {
      report.pass = false;
      report.status = 'FAIL';
      report.cleanup = { pass: false, error: 'CLEANUP_PRECONDITION_MISSING' };
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

async function publicSearch(app: INestApplication, query: string, id: number) {
  const response = await fetch(
    `http://127.0.0.1:${serverPort(app)}/api/public/busqueda?q=${encodeURIComponent(query)}&pageSize=10`,
    { signal: AbortSignal.timeout(15000) },
  );
  const body = (await response.json()) as SearchBody;
  const ids = (body.federated?.results ?? [])
    .map((row) => String(row.sourceId ?? ''))
    .sort();
  return {
    status: response.status,
    total: body.federated?.total ?? null,
    totalExact: body.federated?.totalExact === true,
    ids,
    expectedId: String(id),
    expectedIdPresent: ids.includes(String(id)),
  };
}

function serverPort(app: INestApplication): number {
  const address = (
    app.getHttpServer() as { address(): { port: number } | null }
  ).address();
  if (!address?.port) throw new Error('PUBLICATION_HTTP_SERVER_NOT_READY');
  return address.port;
}

async function drain(runtime: OpenSearchRuntimeService) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await runtime.syncWorker.tick();
    const status = await runtime.repository.outboxStatus();
    if (status.failed > 0) throw new Error('PUBLICATION_OUTBOX_FAILED');
    if (status.pending === 0) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('PUBLICATION_OUTBOX_DRAIN_TIMEOUT');
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'PUBLICATION_TEST_FAILED',
  );
  process.exitCode = 1;
});
