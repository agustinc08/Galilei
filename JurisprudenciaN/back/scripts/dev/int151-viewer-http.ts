import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ArchivosModule } from '../../src/archivos/archivos.module';
import { archivoPdfEsReal } from '../../src/archivos/pdf-real.util';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { lexicalTokens } from '../../src/busqueda/opensearch/opensearch-mapping';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SentenciasModule } from '../../src/sentencias/sentencias.module';

const candidate = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const candidateAlias =
  process.env.BJC_INT151_ALIAS ?? 'galilei-search-int151-cert';
const artifactRoot = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1',
);
const outputPath = resolve(
  artifactRoot,
  'viewer-published-sentencia-1_5_1.json',
);
const knownIds = [32470, 35132];

type PublicSearchBody = {
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
  let port: number | undefined;
  const startedAt = new Date().toISOString();
  let report: Record<string, unknown> = { status: 'NOT_RUN', pass: false };
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
        SentenciasModule,
        ArchivosModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const dbService = app.get(PrismaService);
    const searchRuntime = app.get(OpenSearchRuntimeService);
    prisma = dbService;
    runtime = searchRuntime;
    await dbService.$connect();
    const alias = await searchRuntime.client.indices.getAlias({
      name: candidateAlias,
    });
    if (Object.keys(alias.body).join(',') !== candidate)
      throw new Error('VIEWER_CANDIDATE_ALIAS_MISMATCH');
    searchRuntime.onModuleInit();
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address();
    port = address?.port;
    if (!port) throw new Error('VIEWER_HTTP_PORT_MISSING');

    const known = await dbService.sentencia.findMany({
      where: {
        id: { in: knownIds },
        activo: true,
        publicado: true,
        estadoCarga: 'PUBLICADA',
      },
      select: {
        id: true,
        slugPublico: true,
        caratula: true,
        textoBusquedaNormalizado: true,
        expediente: true,
        numeroSentencia: true,
        archivosPdf: {
          select: {
            id: true,
            rutaArchivo: true,
            mimeType: true,
            nombreOriginal: true,
          },
        },
      },
    });
    const knownWithPdf = known.filter(
      (row) => row.slugPublico && row.archivosPdf.some(archivoPdfEsReal),
    );
    if (!knownWithPdf.length)
      throw new Error('NO_VIEWER_COMPATIBLE_KNOWN_SENTENCIA');

    let chosen: (typeof knownWithPdf)[number] | undefined;
    let matchingHit:
      | { id: number; query: string; page: number; total: number }
      | undefined;
    let searchPages = 0;
    for (const sentence of knownWithPdf) {
      const tokens = [
        ...new Set(lexicalTokens(sentence.textoBusquedaNormalizado ?? '')),
      ]
        .filter((token) => token.length >= 5)
        .sort((a, b) => b.length - a.length);
      for (const token of tokens.slice(0, 12)) {
        const body = await publicSearch(port, token, 1);
        searchPages += 1;
        const match = (body.federated?.results ?? []).some(
          (result) => String(result.sourceId) === String(sentence.id),
        );
        if (body.federated?.totalExact && match) {
          chosen = sentence;
          matchingHit = {
            id: sentence.id,
            query: token,
            page: 1,
            total: body.federated.total ?? -1,
          };
          break;
        }
      }
      if (chosen) break;
      const query = 'responsabilidad civil';
      const firstPage = await publicSearch(port, query, 1);
      searchPages += 1;
      const pageCount = Math.ceil((firstPage.federated?.total ?? 0) / 100);
      if (pageCount > 100) throw new Error('VIEWER_SEARCH_PAGE_BOUND_INVALID');
      if (
        (firstPage.federated?.results ?? []).some(
          (row) => String(row.sourceId) === String(sentence.id),
        )
      ) {
        chosen = sentence;
        matchingHit = {
          id: sentence.id,
          query,
          page: 1,
          total: firstPage.federated?.total ?? -1,
        };
        break;
      }
      for (let page = 2; page <= pageCount; page += 1) {
        const body = await publicSearch(port, query, page);
        searchPages += 1;
        if (
          (body.federated?.results ?? []).some(
            (row) => String(row.sourceId) === String(sentence.id),
          )
        ) {
          chosen = sentence;
          matchingHit = {
            id: sentence.id,
            query,
            page,
            total: body.federated?.total ?? -1,
          };
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen || !matchingHit)
      throw new Error('KNOWN_SENTENCIA_SEARCH_HIT_NOT_FOUND');

    const baseUrl = `http://127.0.0.1:${port}/api`;
    const viewerResponse = await fetch(
      `${baseUrl}/public/sentencias/${encodeURIComponent(chosen.slugPublico!)}/documento`,
      { signal: AbortSignal.timeout(15000) },
    );
    const viewerBody = (await viewerResponse.json()) as {
      data?: {
        sentencia?: { id?: number; caratula?: string };
        archivosPdf?: Array<{
          id?: number;
          rutaArchivo?: string;
          mimeType?: string;
        }>;
        cita?: { citaCompleta?: string };
      };
    };
    const viewerResolved = viewerBody.data?.sentencia?.id === chosen.id;
    const viewerPdf = (viewerBody.data?.archivosPdf ?? []).some(
      (file) =>
        file.id !== undefined &&
        file.rutaArchivo &&
        archivoPdfEsReal({ id: file.id, rutaArchivo: file.rutaArchivo }),
    );

    const pdfResponse = await fetch(
      `${baseUrl}/public/sentencias/${encodeURIComponent(chosen.slugPublico!)}/pdf`,
      { signal: AbortSignal.timeout(30000) },
    );
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const pdfSignatureValid =
      pdfBytes.length >= 5 &&
      String.fromCharCode(...pdfBytes.slice(0, 5)) === '%PDF-';

    const citationResponse = await fetch(
      `${baseUrl}/sentencias/${chosen.id}/cita`,
      {
        signal: AbortSignal.timeout(15000),
      },
    );
    const citationBody = (await citationResponse.json()) as {
      data?: { citaCompleta?: string; cita?: string };
    };
    const citation =
      citationBody.data?.citaCompleta ?? citationBody.data?.cita ?? '';
    const exportResponse = await fetch(
      `${baseUrl}/sentencias/${chosen.id}/exportar-ficha?formato=txt`,
      { signal: AbortSignal.timeout(15000) },
    );
    const exportText = await exportResponse.text();
    const exportContainsIdentity = Boolean(
      (chosen.caratula && exportText.includes(chosen.caratula)) ||
      (chosen.expediente && exportText.includes(chosen.expediente)),
    );
    const pass =
      viewerResponse.status === 200 &&
      viewerResolved &&
      viewerPdf &&
      pdfResponse.status === 200 &&
      pdfResponse.headers
        .get('content-type')
        ?.toLowerCase()
        .includes('application/pdf') === true &&
      pdfSignatureValid &&
      citationResponse.status === 200 &&
      citation.trim().length > 0 &&
      exportResponse.status === 200 &&
      exportText.trim().length > 0 &&
      exportContainsIdentity;
    report = {
      generatedAt: new Date().toISOString(),
      startedAt,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidate,
      route:
        'GET /api/public/busqueda → /api/public/sentencias/:slug/documento → /api/public/sentencias/:slug/pdf',
      knownRegressionIds: knownIds,
      search: {
        querySha256: sha(matchingHit.query),
        selectedId: chosen.id,
        total: matchingHit.total,
        page: matchingHit.page,
        pagesOrQueriesRead: searchPages,
        resultHit: true,
      },
      viewer: {
        status: viewerResponse.status,
        logicalIdResolved: viewerResolved,
        pdfMetadataResolved: viewerPdf,
        citationInViewer: Boolean(viewerBody.data?.cita?.citaCompleta?.trim()),
      },
      pdf: {
        status: pdfResponse.status,
        contentType: pdfResponse.headers.get('content-type'),
        bytes: pdfBytes.length,
        signatureValid: pdfSignatureValid,
      },
      citation: {
        status: citationResponse.status,
        nonEmpty: citation.trim().length > 0,
        sha256: sha(citation),
      },
      export: {
        status: exportResponse.status,
        bytes: Buffer.byteLength(exportText, 'utf8'),
        containsCaseIdentity: exportContainsIdentity,
      },
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

async function publicSearch(port: number, query: string, page: number) {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/public/busqueda?q=${encodeURIComponent(query)}&page=${page}&pageSize=100`,
    { signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) throw new Error(`PUBLIC_SEARCH_HTTP_${response.status}`);
  return (await response.json()) as PublicSearchBody;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'VIEWER_FLOW_FAILED');
  process.exitCode = 1;
});
