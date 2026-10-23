import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

const alias = 'galilei-search-int151-cert';
const unavailableEndpoint = 'http://127.0.0.1:61377';
const artifactPath = resolve(
  process.cwd(),
  '../_recovery-work/search-engine-integration1/fail-closed-body-1_5_1.json',
);

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
  process.env.OPENSEARCH_NODE = unavailableEndpoint;
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let legacyIlikeCalls = 0;
  const report: Record<string, unknown> = {
    status: 'NOT_RUN',
    pass: false,
    route: 'GET /api/public/busqueda',
    unavailableEndpoint: '127.0.0.1:61377 (process-scoped test endpoint)',
    candidateAlias: alias,
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
    prisma = dbService;
    await dbService.$connect();
    const identity = await dbService.$queryRaw<
      Array<{ database: string; role: string; port: number }>
    >`SELECT current_database() AS database, current_user AS role, inet_server_port() AS port`;
    if (
      identity[0]?.database !== 'buscador_juridico_civil_dev' ||
      identity[0]?.role !== 'bjc_dev' ||
      Number(identity[0]?.port) !== 55432
    )
      throw new Error('DEV_DB_GUARD_TARGET_MISMATCH');

    const raw = dbService.$queryRaw.bind(dbService) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    Object.defineProperty(dbService, '$queryRaw', {
      configurable: true,
      value: (...args: unknown[]) => {
        if (String((args[0] as { sql?: string })?.sql ?? '').includes('ILIKE'))
          legacyIlikeCalls += 1;
        return raw(...args);
      },
    });

    await app.listen(0, '127.0.0.1');
    const port = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address()?.port;
    if (!port) throw new Error('FAIL_CLOSED_HTTP_PORT_MISSING');
    const response = await fetch(
      `http://127.0.0.1:${port}/api/public/busqueda?q=responsabilidad%20civil`,
      { signal: AbortSignal.timeout(30000) },
    );
    const body = await response.text();
    const stackTrace = /\bat\s+[\w.$<>]+\s*\(|\n\s*at\s/u.test(body);
    const leaksEndpoint = /127\.0\.0\.1:61377|http:\/\//iu.test(body);
    const leaksCredential =
      /(password|secret|token|authorization)\s*[:=]/iu.test(body);
    const leaksException =
      /(ECONNREFUSED|FetchError|ConnectTimeout|ResponseError|OpenSearch|cause:)/iu.test(
        body,
      );
    const bodySafe =
      body.length > 0 &&
      !stackTrace &&
      !leaksEndpoint &&
      !leaksCredential &&
      !leaksException;
    report.responseStatus = response.status;
    report.bodySha256 = createHash('sha256').update(body).digest('hex');
    report.bodyBytes = Buffer.byteLength(body);
    report.bodySafe = bodySafe;
    report.stackTraceLeaked = stackTrace;
    report.internalEndpointLeaked = leaksEndpoint;
    report.credentialLeaked = leaksCredential;
    report.rawExceptionLeaked = leaksException;
    report.legacyIlikeCalls = legacyIlikeCalls;
    report.pass = response.status === 503 && bodySafe && legacyIlikeCalls === 0;
    report.status = report.pass ? 'PASS' : 'FAIL';
  } catch (error) {
    report.error =
      error instanceof Error ? error.message : 'FAIL_CLOSED_TEST_FAILED';
  } finally {
    report.generatedAt = new Date().toISOString();
    mkdirSync(resolve(artifactPath, '..'), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (app) await app.close().catch(() => undefined);
    else if (prisma) await prisma.$disconnect().catch(() => undefined);
    console.log(JSON.stringify(report, null, 2));
    if (report.pass !== true) process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'FAIL_CLOSED_TEST_FAILED',
  );
  process.exitCode = 1;
});
