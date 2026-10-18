import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../src/auth/types/authenticated-user.type';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

const index = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const alias = 'galilei-search-int151-cert';
const artifactRoot = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1',
);
const outputPath = resolve(artifactRoot, 'sync-final-1_5_1.json');

type SearchResponse = {
  federated?: {
    total?: number;
    totalExact?: boolean;
    results?: Array<{ sourceId?: string }>;
  };
};

type IndexedCorpusDocument = {
  _source?: {
    mimeType?: string | null;
    workspaceNameFields?: { filename?: string | null };
  };
};

type CaseResult = {
  status: number;
  total: number | null;
  totalExact: boolean;
  ids: string[];
};

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (
    databaseUrl.protocol !== 'postgresql:' ||
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.port !== '55432' ||
    databaseUrl.pathname !== '/buscador_juridico_civil_dev' ||
    databaseUrl.username !== 'bjc_dev'
  )
    throw new Error('DEV_DB_GUARD_REQUIRED');

  process.env.NODE_ENV = 'development';
  process.env.SEARCH_ENGINE = 'opensearch';
  process.env.OPENSEARCH_INDEX_ALIAS = alias;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let runtime: OpenSearchRuntimeService | undefined;
  let documentId: string | undefined;
  let collectionId: string | undefined;
  let baselineCount = -1;
  const marker = `zzint151sync${Date.now().toString(36)}`;
  const ocrMarker = `${marker}ocrtext`;
  const oldCase = `${marker}-case-old`;
  const newCase = `${marker}-case-new`;
  const startedAt = new Date().toISOString();
  const report: Record<string, unknown> = {
    status: 'NOT_RUN',
    pass: false,
    startedAt,
    target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
    candidate: index,
    alias,
    route:
      'GET /api/busqueda/avanzada?q=<marker>&digestoCollectionId=<synthetic>',
    fixture: { markerSha256: sha(marker), ocrMarkerSha256: sha(ocrMarker) },
    cases: {},
  };

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
    const dbService = app.get(PrismaService);
    const searchRuntime = app.get(OpenSearchRuntimeService);
    prisma = dbService;
    runtime = searchRuntime;
    await dbService.$connect();

    const identity = await dbService.$queryRaw<
      Array<{ database: string; role: string; port: number }>
    >`SELECT current_database() AS database, current_user AS role, inet_server_port() AS port`;
    const target = identity[0];
    if (
      target?.database !== 'buscador_juridico_civil_dev' ||
      target.role !== 'bjc_dev' ||
      Number(target.port) !== 55432
    )
      throw new Error('DEV_DB_GUARD_TARGET_MISMATCH');

    const candidate = await searchRuntime.client.indices.getAlias({
      name: alias,
    });
    if (Object.keys(candidate.body).length !== 1 || !(index in candidate.body))
      throw new Error('SYNC_CANDIDATE_ALIAS_MISMATCH');
    const active = await searchRuntime.client.indices.getAlias({
      name: 'galilei-search-active',
    });
    if (
      Object.keys(active.body).length !== 1 ||
      !Object.keys(active.body)[0].startsWith('galilei-search-v001-')
    )
      throw new Error('ACTIVE_ALIAS_MUST_REMAIN_V1_DURING_CERTIFICATION');

    const initialOutbox = await searchRuntime.repository.outboxStatus();
    if (initialOutbox.pending !== 0 || initialOutbox.failed !== 0)
      throw new Error('SYNC_INITIAL_OUTBOX_NOT_CLEAN');
    baselineCount = Number(
      (await searchRuntime.client.count({ index })).body.count,
    );
    if (baselineCount !== 69313)
      throw new Error('SYNC_CANDIDATE_BASELINE_MISMATCH');

    const admin = await dbService.usuario.findFirst({
      where: { rol: { nombre: 'ADMIN' }, activo: true },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        activo: true,
        rolId: true,
        rol: { select: { id: true, nombre: true, descripcion: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    if (!admin) throw new Error('SYNC_HTTP_ADMIN_ACTOR_MISSING');
    const actor: AuthenticatedUser = {
      id: admin.id,
      nombre: admin.nombre,
      apellido: admin.apellido,
      email: admin.email,
      activo: admin.activo,
      rol: { ...admin.rol, nombre: 'ADMIN' },
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    };
    app.use((_request: Request, _response: Response, next: NextFunction) => {
      (_request as Request & { user?: AuthenticatedUser }).user = actor;
      next();
    });
    await app.listen(0, '127.0.0.1');
    const port = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address()?.port;
    if (!port) throw new Error('SYNC_HTTP_PORT_MISSING');

    const collection = await dbService.digestoCollection.create({
      data: {
        name: `INT151 sync ${marker}`,
        normalized: `int151-sync-${marker}`,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    collectionId = collection.id;
    const doc = await dbService.corpusDocument.create({
      data: {
        title: `INT151 sync fixture ${marker}`,
        documentType: 'INT151_SYNC_FIXTURE',
        jurisdiction: 'CIVIL',
        caseNumber: oldCase,
        visibility: 'PUBLIC',
        documentScope: 'GENERAL',
        status: 'INDEXED',
        editorialStatus: 'APPROVED',
        anonymizationStatus: 'ANONYMIZED',
        searchText: `${marker} synthetic sync fixture`,
        digestoCollections: { create: { collectionId: collection.id } },
        files: {
          create: {
            storageKey: `int151/sync/${marker}/version-1.txt`,
            originalFilename: 'version-1.txt',
            mimeType: 'text/plain',
            sizeBytes: 40n,
            sha256: sha(`${marker}:file-v1`),
            version: 1,
          },
        },
      },
      select: { id: true, files: { select: { id: true, version: true } } },
    });
    documentId = doc.id;
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });

    const createResult = await request(port, collection.id, marker);
    const createPass = hasOnly(createResult, doc.id);
    const beforeFileUpdate = (await searchRuntime.client.get({
      index,
      id: doc.id,
    })) as unknown as { body?: IndexedCorpusDocument };
    const beforeFileSource = beforeFileUpdate.body?._source ?? {};
    const beforeFilename = beforeFileSource.workspaceNameFields?.filename;
    report.cases = {
      create: {
        pass: createPass,
        expectedIdSha256: hashIds([doc.id]),
        actualIdSha256: hashIds(createResult.ids),
        result: summarize(createResult),
      },
    };
    if (!createPass) throw new Error('SYNC_CREATE_HTTP_MISMATCH');

    const pdfFile = await dbService.corpusDocumentFile.create({
      data: {
        documentId: doc.id,
        storageKey: `int151/sync/${marker}/version-2.pdf`,
        originalFilename: 'version-2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 128n,
        sha256: sha(`${marker}:file-v2-pdf`),
        version: 2,
      },
      select: { id: true },
    });
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    const pdfResult = await request(port, collection.id, marker);
    const afterFileUpdate = (await searchRuntime.client.get({
      index,
      id: doc.id,
    })) as unknown as { body?: IndexedCorpusDocument };
    const afterFileSource = afterFileUpdate.body?._source ?? {};
    const docPass =
      beforeFileSource.mimeType === 'text/plain' &&
      beforeFilename === 'version-1.txt' &&
      afterFileSource.mimeType === 'application/pdf' &&
      afterFileSource.workspaceNameFields?.filename === 'version-2.pdf' &&
      hasOnly(pdfResult, doc.id);
    (report.cases as Record<string, unknown>).DOC = {
      pass: docPass,
      beforeHigherVersionPdf: {
        mimeType: beforeFileSource.mimeType,
        latestFilename: beforeFilename,
      },
      afterHigherVersionPdf: {
        mimeType: afterFileSource.mimeType,
        latestFilename: afterFileSource.workspaceNameFields?.filename,
        search: summarize(pdfResult),
      },
    };
    if (!docPass) throw new Error('SYNC_DOC_HTTP_MISMATCH');

    const extraction = await dbService.corpusExtraction.create({
      data: {
        documentId: doc.id,
        fileId: pdfFile.id,
        extractor: 'int151-sync-fixture',
        extractorVersion: '1',
        status: 'SUCCEEDED',
        text: `${ocrMarker} extracción OCR sintética`,
        provenance: {
          synthetic: true,
          mission: 'SEARCH-ENGINE-INTEGRATION-1.5.1',
        },
      },
      select: { id: true },
    });
    await dbService.corpusDocumentPage.create({
      data: {
        extractionId: extraction.id,
        pageNumber: 1,
        text: `${ocrMarker} extracción OCR sintética`,
        textKind: 'OCR',
        processingStatus: 'OCR_COMPLETED',
        ocrConfidence: 0.99,
      },
    });
    await dbService.corpusDocument.update({
      where: { id: doc.id },
      data: {
        latestExtractionId: extraction.id,
        searchText: `${marker} synthetic sync fixture ${ocrMarker}`,
      },
    });
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    const ocrResult = await request(port, collection.id, ocrMarker);
    const ocrPass = hasOnly(ocrResult, doc.id);
    (report.cases as Record<string, unknown>).OCR = {
      pass: ocrPass,
      extractionIdSha256: sha(extraction.id),
      pageTextSha256: sha(`${ocrMarker} extracción OCR sintética`),
      result: summarize(ocrResult),
    };
    if (!ocrPass) throw new Error('SYNC_OCR_HTTP_MISMATCH');

    const oldMetadata = await request(port, collection.id, marker, {
      expediente: oldCase,
    });
    await dbService.corpusDocument.update({
      where: { id: doc.id },
      data: {
        caseNumber: newCase,
        title: `INT151 sync metadata revised ${marker}`,
        metadata: { actor: `${marker} actor revised`, synthetic: true },
      },
    });
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    const oldMetadataAfter = await request(port, collection.id, marker, {
      expediente: oldCase,
    });
    const newMetadata = await request(port, collection.id, marker, {
      expediente: newCase,
    });
    const metadataPass =
      hasOnly(oldMetadata, doc.id) &&
      oldMetadataAfter.status === 200 &&
      oldMetadataAfter.total === 0 &&
      hasOnly(newMetadata, doc.id);
    (report.cases as Record<string, unknown>).metadata = {
      pass: metadataPass,
      before: summarize(oldMetadata),
      afterOldValue: summarize(oldMetadataAfter),
      afterNewValue: summarize(newMetadata),
    };
    if (!metadataPass) throw new Error('SYNC_METADATA_HTTP_MISMATCH');

    await dbService.corpusDocument.delete({ where: { id: doc.id } });
    documentId = undefined;
    await drain(searchRuntime);
    await searchRuntime.client.indices.refresh({ index });
    const deletedText = await request(port, collection.id, marker);
    const deletedOcr = await request(port, collection.id, ocrMarker);
    const deletePass =
      deletedText.status === 200 &&
      deletedText.total === 0 &&
      deletedOcr.status === 200 &&
      deletedOcr.total === 0;
    (report.cases as Record<string, unknown>).delete = {
      pass: deletePass,
      afterText: summarize(deletedText),
      afterOcrText: summarize(deletedOcr),
    };
    if (!deletePass) throw new Error('SYNC_DELETE_HTTP_MISMATCH');
  } catch (error) {
    report.error =
      error instanceof Error ? error.message : 'SYNC_MATRIX_FAILED';
  } finally {
    if (prisma && documentId)
      await prisma.corpusDocument
        .delete({ where: { id: documentId } })
        .catch(() => undefined);
    if (runtime) await drain(runtime).catch(() => undefined);
    if (prisma && collectionId)
      await prisma.digestoCollection
        .delete({ where: { id: collectionId } })
        .catch(() => undefined);
    if (runtime) {
      await drain(runtime).catch(() => undefined);
      const finalCount = await runtime.client
        .count({ index })
        .then((response) => Number(response.body.count))
        .catch(() => -1);
      const outbox = await runtime.repository
        .outboxStatus()
        .catch(() => ({ pending: -1, failed: -1 }));
      const collectionResidual = collectionId
        ? await prisma!.digestoCollection.count({ where: { id: collectionId } })
        : 0;
      const documentResidual = documentId
        ? await prisma!.corpusDocument.count({ where: { id: documentId } })
        : 0;
      const caseResults = report.cases as Record<string, { pass?: boolean }>;
      const functionalPass = [
        'create',
        'DOC',
        'OCR',
        'metadata',
        'delete',
      ].every((key) => caseResults[key]?.pass === true);
      const cleanupPass =
        baselineCount === 69313 &&
        finalCount === baselineCount &&
        outbox.pending === 0 &&
        outbox.failed === 0 &&
        collectionResidual === 0 &&
        documentResidual === 0;
      report.generatedAt = new Date().toISOString();
      report.countBefore = baselineCount;
      report.countAfter = finalCount;
      report.outbox = outbox;
      report.cleanup = {
        documentResidual,
        collectionResidual,
        countBefore: baselineCount,
        countAfter: finalCount,
        outbox,
        pass: cleanupPass,
      };
      report.pass = functionalPass && cleanupPass;
      report.status = report.pass ? 'PASS' : 'FAIL';
    } else {
      report.status = 'FAIL';
      report.pass = false;
      report.error ??= 'SYNC_RUNTIME_NOT_INITIALIZED';
    }
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (app) await app.close().catch(() => undefined);
    else if (prisma) await prisma.$disconnect().catch(() => undefined);
    console.log(JSON.stringify(report, null, 2));
    if (report.pass !== true) process.exitCode = 1;
  }
}

async function request(
  port: number,
  collectionId: string,
  query: string,
  filters: Record<string, string> = {},
): Promise<CaseResult> {
  const url = new URL(`http://127.0.0.1:${port}/api/busqueda/avanzada`);
  url.searchParams.set('q', query);
  url.searchParams.set('pageSize', '50');
  url.searchParams.set('digestoCollectionId', collectionId);
  Object.entries(filters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = (await response.json()) as SearchResponse;
  return {
    status: response.status,
    total: body.federated?.total ?? null,
    totalExact: body.federated?.totalExact === true,
    ids: (body.federated?.results ?? [])
      .map((result) => String(result.sourceId ?? ''))
      .sort(),
  };
}

async function drain(runtime: OpenSearchRuntimeService) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await runtime.syncWorker.tick();
    const status = await runtime.repository.outboxStatus();
    if (status.failed > 0) throw new Error('SYNC_OUTBOX_FAILED');
    if (status.pending === 0) return status;
    await new Promise((delay) => setTimeout(delay, 25));
  }
  throw new Error('SYNC_OUTBOX_DRAIN_TIMEOUT');
}

function hasOnly(result: CaseResult, id: string) {
  return (
    result.status === 200 &&
    result.totalExact &&
    result.total === 1 &&
    result.ids.length === 1 &&
    result.ids[0] === id
  );
}

function summarize(result: CaseResult) {
  return {
    status: result.status,
    total: result.total,
    totalExact: result.totalExact,
    idsSha256: hashIds(result.ids),
  };
}

function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hashIds(ids: string[]) {
  return sha([...ids].sort().join('\n'));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'SYNC_MATRIX_FAILED');
  process.exitCode = 1;
});
