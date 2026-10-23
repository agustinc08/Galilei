import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventosConsultaService } from '../../src/estadisticas/eventos-consulta.service';
import { FederatedSearchService } from '../../src/busqueda/federated-search.service';

type Credentials = { accounts: Record<'admin', { email: string; password: string }> };
type Observation = { route: string; elapsedMs: number; status: number; sourceErrors: number; sourceErrorNames: string[] };
type PoolPeak = { max: number; total: number; active: number; idle: number; waiting: number };

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  const waveUsers = (process.env.BJC_CONCURRENCY_WAVES ?? '1,5,10,20').split(',').map((item) => Number(item.trim()));
  if (!waveUsers.length || waveUsers.some((users) => ![1, 5, 10, 20].includes(users))) {
    throw new Error('SPRINT121_CONCURRENCY_WAVES_REJECTED');
  }
  const requestsPerUser = Number(process.env.BJC_CONCURRENCY_REQUESTS_PER_USER ?? 20);
  if (!Number.isInteger(requestsPerUser) || requestsPerUser < 1 || requestsPerUser > 20) {
    throw new Error('SPRINT121_CONCURRENCY_REQUEST_COUNT_REJECTED');
  }
  const root = resolve(process.cwd(), '..', '..');
  const credentials = JSON.parse(await readFile(resolve(root, '_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('SPRINT121_CONCURRENCY_SERVER_BIND_FAILED');
  const apiBaseUrl = `http://127.0.0.1:${address.port}`;
  const prisma = app.get(PrismaService);
  const federated = app.get(FederatedSearchService);
  app.get(EventosConsultaService).trackSafe = () => undefined;
  try {
    const login = await request(apiBaseUrl).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const document = await prisma.corpusDocument.findFirst({
      where: { status: 'INDEXED', visibility: 'INTERNAL', files: { some: { mimeType: 'application/pdf' } } },
      orderBy: { updatedAt: 'asc' }, select: { id: true },
    });
    if (!document) throw new Error('SPRINT121_CONCURRENCY_FILE_FIXTURE_UNAVAILABLE');
    const mix = [
      ...Array.from({ length: 12 }, () => ({ route: 'search', run: () => request(apiBaseUrl).get('/api/busqueda/avanzada').query({ q: process.env.BJC_CONCURRENCY_SEARCH_QUERY ?? 'responsabilidad', page: 1, pageSize: 10 }).set('Authorization', authorization) })),
      ...Array.from({ length: 3 }, () => ({ route: 'dashboard', run: () => request(apiBaseUrl).get('/api/corpus/documents/admin/summary').set('Authorization', authorization) })),
      ...Array.from({ length: 3 }, () => ({ route: 'detail', run: () => request(apiBaseUrl).get(`/api/corpus/documents/${encodeURIComponent(document.id)}`).set('Authorization', authorization) })),
      { route: 'file-range', run: () => request(apiBaseUrl).get(`/api/corpus/documents/${encodeURIComponent(document.id)}/file`).set('Authorization', authorization).set('Range', 'bytes=0-1023') },
      { route: 'matches', run: () => request(apiBaseUrl).get(`/api/corpus/documents/${encodeURIComponent(document.id)}/matches`).query({ q: 'responsabilidad' }).set('Authorization', authorization) },
    ];
    const selectedMix = mix.slice(0, requestsPerUser);
    const waves: Record<string, unknown> = {};
    for (const users of waveUsers) {
      const observations: Observation[] = [];
      const before = process.cpuUsage();
      const started = performance.now();
      const baseRss = process.memoryUsage().rss;
      let peakRss = baseRss;
      let maxDbConnections = 0;
      let maxActiveConnections = 0;
      const poolPeaks: Record<string, PoolPeak> = {};
      const sampler = setInterval(async () => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        for (const [name, pool] of Object.entries(federated.getPoolDiagnostics())) {
          if (!pool) continue;
          const peak = poolPeaks[name] ??= { max: pool.max, total: 0, active: 0, idle: 0, waiting: 0 };
          peak.total = Math.max(peak.total, pool.total);
          peak.active = Math.max(peak.active, pool.active);
          peak.idle = Math.max(peak.idle, pool.idle);
          peak.waiting = Math.max(peak.waiting, pool.waiting);
        }
        try {
          const result = await prisma.$queryRawUnsafe<Array<{ total: number; active: number }>>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active FROM pg_stat_activity WHERE datname = current_database()`);
          maxDbConnections = Math.max(maxDbConnections, result[0]?.total ?? 0);
          maxActiveConnections = Math.max(maxActiveConnections, result[0]?.active ?? 0);
        } catch { /* retain the last successful sample */ }
      }, 500);
      const results = await Promise.all(Array.from({ length: users }, async () => {
        const rows: Observation[] = [];
        for (const item of selectedMix) {
          const requestStarted = performance.now();
          try {
            const response = await item.run();
            const adapters = item.route === 'search' ? response.body.performance?.adapters ?? [] : [];
            const failedSources = adapters.filter((source: { ok?: boolean }) => source.ok === false);
            const sourceErrorNames = failedSources.map((source: { source?: string }) => source.source ?? 'unknown');
            rows.push({ route: item.route, elapsedMs: performance.now() - requestStarted, status: response.status, sourceErrors: failedSources.length, sourceErrorNames });
          } catch {
            rows.push({ route: item.route, elapsedMs: performance.now() - requestStarted, status: 0, sourceErrors: 0, sourceErrorNames: [] });
          }
        }
        return rows;
      }));
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
          pools: poolPeaks,
        },
      };
      console.log(JSON.stringify({ users, requests: observations.length, durationMs: round(durationMs), pools: poolPeaks }));
    }
    const report = {
      status: process.env.BJC_SPRINT1492 === 'true' ? 'SPRINT1492_CONCURRENCY_COMPLETE' : process.env.BJC_SPRINT149 === 'true' ? 'SPRINT149_CONCURRENCY_COMPLETE' : process.env.BJC_SPRINT123 === 'true' ? 'SPRINT123_CONCURRENCY_COMPLETE' : process.env.BJC_SPRINT122 === 'true' ? 'SPRINT122_CONCURRENCY_COMPLETE' : 'SPRINT121_CONCURRENCY_COMPLETE',
      generatedAt: new Date().toISOString(),
      environment: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      requestsPerUser: selectedMix.length,
      mixPercent: {
        search: Math.round((selectedMix.filter((item) => item.route === 'search').length / selectedMix.length) * 100),
        dashboard: Math.round((selectedMix.filter((item) => item.route === 'dashboard').length / selectedMix.length) * 100),
        detail: Math.round((selectedMix.filter((item) => item.route === 'detail').length / selectedMix.length) * 100),
        fileOrMatches: Math.round((selectedMix.filter((item) => item.route === 'file-range' || item.route === 'matches').length / selectedMix.length) * 100),
      },
      queryTextPersisted: false,
      searchEventWritesSuppressed: true,
      topology: 'in-process Nest HTTP handlers on local DEV; no TLS/proxy claim',
      waves,
    };
    const outputDir = resolve(root, process.env.BJC_SPRINT1492 === 'true' ? '_recovery-work/sprint1492/performance' : process.env.BJC_SPRINT149 === 'true' ? '_recovery-work/sprint149/performance' : process.env.BJC_SPRINT123 === 'true' ? '_recovery-work/sprint123/performance' : process.env.BJC_SPRINT122 === 'true' ? '_recovery-work/sprint122/performance' : '_recovery-work/sprint121/performance');
    await mkdir(outputDir, { recursive: true });
    const reportSuffix = process.env.BJC_CONCURRENCY_REPORT_SUFFIX;
    if (reportSuffix && !/^[a-z0-9-]+$/u.test(reportSuffix)) throw new Error('SPRINT121_CONCURRENCY_REPORT_SUFFIX_REJECTED');
    const outputPath = resolve(outputDir, reportSuffix ? `concurrency-results-${reportSuffix}.json` : 'concurrency-results.json');
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
    return [route, {
      requests: rows.length,
      httpErrors: rows.filter((item) => item.status < 200 || item.status >= 400).length,
      sourceErrors: rows.reduce((sum, item) => sum + item.sourceErrors, 0),
      sourceErrorsByName: Object.fromEntries([...new Set(rows.flatMap((item) => item.sourceErrorNames))].map((name) => [name, rows.reduce((sum, item) => sum + item.sourceErrorNames.filter((failed) => failed === name).length, 0)])),
      statusCounts: Object.fromEntries([...new Set(rows.map((item) => item.status))].map((status) => [String(status), rows.filter((item) => item.status === status).length])),
      p50Ms: round(percentile(0.5)), p95Ms: round(percentile(0.95)), maxMs: round(sorted[sorted.length - 1]),
    }];
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
  console.error(/DEV_DATABASE|SPRINT121_CONCURRENCY_FILE/u.test(reason) ? reason : 'SPRINT121_CONCURRENCY_FAILED');
  process.exitCode = 1;
});
