import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

type Account = { email: string; password: string };
type Credentials = { accounts: Record<'admin', Account> };
type Observation = { route: string; elapsedMs: number; status: number };

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  const credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  try {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const waves: Record<string, Observation[]> = {};
    for (const users of [5, 10, 20]) {
      const observations = await Promise.all(Array.from({ length: users }, async () => {
        const routes = [
          { route: 'readiness', method: () => request(app.getHttpServer()).get('/api/health/ready') },
          { route: 'dashboard-summary', method: () => request(app.getHttpServer()).get('/api/corpus/documents/admin/summary').set('Authorization', authorization) },
          { route: 'search-zero-result', method: () => request(app.getHttpServer()).get('/api/busqueda/avanzada').query({ q: 'zzqvnoresult2026sprint11', page: 1, pageSize: 10 }).set('Authorization', authorization) },
        ];
        const result: Observation[] = [];
        for (const item of routes) {
          const started = performance.now();
          try {
            const response = await item.method();
            result.push({ route: item.route, elapsedMs: performance.now() - started, status: response.status });
          } catch {
            result.push({ route: item.route, elapsedMs: performance.now() - started, status: 0 });
          }
        }
        return result;
      }));
      waves[String(users)] = observations.flat();
    }
    const report = { status: 'SPRINT11_CONCURRENCY_COMPLETE', generatedAt: new Date().toISOString(), requestsPerVirtualUser: 3, waves: Object.fromEntries(Object.entries(waves).map(([users, observations]) => [users, summarize(observations)])), notes: ['API handlers run in local in-process HTTP; no TLS/proxy/network capacity claim.', 'No raw query or response body retained.', 'One read-only search request emits its normal search event.'] };
    const outputDir = resolve(process.cwd(), '../_recovery-work/sprint11/performance');
    await mkdir(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, 'concurrency-results.json');
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, output: outputPath }, null, 2));
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
  console.error(/DEV_DATABASE/u.test(reason) ? reason : 'SPRINT11_CONCURRENCY_FAILED');
  process.exitCode = 1;
});
