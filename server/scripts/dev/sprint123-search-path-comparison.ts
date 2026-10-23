import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EventosConsultaService } from '../../src/estadisticas/eventos-consulta.service';
import { FederatedSearchService } from '../../src/busqueda/federated-search.service';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

type Credentials = { accounts: Record<'admin', { email: string; password: string }> };
const root = resolve(process.cwd(), '..', '..');

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  process.env.BJC_SEARCH_PROFILE = 'true';
  const credentials = JSON.parse(await readFile(resolve(root, '_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  app.get(EventosConsultaService).trackSafe = () => undefined;
  const federated = app.get(FederatedSearchService);
  const samples = [
    { family: 'TERM_COMMON', query: 'responsabilidad' },
    { family: 'PHRASE', query: '"responsabilidad civil"' },
    { family: 'PREFIX', query: 'responsabilid%' },
    { family: 'SUFFIX', query: '%civil' },
    { family: 'SHORT', query: 'de' },
  ];
  const repetitions = 10;
  const rows: Record<string, unknown> = {};
  try {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    const token = login.body.accessToken as string;
    for (const sample of samples) {
      const direct: number[] = [];
      const endpoint: number[] = [];
      let endpointEngine = 'unknown';
      let endpointLegacyMs = -1;
      for (let i = 0; i <= repetitions; i += 1) {
        const ast = parseSearchQuery(sample.query);
        const directStart = performance.now();
        const directResult = await federated.search(ast, {
          visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'legacy-active-only', page: 1, pageSize: 10,
        });
        const directMs = performance.now() - directStart;
        const response = await request(app.getHttpServer()).get('/api/busqueda/avanzada')
          .query({ q: sample.query, page: 1, pageSize: 10 })
          .set('Authorization', `Bearer ${token}`).expect(200);
        const profile = response.body.performance;
        endpointEngine = profile?.engine ?? 'profile-missing';
        endpointLegacyMs = profile?.legacyMs ?? -1;
        if (i > 0) {
          direct.push(directMs);
          endpoint.push(profile?.totalMs ?? 0);
        }
        if (directResult.sources.some((source) => !source.ok)) throw new Error(`DIRECT_SOURCE_FAILED:${sample.family}`);
        if (endpointEngine !== 'v2') throw new Error(`ENDPOINT_NOT_V2:${sample.family}`);
      }
      rows[sample.family] = {
        repetitions,
        directFederatedV2: summarize(direct),
        advancedEndpoint: summarize(endpoint),
        engine: endpointEngine,
        legacyMs: endpointLegacyMs,
        sourceErrors: 0,
      };
    }
    const outputPath = resolve(root, '_recovery-work/sprint123/performance/path-comparison.json');
    await mkdir(resolve(outputPath, '..'), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify({
      status: 'SPRINT123_SEARCH_PATH_COMPARISON_COMPLETE',
      generatedAt: new Date().toISOString(),
      environment: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      queryTextPersisted: false,
      method: 'warmup plus ten sequential paired observations; direct FederatedSearchService V2 versus authenticated /api/busqueda/avanzada; same internal visibility and first page',
      families: rows,
    }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: 'SPRINT123_SEARCH_PATH_COMPARISON_COMPLETE', output: outputPath }));
  } finally {
    await app.close();
  }
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  const round = (n: number) => Math.round(n * 100) / 100;
  return { p50Ms: round(at(0.5)), p95Ms: round(at(0.95)), maxMs: round(sorted[sorted.length - 1]) };
}

function assertDevDatabase(raw?: string) {
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SPRINT123_SEARCH_PATH_COMPARISON_FAILED');
  process.exitCode = 1;
});
