import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { Test } from '@nestjs/testing';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { BusquedaService } from '../../src/busqueda/busqueda.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  CorpusDocumentController,
  PublicCorpusDocumentController,
} from '../../src/corpus/corpus-document.controller';
import { CorpusDocumentAccessService } from '../../src/corpus/corpus-document-access.service';
import type { AuthenticatedUser } from '../../src/auth/types/authenticated-user.type';
import { lexicalTokens } from '../../src/busqueda/opensearch/opensearch-mapping';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';

const EXPECTED_INDEX = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const ALIAS = process.env.BJC_INT151_ALIAS ?? 'galilei-search-int151-cert';
const ROOT = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1',
);
const OUTPUT = resolve(ROOT, 'viewer-corpus-1_5_1.json');

type SearchBody = {
  federated?: {
    total?: number;
    totalExact?: boolean;
    results?: Array<{
      sourceId?: string;
      title?: string;
      document?: { href?: string; mimeType?: string | null };
    }>;
  };
};

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'development';
  process.env.SEARCH_ENGINE = 'opensearch';
  process.env.OPENSEARCH_INDEX_ALIAS = ALIAS;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let runtime: OpenSearchRuntimeService | undefined;
  const startedAt = new Date().toISOString();
  let report: Record<string, unknown> = { status: 'NOT_RUN', pass: false };
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
      ],
      controllers: [CorpusDocumentController, PublicCorpusDocumentController],
      providers: [CorpusDocumentAccessService],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const dbService = app.get(PrismaService);
    prisma = dbService;
    const searchRuntime = app.get(OpenSearchRuntimeService);
    runtime = searchRuntime;
    const alias = await searchRuntime.client.indices.getAlias({ name: ALIAS });
    if (Object.keys(alias.body).length !== 1 || !(EXPECTED_INDEX in alias.body))
      throw new Error('CORPUS_VIEWER_ALIAS_TARGET_MISMATCH');

    const administrator = await dbService.usuario.findFirst({
      where: { activo: true, rol: { nombre: 'ADMIN' } },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        activo: true,
        rolId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!administrator) throw new Error('CORPUS_VIEWER_ADMIN_USER_MISSING');
    const actor: AuthenticatedUser = {
      ...administrator,
      rol: { id: administrator.rolId, nombre: 'ADMIN', descripcion: null },
    };
    app.use((request: Request, _response: Response, next: NextFunction) => {
      (request as Request & { user?: AuthenticatedUser }).user = actor;
      next();
    });
    app.get(BusquedaService).trackAdvancedV2 = () => undefined;
    await app.listen(0, '127.0.0.1');
    const port = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address()?.port;
    if (!port) throw new Error('CORPUS_VIEWER_HTTP_PORT_MISSING');

    const storageRoot = path.resolve(
      process.env.BJC_CORPUS_STORAGE_PATH ??
        path.resolve(process.cwd(), '../../_dev-corpus-storage'),
    );
    const candidates = await dbService.corpusDocument.findMany({
      where: {
        status: 'INDEXED',
        visibility: { in: ['PUBLIC', 'INTERNAL'] },
        digestoCollections: { some: { collection: { status: 'ACTIVE' } } },
        files: {
          some: { mimeType: 'application/pdf', storageProvider: 'LOCAL_DEV' },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 250,
      select: {
        id: true,
        title: true,
        searchText: true,
        visibility: true,
        digestoCollections: { select: { collectionId: true } },
        files: {
          where: { mimeType: 'application/pdf', storageProvider: 'LOCAL_DEV' },
          orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            originalFilename: true,
            mimeType: true,
            sha256: true,
            storageKey: true,
          },
        },
      },
    });
    const candidate = candidates.find((row) => {
      const file = row.files[0];
      if (
        !file ||
        !/^[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]{1,10}$/u.test(file.storageKey)
      )
        return false;
      const fullPath = path.resolve(storageRoot, file.storageKey);
      return (
        fullPath.startsWith(`${storageRoot}${path.sep}`) && existsSync(fullPath)
      );
    });
    if (!candidate?.files[0] || !candidate.digestoCollections[0])
      throw new Error('CORPUS_VIEWER_STORED_PUBLIC_FIXTURE_MISSING');

    const terms = [
      ...new Set(lexicalTokens(`${candidate.title} ${candidate.searchText}`)),
    ]
      .filter((term) => term.length >= 5)
      .sort((left, right) => right.length - left.length)
      .slice(0, 16);
    const base = `http://127.0.0.1:${port}/api`;
    let selectedQuery: string | undefined;
    let searchBody: SearchBody | undefined;
    for (const term of terms) {
      const url = new URL(`${base}/busqueda/avanzada`);
      url.searchParams.set('q', term);
      url.searchParams.set('page', '1');
      url.searchParams.set('pageSize', '50');
      url.searchParams.set(
        'digestoCollectionId',
        candidate.digestoCollections[0].collectionId,
      );
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 200) continue;
      const body = (await response.json()) as SearchBody;
      const hit = (body.federated?.results ?? []).some(
        (result) => String(result.sourceId) === candidate.id,
      );
      if (hit && body.federated?.totalExact) {
        selectedQuery = term;
        searchBody = body;
        break;
      }
    }
    if (!selectedQuery || !searchBody)
      throw new Error('CORPUS_VIEWER_SEARCH_HIT_MISSING');

    const result = (searchBody.federated?.results ?? []).find(
      (row) => String(row.sourceId) === candidate.id,
    );
    const metadataResponse = await fetch(
      `${base}/corpus/documents/${encodeURIComponent(candidate.id)}?pageNumber=1`,
      {
        signal: AbortSignal.timeout(15_000),
      },
    );
    const metadata = (await metadataResponse.json()) as {
      id?: string;
      title?: string;
      file?: {
        href?: string;
        mimeType?: string;
        sha256?: string;
        filename?: string;
      } | null;
      extraction?: { pageCount?: number; pages?: number[] } | null;
    };
    const metadataResolved =
      metadataResponse.status === 200 &&
      metadata.id === candidate.id &&
      Boolean(metadata.file?.href);
    const fileUrl = metadata.file?.href
      ? new URL(metadata.file.href, base)
      : undefined;
    const fileResponse = fileUrl
      ? await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) })
      : undefined;
    const fileBytes = fileResponse
      ? new Uint8Array(await fileResponse.arrayBuffer())
      : new Uint8Array();
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');
    const pdfSignatureValid =
      fileBytes.length >= 5 &&
      String.fromCharCode(...fileBytes.slice(0, 5)) === '%PDF-';
    const pass = Boolean(
      result &&
      searchBody.federated?.totalExact &&
      metadataResolved &&
      fileResponse?.status === 200 &&
      fileResponse.headers
        .get('content-type')
        ?.toLowerCase()
        .includes('application/pdf') &&
      pdfSignatureValid &&
      sha256 === candidate.files[0].sha256 &&
      fileBytes.byteLength > 0,
    );
    report = {
      status: pass ? 'PASS' : 'FAIL',
      generatedAt: new Date().toISOString(),
      startedAt,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidateIndex: EXPECTED_INDEX,
      alias: ALIAS,
      route:
        'GET /api/busqueda/avanzada → GET /api/corpus/documents/:id → file href',
      search: {
        status: searchBody.federated?.totalExact ? 200 : null,
        querySha256: createHash('sha256').update(selectedQuery).digest('hex'),
        total: searchBody.federated?.total ?? null,
        totalExact: searchBody.federated?.totalExact === true,
        resultHit: Boolean(result),
        resultIdSha256: createHash('sha256').update(candidate.id).digest('hex'),
        resultFileHrefPresent: Boolean(result?.document?.href),
      },
      viewer: {
        metadataStatus: metadataResponse.status,
        logicalIdResolved: metadata.id === candidate.id,
        metadataFileResolved: Boolean(metadata.file?.href),
        extractionPageCount: metadata.extraction?.pageCount ?? null,
      },
      file: {
        status: fileResponse?.status ?? null,
        contentType: fileResponse?.headers.get('content-type') ?? null,
        bytes: fileBytes.byteLength,
        signatureValid: pdfSignatureValid,
        sha256MatchesStored: sha256 === candidate.files[0].sha256,
      },
      fixture: {
        existingCorpusDocument: true,
        documentIdSha256: createHash('sha256')
          .update(candidate.id)
          .digest('hex'),
        titleSha256: createHash('sha256').update(candidate.title).digest('hex'),
        visibility: candidate.visibility,
        fixtureCreated: false,
        databaseWrites: 0,
      },
      pass,
    };
    writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (!pass) process.exitCode = 1;
  } catch (error) {
    report = {
      ...report,
      status: 'FAIL',
      generatedAt: new Date().toISOString(),
      startedAt,
      safeError:
        error instanceof Error ? error.message : 'CORPUS_VIEWER_FAILED',
      pass: false,
    };
    writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    if (app) await app.close().catch(() => undefined);
    else {
      if (runtime) await runtime.onModuleDestroy().catch(() => undefined);
      if (prisma) await prisma.$disconnect().catch(() => undefined);
    }
  }
}

function assertDevDatabase(raw?: string) {
  let target: URL;
  try {
    target = new URL(raw ?? '');
  } catch {
    throw new Error('DEV_DB_GUARD_REQUIRED');
  }
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev'
  )
    throw new Error('DEV_DB_GUARD_REQUIRED');
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'CORPUS_VIEWER_FAILED',
  );
  process.exitCode = 1;
});
