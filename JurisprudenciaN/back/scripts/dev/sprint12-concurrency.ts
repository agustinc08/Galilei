import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventosConsultaService } from '../../src/estadisticas/eventos-consulta.service';

type Credentials = { accounts: Record<'admin', { email: string; password: string }> };
type Observation = { route: string; elapsedMs: number; status: number };

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  const credentials = JSON.parse(await readFile(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  app.get(EventosConsultaService).trackSafe = () => undefined;
  try {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const document = await prisma.corpusDocument.findFirst({
      where: { status: 'INDEXED', visibility: 'INTERNAL', files: { some: { mimeType: 'application/pdf' } } },
      orderBy: { updatedAt: 'asc' }, select: { id: true },
    });
    if (!document) throw new Error('SPRINT12_CONCURRENCY_FILE_FIXTURE_UNAVAILABLE');
    const mix = [
      ...Array.from({ length: 12 }, () => ({ route: 'search', run: () => request(app.getHttpServer()).get('/api/busqueda/avanzada').query({ q: 'responsabilidad', page: 1, pageSize: 10 }).set('Authorization', authorization) })),
      ...Array.from({ length: 3 }, () => ({ route: 'dashboard', run: () => request(app.getHttpServer()).get('/api/corpus/documents/admin/summary').set('Authorization', authorization) })),
      ...Array.from({ length: 3 }, () => ({ route: 'detail', run: () => request(app.getHttpServer()).get(`/api/corpus/documents/${encodeURIComponent(document.id)}`).set('Authorization', authorization) })),
      { route: 'file-range', run: () => request(app.getHttpServer()).get(`/api/corpus/documents/${encodeURIComponent(document.id)}/file`).set('Authorization', authorization).set('Range', 'bytes=0-1023') },
      { route: 'matches', run: () => request(app.getHttpServer()).get(`/api/corpus/documents/${encodeURIComponent(document.id)}/matches`).query({ q: 'responsabilidad' }).set('Authorization', authorization) },
    ];
    const waves: Record<string, unknown> = {};
    for (const users of [1, 5, 10, 20]) {
      const observations: Observation[] = [];
      const before = process.cpuUsage();
      const started = performance.now();
      const baseRss = process.memoryUsage().rss;
      let peakRss = baseRss;
      let maxDbConnections = 0;
      let maxActiveConnections = 0;
      let sampling = true;
      const sampler = setInterval(async () => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        try {
          const result = await prisma.$queryRawUnsafe<Array<{ total: number; active: number }>>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active FROM pg_stat_activity WHERE datname = current_database()`);
          maxDbConnections = Math.max(maxDbConnections, result[0]?.total ?? 0);
          maxActiveConnections = Math.max(maxActiveConnections, result[0]?.active ?? 0);
        } catch { /* keep the workload moving if a sample misses its interval */ }
      }, 1000);
      const results = await Promise.all(Array.from({ length: users }, async () => {
        const rows: Observation[] = [];
        for (const item of mix) {
          const requestStarted = performance.now();
          try {
            const response = await item.run();
            rows.push({ route: item.route, elapsedMs: performance.now() - requestStarted, status: response.status });
          } catch {
            rows.push({ route: item.route, elapsedMs: performance.now() - requestStarted, status: 0 });
          }
        }
        return rows;
      }));
      sampling = false;
      clearInterval(sampler);
      const durationMs = performance.now() - started;
      const cpu = process.cpuUsage(before);
      observations.push(...results.flat());
      waves[String(users)] = {
        users,
        requests: observations.length,
        durationMs: round(durationMs),
        throughputRequestsPerSecond: round(observations.length / (durationMs / 1000)),
        routes: summarize(observations),
        resources: {
          nodeProcessCpuMs: round((cpu.user + cpu.system) / 1000),
          nodeProcessCpuPercentOfOneCore: round(((cpu.user + cpu.system) / 1000 / durationMs) * 100),
          nodeRssBaseMiB: round(baseRss / 1024 / 1024),
          nodeRssPeakMiB: round(peakRss / 1024 / 1024),
          postgresConnectionsPeak: maxDbConnections,
          postgresActiveConnectionsPeak: maxActiveConnections,
        },
        ...(sampling ? { samplingWarning: true } : {}),
      };
      console.log(JSON.stringify({ users, requests: observations.length, durationMs: round(durationMs) }));
    }
    const report = {
      status: 'SPRINT12_CONCURRENCY_COMPLETE',
      generatedAt: new Date().toISOString(),
      environment: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      requestsPerUser: 20,
      mixPercent: { search: 60, dashboard: 15, detail: 15, fileOrMatches: 10 },
      queryTextPersisted: false,
      searchEventWritesSuppressed: true,
      topology: 'in-process Nest HTTP handlers on local DEV; no TLS/proxy claim',
      waves,
    };
    const outputDir = resolve(process.cwd(), '../../_recovery-work/sprint12/performance');
    await mkdir(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, 'concurrency-results.json');
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: report.status, output: outputPath }, null, 2));
  } finally {
    await app.close();
  }
}

function summarize(observations: Observation[]) {
  const routes = [...new Set(observations.map((item) => item.route))];
  return Object.fromEntries(routes.map((route) => {
    const rows = observations.filter((item) => item.route === route);
    const sorted = rows.map((item) => item.elapsedMs).sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
    return [route, { requests: rows.length, errors: rows.filter((item) => item.status < 200 || item.status >= 400).length, statusCounts: Object.fromEntries([...new Set(rows.map((item) => item.status))].map((status) => [String(status), rows.filter((item) => item.status === status).length])), p50Ms: round(percentile(0.5)), p95Ms: round(percentile(0.95)), maxMs: round(sorted[sorted.length - 1]) }];
  }));
}

function round(value: number) { return Math.round(value * 100) / 100; }
function assertDevDatabase(raw?: string) {
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

if (require.main === module) main().catch((error) => {
  const reason = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(/DEV_DATABASE|SPRINT12_CONCURRENCY_FILE/u.test(reason) ? reason : 'SPRINT12_CONCURRENCY_FAILED');
  process.exitCode = 1;
});
