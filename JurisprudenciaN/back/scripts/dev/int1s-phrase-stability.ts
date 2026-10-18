import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EventosConsultaService } from '../../src/estadisticas/eventos-consulta.service';

type Credentials = {
  accounts: Record<'admin', { email: string; password: string }>;
};
type TimedProfile = {
  totalMs: number;
  federatedMs: number;
  parserMs: number | null;
  adapters: Array<{ source: string; ok: boolean; latencyMs: number }>;
  adapterProfiles: Record<
    string,
    {
      countMs: number;
      resultPageMs: number;
      serializationMs?: number;
      failedQuery?: 'COUNT' | 'PAGE';
      errorCode?: string;
      resultRows: number;
      candidateCount?: number;
      candidateGenerationCount?: number;
      stageTimings?: Record<string, number | number[]>;
    } | null
  >;
};
type SearchResponse = {
  performance?: TimedProfile;
  federated?: {
    total?: unknown;
    totalExact?: unknown;
    hasMore?: unknown;
  };
  total?: unknown;
  totalExact?: unknown;
  hasMore?: unknown;
};

const repositoryRoot = resolve(process.cwd(), '..', '..');
const artifactPath = resolve(
  repositoryRoot,
  '_recovery-work/integration-int1s-search/stability-30-runs.json',
);
const queryFamilies = [
  { id: 'PHRASE_COMMON_RESPONSABILIDAD', query: '"responsabilidad civil"' },
  { id: 'PHRASE_COMMON_DANO', query: '"daño moral"' },
  { id: 'PHRASE_RARE_SERVICE', query: '"falta de servicio"' },
  { id: 'PHRASE_RARE_EMERGENT', query: '"daño emergente"' },
  { id: 'PHRASE_RARE_OBJECTIVE', query: '"responsabilidad objetiva"' },
  { id: 'PHRASE_RARE_PUNITIVE', query: '"daño punitivo"' },
];

function assertDevDatabase(databaseUrl: string | undefined) {
  if (!databaseUrl) throw new Error('INT1S_DEV_TARGET_REJECTED');
  const target = new URL(databaseUrl);
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev'
  )
    throw new Error('INT1S_DEV_TARGET_REJECTED');
}

function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return Number(
    ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)].toFixed(2),
  );
}

function metric(values: number[]) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Number(Math.max(...values).toFixed(2)),
    minMs: Number(Math.min(...values).toFixed(2)),
  };
}

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  process.env.BJC_SEARCH_PROFILE = 'true';
  const credentials = JSON.parse(
    await readFile(
      resolve(
        repositoryRoot,
        '_recovery-work/sprint10/acceptance/credentials.json',
      ),
      'utf8',
    ),
  ) as Credentials;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  app.get(EventosConsultaService).trackSafe = () => undefined;
  try {
    const login = await request(httpServer)
      .post('/api/auth/login')
      .send(credentials.accounts.admin)
      .expect(201);
    const loginBody = login.body as unknown as { accessToken: string };
    const token = loginBody.accessToken;
    const coldRuns: Array<Record<string, unknown>> = [];
    const warmRuns: Array<Record<string, unknown>> = [];
    const run = async (
      family: (typeof queryFamilies)[number],
      runNumber: number,
      temperature: 'cold' | 'warm',
    ) => {
      const startedAt = performance.now();
      const response = await request(httpServer)
        .get('/api/busqueda/avanzada')
        .query({ q: family.query, page: 1, pageSize: 10 })
        .set('Authorization', `Bearer ${token}`);
      const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
      const responseBody = response.body as unknown as SearchResponse;
      const profile = responseBody.performance;
      const federated = responseBody.federated ?? responseBody;
      const errors =
        profile?.adapters
          .filter((adapter) => !adapter.ok)
          .map((adapter) => {
            const sourceProfile = profile.adapterProfiles?.[adapter.source];
            return `${adapter.source}:${sourceProfile?.errorCode ?? 'SOURCE_ERROR'}`;
          }) ?? [];
      const row = {
        queryFamily: family.id,
        runNumber,
        temperature,
        httpStatus: response.status,
        elapsedMs,
        apiTotalMs: profile?.totalMs ?? null,
        federatedMs: profile?.federatedMs ?? null,
        parserMs: profile?.parserMs ?? null,
        jurisMs:
          profile?.adapters.find(
            (adapter) => adapter.source === 'JURISPRUDENCIA',
          )?.latencyMs ?? null,
        corpusMs:
          profile?.adapters.find((adapter) => adapter.source === 'CORPUS')
            ?.latencyMs ?? null,
        total: typeof federated.total === 'number' ? federated.total : null,
        totalExact:
          typeof federated.totalExact === 'boolean'
            ? federated.totalExact
            : null,
        hasMore:
          typeof federated.hasMore === 'boolean' ? federated.hasMore : null,
        jurisProfile: profile?.adapterProfiles?.JURISPRUDENCIA ?? null,
        corpusProfile: profile?.adapterProfiles?.CORPUS ?? null,
        errors,
        queryTextPersisted: false,
      };
      (temperature === 'cold' ? coldRuns : warmRuns).push(row);
    };

    for (const family of queryFamilies) await run(family, 0, 'cold');
    for (let repetition = 1; repetition <= 5; repetition += 1) {
      for (const family of queryFamilies) await run(family, repetition, 'warm');
    }

    const warmTotals = warmRuns.map((entry) => Number(entry.apiTotalMs));
    const warmJuris = warmRuns.map((entry) => Number(entry.jurisMs));
    const warmCorpus = warmRuns.map((entry) => Number(entry.corpusMs));
    const warmFailures = warmRuns.filter(
      (entry) =>
        (entry.errors as string[]).length > 0 || entry.httpStatus !== 200,
    ).length;
    const exactTotalFailures = warmRuns.filter(
      (entry) => entry.totalExact !== true,
    ).length;
    const byFamily = Object.fromEntries(
      queryFamilies.map((family) => {
        const rows = warmRuns.filter(
          (entry) => entry.queryFamily === family.id,
        );
        return [
          family.id,
          {
            runs: rows.length,
            totalMs: metric(rows.map((entry) => Number(entry.apiTotalMs))),
            jurisprudenciaMs: metric(
              rows.map((entry) => Number(entry.jurisMs)),
            ),
            corpusMs: metric(rows.map((entry) => Number(entry.corpusMs))),
            failures: rows.flatMap((entry) => entry.errors as string[]),
          },
        ];
      }),
    );
    const report = {
      generatedAt: new Date().toISOString(),
      status:
        warmRuns.length === 30 && warmFailures === 0 && exactTotalFailures === 0
          ? 'PASS'
          : warmRuns.length === 30 && warmFailures === 0
            ? 'BLOCKED_EXACT_TOTAL'
            : 'FAIL',
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      repetitions: warmRuns.length,
      phraseFamilies: queryFamilies.map(({ id }) => id),
      coldRuns,
      warmOverall: {
        totalMs: metric(warmTotals),
        jurisprudenciaMs: metric(warmJuris),
        corpusMs: metric(warmCorpus),
        timeouts: warmFailures,
        exactTotalFailures,
      },
      byFamily,
      runs: warmRuns,
      queryTextPersisted: false,
      eventWritesSuppressed: true,
    };
    await mkdir(
      resolve(repositoryRoot, '_recovery-work/integration-int1s-search'),
      { recursive: true },
    );
    await writeFile(
      artifactPath,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(
      JSON.stringify({
        status: report.status,
        repetitions: report.repetitions,
        warmOverall: report.warmOverall,
        artifactPath,
      }),
    );
    if (report.status !== 'PASS') process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message.split('\n')[0] : String(error);
  console.error(`INT1S_PHRASE_STABILITY=FAIL:${message}`);
  process.exitCode = 1;
});
