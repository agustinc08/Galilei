import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { BusquedaService } from '../../src/busqueda/busqueda.service';
import { PrismaModule } from '../../src/prisma/prisma.module';

const EXPECTED_IDS = ['32470', '35132'];
const INDEX = process.env.OPENSEARCH_CANDIDATE_INDEX ?? process.argv[2] ?? '';
const CERT_ALIAS = 'galilei-search-int15-cert';

type SearchHttpBody = {
  data?: Array<{ sentencia?: { id?: number } }>;
  meta?: { total?: number };
};
type ExportHttpBody = { data?: unknown[]; meta?: { total?: number } };
type CitationHttpBody = { data?: unknown[] };

async function main() {
  if (!/^galilei-search-v003-[a-z0-9-]+$/u.test(INDEX))
    throw new Error('HTTP_CERT_CANDIDATE_INDEX_REQUIRED');
  process.env.NODE_ENV = 'development';
  process.env.SEARCH_ENGINE = 'opensearch';
  process.env.OPENSEARCH_INDEX_ALIAS = CERT_ALIAS;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
  loadLocalEnvironment();
  assertDevDatabase(process.env.DATABASE_URL);

  const aliasBefore = await activeAliasTarget();
  const certAliasTarget = await aliasTarget(CERT_ALIAS);
  if (certAliasTarget !== INDEX)
    throw new Error('HTTP_CERT_ALIAS_TARGET_INVALID');
  const indexSnapshot = await inspectCandidate();
  if (aliasBefore === INDEX) throw new Error('HTTP_CERT_CANDIDATE_IS_ACTIVE');

  const testServer = await createHttpApp();
  let legacyInvocationCount = 0;
  try {
    const service = testServer.app.get(BusquedaService);
    replaceLegacySearchMethods(service, () => {
      legacyInvocationCount += 1;
      throw new Error('LEGACY_SEARCH_INVOKED');
    });
    service.trackAdvancedV2 = () => undefined;
    service.trackCitationV2 = () => undefined;

    const noMatchQuery = `httpcertnomatch${Date.now()}`;
    const advancedExport = await fetch(
      `${testServer.baseUrl}/api/busqueda/avanzada/exportar?q=${encodeURIComponent(noMatchQuery)}&formato=json`,
    );
    const exportBody = await responseJson<ExportHttpBody>(advancedExport);
    const exportPass =
      advancedExport.status === 200 &&
      exportBody.meta?.total === 0 &&
      exportBody.data?.length === 0;

    const citation = await fetch(
      `${testServer.baseUrl}/api/busqueda/cita?q=${encodeURIComponent(noMatchQuery)}`,
    );
    const citationBody = await responseJson<CitationHttpBody>(citation);
    const citationPass =
      citation.status === 200 && citationBody.data?.length === 0;

    const pageSize = 100;
    const actualIds: string[] = [];
    let total = -1;
    let normalStatus = 200;
    let normalPages = 0;
    for (let page = 1; ; page += 1) {
      const normal = await fetch(
        `${testServer.baseUrl}/api/public/busqueda?q=${encodeURIComponent('responsabilidad civil')}&page=${page}&pageSize=${pageSize}`,
      );
      normalStatus = normal.status;
      const normalBody = await responseJson<SearchHttpBody>(normal);
      const pageTotal = Number(normalBody.meta?.total ?? -1);
      if (page === 1) total = pageTotal;
      if (normal.status !== 200 || pageTotal !== total) break;
      const pageIds = (normalBody.data ?? []).map((row) =>
        String(row.sentencia?.id ?? ''),
      );
      actualIds.push(...pageIds);
      normalPages = page;
      if (pageIds.length < pageSize) break;
      if (page * pageSize >= total) break;
    }
    const uniqueIds = new Set(actualIds);
    const missingExpectedIds = EXPECTED_IDS.filter((id) => !uniqueIds.has(id));
    const exact =
      normalStatus === 200 &&
      total >= EXPECTED_IDS.length &&
      actualIds.length === total &&
      uniqueIds.size === actualIds.length &&
      missingExpectedIds.length === 0;

    const aliasAfter = await activeAliasTarget();
    if (aliasAfter !== aliasBefore)
      throw new Error('HTTP_CERT_ACTIVE_ALIAS_CHANGED');
    if ((await aliasTarget(CERT_ALIAS)) !== INDEX)
      throw new Error('HTTP_CERT_ALIAS_TARGET_CHANGED');

    const artifact = {
      generatedAt: new Date().toISOString(),
      candidateIndex: INDEX,
      candidateSnapshot: indexSnapshot,
      activeAlias: 'galilei-search-active',
      activePhysicalIndexBefore: aliasBefore,
      activePhysicalIndexAfter: aliasAfter,
      knownCoverageRegression: {
        route: 'GET /api/public/busqueda',
        query: 'responsabilidad civil',
        status: normalStatus,
        expectedIdsIncluded: EXPECTED_IDS.length,
        actualTotal: total,
        pagesRead: normalPages,
        pageSize,
        actualRowsAcrossPages: actualIds.length,
        actualUniqueIds: uniqueIds.size,
        expectedIds: EXPECTED_IDS,
        missingExpectedIds,
        pass: exact,
      },
      exportHttp: {
        route: 'GET /api/busqueda/avanzada/exportar',
        status: advancedExport.status,
        expectedRows: 0,
        actualRows: exportBody.data?.length ?? null,
        pass: exportPass,
      },
      citationHttp: {
        route: 'GET /api/busqueda/cita',
        status: citation.status,
        expectedRows: 0,
        actualRows: citationBody.data?.length ?? null,
        pass: citationPass,
      },
      legacyInvocationCount,
      pass: exact && exportPass && citationPass && legacyInvocationCount === 0,
    };
    writeArtifact('http-known-regression-final.json', artifact);
    console.log(JSON.stringify(artifact, null, 2));
    if (!artifact.pass) process.exitCode = 1;
  } finally {
    await testServer.app.close();
  }

  const failedPort = await unusedLocalPort();
  process.env.OPENSEARCH_NODE = `http://127.0.0.1:${failedPort}`;
  const outageServer = await createHttpApp();
  try {
    const service = outageServer.app.get(BusquedaService);
    let outageLegacyInvocationCount = 0;
    replaceLegacySearchMethods(service, () => {
      outageLegacyInvocationCount += 1;
      throw new Error('LEGACY_SEARCH_INVOKED');
    });
    const response = await fetch(
      `${outageServer.baseUrl}/api/public/busqueda?q=${encodeURIComponent('responsabilidad civil')}`,
    );
    const artifact = {
      generatedAt: new Date().toISOString(),
      candidateIndex: INDEX,
      simulatedUnavailableEndpoint: `127.0.0.1:${failedPort}`,
      route: 'GET /api/public/busqueda',
      status: response.status,
      expectedStatus: 503,
      legacyInvocationCount: outageLegacyInvocationCount,
      pass: response.status === 503 && outageLegacyInvocationCount === 0,
    };
    writeArtifact('http-fail-closed-final.json', artifact);
    console.log(JSON.stringify(artifact, null, 2));
    if (!artifact.pass) process.exitCode = 1;
  } finally {
    await outageServer.app.close();
  }
}

async function createHttpApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
}> {
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
  const app = moduleRef.createNestApplication();
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
  const httpServer = app.getHttpServer() as unknown as {
    address(): { port?: number } | string | null;
  };
  const address = httpServer.address();
  if (!address || typeof address === 'string' || !('port' in address))
    throw new Error('HTTP_CERT_TEST_SERVER_START_FAILED');
  if (!address.port) throw new Error('HTTP_CERT_TEST_SERVER_START_FAILED');
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function responseJson<T>(response: globalThis.Response): Promise<T> {
  const value: unknown = await response.json();
  return value as T;
}

function replaceLegacySearchMethods(
  service: BusquedaService,
  onInvocation: () => never,
) {
  for (const method of [
    'avanzada',
    'simple',
    'publica',
    'exportar',
    'buscarPorCita',
  ]) {
    Object.defineProperty(service, method, {
      configurable: true,
      value: onInvocation,
    });
  }
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
  ) {
    throw new Error('DEV_DB_GUARD_TARGET_INVALID');
  }
}

async function activeAliasTarget() {
  return aliasTarget('galilei-search-active');
}

async function aliasTarget(alias: string) {
  const response = await fetch(
    `http://127.0.0.1:9200/_alias/${encodeURIComponent(alias)}`,
  );
  if (!response.ok) throw new Error('HTTP_CERT_ALIAS_UNAVAILABLE');
  const body = (await response.json()) as Record<string, unknown>;
  const targets = Object.keys(body);
  if (targets.length !== 1) throw new Error('HTTP_CERT_ALIAS_INVALID');
  return targets[0];
}

async function inspectCandidate() {
  const response = await fetch(
    `http://127.0.0.1:9200/${encodeURIComponent(INDEX)}/_stats/docs,store,indexing`,
  );
  if (!response.ok) throw new Error('HTTP_CERT_CANDIDATE_UNAVAILABLE');
  const body = (await response.json()) as {
    indices?: Record<
      string,
      {
        primaries?: {
          docs?: { count?: number };
          store?: { size_in_bytes?: number };
          indexing?: { index_failed?: number };
        };
      }
    >;
  };
  const primary = body.indices?.[INDEX]?.primaries;
  if (!primary) throw new Error('HTTP_CERT_CANDIDATE_STATS_MISSING');
  const snapshot = {
    visibleDocuments: primary.docs?.count ?? null,
    storeBytes: primary.store?.size_in_bytes ?? null,
    indexingFailures: primary.indexing?.index_failed ?? null,
  };
  if (snapshot.visibleDocuments !== 69313 || snapshot.indexingFailures !== 0)
    throw new Error('HTTP_CERT_CANDIDATE_NOT_EXACT');
  return snapshot;
}

async function unusedLocalPort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

function writeArtifact(name: string, value: Record<string, unknown>) {
  const root = resolve(
    process.cwd(),
    '..',
    '..',
    '_recovery-work',
    'search-engine-integration1',
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(
    resolve(root, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function loadLocalEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const rawValue = match[2];
    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    process.env[match[1]] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'HTTP_CERT_FAILED';
  console.error(
    message.startsWith('HTTP_CERT_') || message.startsWith('DEV_DB_GUARD_')
      ? message
      : 'HTTP_CERT_FAILED',
  );
  process.exitCode = 1;
});
