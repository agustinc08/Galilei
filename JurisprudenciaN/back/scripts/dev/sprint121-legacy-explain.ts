import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EventosConsultaService } from '../../src/estadisticas/eventos-consulta.service';
import { drainCapturedSearchQueryTemplates } from '../../src/prisma/search-query-telemetry';

type PlanNode = {
  'Node Type'?: string; 'Relation Name'?: string; 'Index Name'?: string;
  'Actual Rows'?: number; 'Actual Loops'?: number; 'Actual Total Time'?: number;
  'Shared Hit Blocks'?: number; 'Shared Read Blocks'?: number;
  'Rows Removed by Filter'?: number; Plans?: PlanNode[];
};

function summarize(node: PlanNode): Record<string, unknown> {
  return {
    node: node['Node Type'], relation: node['Relation Name'], index: node['Index Name'],
    rows: node['Actual Rows'], loops: node['Actual Loops'], totalMs: node['Actual Total Time'],
    sharedHits: node['Shared Hit Blocks'], sharedReads: node['Shared Read Blocks'],
    rowsRemovedByFilter: node['Rows Removed by Filter'],
    children: (node.Plans ?? []).map(summarize),
  };
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  assertDevDatabase(raw);
  process.env.BJC_SEARCH_PROFILE = 'true';
  process.env.BJC_SEARCH_EXPLAIN_CAPTURE = 'true';
  process.env.BJC_SEARCH_STATEMENT_TIMEOUT_MS = '4500';
  const root = resolve(process.cwd(), '..', '..');
  const credentials = JSON.parse(await readFile(resolve(root, '_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as { accounts: { admin: { email: string; password: string } } };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  app.get(EventosConsultaService).trackSafe = () => undefined;
  const client = new Client({ connectionString: raw });
  try {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    await request(app.getHttpServer()).get('/api/busqueda/avanzada').query({ q: 'responsabilidad', page: 1, pageSize: 10 }).set('Authorization', `Bearer ${login.body.accessToken as string}`).expect(200);
    const queries = drainCapturedSearchQueryTemplates()
      .filter((item) => /\bSELECT\b/iu.test(item.query) && /"Sentencia"/u.test(item.query) && item.params)
      .sort((a, b) => b.durationMs - a.durationMs);
    const candidate = queries[0];
    if (!candidate) throw new Error('LEGACY_EXPLAIN_CAPTURE_UNAVAILABLE');
    let params: unknown;
    try { params = JSON.parse(String(candidate.params)); } catch { throw new Error('LEGACY_EXPLAIN_PARAMS_UNAVAILABLE'); }
    if (!Array.isArray(params)) throw new Error('LEGACY_EXPLAIN_PARAMS_UNAVAILABLE');
    await client.connect();
    await client.query(`SET statement_timeout='120000ms'`);
    const started = performance.now();
    const result = await client.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Planning Time': number; 'Execution Time': number; Settings?: unknown }> }>(
      `EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, SETTINGS, FORMAT JSON) ${candidate.query}`,
      params,
    );
    const plan = result.rows[0]['QUERY PLAN'][0];
    const report = {
      status: 'SPRINT121_LEGACY_EXPLAIN_PASS',
      generatedAt: new Date().toISOString(),
      target: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      capture: { queryFingerprint: candidate.fingerprint, originalDurationMs: candidate.durationMs, executionTimeMs: plan['Execution Time'], explainWallMs: Math.round((performance.now() - started) * 100) / 100 },
      planningMs: plan['Planning Time'],
      settings: plan.Settings ?? null,
      queryTemplatePersisted: false,
      queryParamsPersisted: false,
      plan: summarize(plan.Plan),
    };
    const output = resolve(root, '_recovery-work', 'sprint121', 'performance', 'legacy-explain.json');
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end().catch(() => undefined);
    await app.close();
  }
}

function assertDevDatabase(raw: string) {
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}
main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('DEV_DATABASE_') || message.startsWith('LEGACY_EXPLAIN_') ? message : 'SPRINT121_LEGACY_EXPLAIN_FAILED');
  process.exitCode = 1;
});
