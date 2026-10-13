import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EventosConsultaService } from '../../src/estadisticas/eventos-consulta.service';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

type Credentials = { accounts: Record<'admin', { email: string; password: string }> };
type Metric = { minMs: number; averageMs: number; p50Ms: number; p95Ms: number; maxMs: number };
type Profile = {
  engine?: 'legacy' | 'v2' | 'hybrid';
  enginesBySource?: Record<string, string>;
  legacyMs: number;
  federatedMs: number;
  totalMs: number;
  parserMs: number | null;
  mergeAndRankingMs: number | null;
  adapters: Array<{ source: string; ok: boolean; total: number; latencyMs: number }>;
  adapterProfiles: Record<string, { countMs: number; resultPageMs: number; serializationMs?: number; candidateStrategy?: string; candidateCount?: number; candidateGenerationCount?: number; windowExpansions?: number; windowSizes?: number[]; exactHitsByWindow?: number[]; stageTimings?: Record<string, number | number[]>; resultRows: number; failedQuery?: 'COUNT' | 'PAGE'; errorCode?: string; errorMessage?: string; queryCount?: number; queryFingerprints?: string[] } | null>;
  poolDiagnostics?: Record<string, { total: number; active: number; idle: number; waiting: number; max: number } | null>;
  legacyProfile?: Record<string, unknown> | null;
};

const root = resolve(process.cwd(), '..', '..');
const repetitions = Number(process.env.BJC_SEARCH_BENCHMARK_REPETITIONS ?? 10);
if (!Number.isInteger(repetitions) || repetitions < 3 || repetitions > 10) {
  throw new Error('SEARCH_BENCHMARK_REPETITIONS_REJECTED');
}

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  const phase = process.argv[2] === 'after' ? 'after' : 'baseline';
  const sprintLabel = process.env.BJC_SPRINT1491 === 'true' ? 'SPRINT1491' : process.env.BJC_SPRINT149 === 'true' ? 'SPRINT149' : process.env.BJC_SPRINT148 === 'true' ? 'SPRINT148' : process.env.BJC_SPRINT123 === 'true' ? 'SPRINT123' : process.env.BJC_SPRINT122 === 'true' ? 'SPRINT122' : 'SPRINT12';
  process.env.BJC_SEARCH_PROFILE = 'true';
  const credentials = JSON.parse(await readFile(resolve(root, '_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  // Benchmark calls should not create search-history writes or persist query strings.
  app.get(EventosConsultaService).trackSafe = () => undefined;
  try {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    const token = login.body.accessToken as string;
    const collection = await prisma.digestoCollection.findFirst({
      where: { status: 'ACTIVE', memberships: { some: { document: { is: { status: 'INDEXED', visibility: 'INTERNAL' } } } } },
      orderBy: { name: 'asc' }, select: { id: true },
    });
    const topic = await prisma.digestoTopic.findFirst({
      where: { active: true, documents: { some: { document: { is: { status: 'INDEXED', visibility: 'INTERNAL' } } } } },
      orderBy: { name: 'asc' }, select: { id: true },
    });
    const tag = await prisma.digestoTag.findFirst({
      where: { documents: { some: { document: { is: { status: 'INDEXED', visibility: 'INTERNAL' } } } } },
      orderBy: { name: 'asc' }, select: { id: true },
    });

    const cases = [
      { name: 'TERM_COMMON', query: 'responsabilidad' },
      { name: 'TERM_RARE', query: 'Rondinella' },
      { name: 'PHRASE', query: '"responsabilidad civil"' },
      { name: 'AND', query: 'responsabilidad AND contrato' },
      { name: 'OR', query: 'responsabilidad OR contrato' },
      { name: 'NOT_WITH_POSITIVE', query: 'responsabilidad NOT mediacion' },
      { name: 'NOT_ONLY', query: 'NOT mediacion' },
      { name: 'FIELD', query: 'tema:responsabilidad' },
      { name: 'PREFIX', query: 'responsabilid%' },
      { name: 'SUFFIX', query: '%civil' },
      { name: 'SHORT_TERM', query: 'de' },
      { name: 'IDENTIFIER_EXACT', query: 'expediente:0000000000' },
      { name: 'ZERO_RESULT', query: 'zzqvnoresult2026sprint12' },
      { name: 'COMPLEX_BOOLEAN', query: '(responsabilidad OR contrato) AND NOT mediacion' },
      ...(collection ? [{ name: 'COLLECTION_FILTER', query: 'responsabilidad', filters: { digestoCollectionId: collection.id } }] : []),
      ...(topic ? [{ name: 'TOPIC_FILTER', query: 'responsabilidad', filters: { digestoTopicId: topic.id } }] : []),
      ...(tag ? [{ name: 'TAG_FILTER', query: 'responsabilidad', filters: { digestoTagId: tag.id } }] : []),
    ];
    const casesReport: Record<string, unknown> = {};
    const requestedFamily = process.argv[3];
    const selectedCases = requestedFamily
      ? cases.filter((sample) => sample.name === requestedFamily)
      : cases;
    if (requestedFamily && selectedCases.length === 0) throw new Error('SEARCH_BENCHMARK_FAMILY_REJECTED');
    const benchmarkRoot = process.env.BJC_SEARCH_BENCHMARK_ROOT
      ? resolve(process.env.BJC_SEARCH_BENCHMARK_ROOT)
      : resolve(root, '_recovery-work', 'sprint12', 'performance');
    const allowedRoot = resolve(root, '_recovery-work', process.env.BJC_SEARCH_BENCHMARK_ROOT ? (sprintLabel === 'SPRINT1491' ? 'sprint1491' : sprintLabel === 'SPRINT149' ? 'sprint149' : sprintLabel === 'SPRINT148' ? 'sprint148' : sprintLabel === 'SPRINT123' ? 'sprint123' : sprintLabel === 'SPRINT122' ? 'sprint122' : 'sprint121') : 'sprint12');
    if (benchmarkRoot.toLowerCase() !== allowedRoot.toLowerCase() && !benchmarkRoot.toLowerCase().startsWith(`${allowedRoot.toLowerCase()}\\`)) throw new Error('SEARCH_BENCHMARK_OUTPUT_PATH_REJECTED');
    const outputDir = sprintLabel === 'SPRINT1491' ? benchmarkRoot : resolve(benchmarkRoot, phase);
    await mkdir(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, sprintLabel === 'SPRINT1491' ? (phase === 'baseline' ? 'benchmark-before.json' : 'benchmark-after.json') : 'search-benchmark.json');
    const runSamples: Array<Record<string, unknown>> = [];
    if (phase === 'after') {
      try {
        const prior = JSON.parse(await readFile(outputPath, 'utf8')) as {
          status?: string;
          repetitions?: number;
          environment?: { endpoint?: string; database?: string; role?: string };
          cases?: Record<string, unknown>;
        };
        if (prior.status?.startsWith(`${sprintLabel}_SEARCH_AFTER_`) && prior.repetitions === repetitions &&
            prior.environment?.endpoint === '127.0.0.1:55432' && prior.environment.database === 'buscador_juridico_civil_dev' &&
            prior.environment.role === 'bjc_dev' && prior.cases) {
          Object.assign(casesReport, prior.cases);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const issueRunSample = async (sample: (typeof selectedCases)[number], runNumber: number, temperature: 'cold' | 'warm') => {
      const response = await request(app.getHttpServer()).get('/api/busqueda/avanzada')
        .query({ q: sample.query, page: 1, pageSize: 10, ...('filters' in sample ? sample.filters : {}) })
        .set('Authorization', `Bearer ${token}`);
      if (response.status !== 200) throw new Error(`SEARCH_BENCHMARK_HTTP_${response.status}:${sample.name}`);
      const profile = response.body.performance as Profile | undefined;
      if (!profile) throw new Error('SEARCH_PROFILE_NOT_ENABLED');
      if (sprintLabel === 'SPRINT1491') {
        const corpus = profile.adapterProfiles?.CORPUS;
        runSamples.push({
          queryFamily: sample.name,
          queryId: `${sample.name.toLowerCase()}-${temperature}-${runNumber}`,
          runNumber,
          temperature,
          elapsedTotalMs: profile.totalMs,
          federatedMs: profile.federatedMs,
          parserMs: profile.parserMs,
          candidateDatabaseAndPageMs: corpus?.resultPageMs ?? null,
          exactCountMs: corpus?.countMs ?? null,
          resultCount: (response.body.federated?.results ?? []).length,
          total: response.body.federated?.total ?? null,
          candidateCount: corpus?.candidateCount ?? null,
          candidateGenerationCount: corpus?.candidateGenerationCount ?? null,
          queryCount: corpus?.queryCount ?? null,
          windowExpansions: corpus?.windowExpansions ?? null,
          windowSizes: corpus?.windowSizes ?? [],
          exactHitsByWindow: corpus?.exactHitsByWindow ?? [],
          stageTimings: corpus?.stageTimings ?? null,
          errors: profile.adapters.filter((adapter) => !adapter.ok).map((adapter) => ({ source: adapter.source, error: 'source_error' })),
          queryTextPersisted: false,
        });
      }
      return { response, profile };
    };
    for (const sample of selectedCases) {
      const rows: Profile[] = [];
      let status = 0;
      if (sprintLabel === 'SPRINT1491') {
        const cold = await issueRunSample(sample, 0, 'cold');
        status = cold.response.status;
        await issueRunSample(sample, 0, 'warm'); // Deliberate warmup, excluded from the ten measured warm runs.
      }
      for (let index = 1; index <= repetitions; index += 1) {
        const run = await issueRunSample(sample, index, 'warm');
        status = run.response.status;
        rows.push(run.profile);
      }
      casesReport[sample.name] = summarize(rows, status);
      console.log(JSON.stringify({ phase, family: sample.name, completed: rows.length }));
      await writeFile(outputPath, `${JSON.stringify({
        status: `${sprintLabel}_SEARCH_${phase.toUpperCase()}_IN_PROGRESS`,
        generatedAt: new Date().toISOString(),
        environment: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
        repetitions,
        warmupRequests: 1,
        queryTextPersisted: false,
        eventWritesSuppressed: true,
        collectionFilterAvailable: Boolean(collection),
        topicFilterAvailable: Boolean(topic),
        tagFilterAvailable: Boolean(tag),
        unsupportedTaxonomyFilters: [!topic ? 'TOPIC_FILTER' : null, !tag ? 'TAG_FILTER' : null].filter(Boolean),
        instrumentation: 'engine and per-source engine identify routing; timings and SQL fingerprints only, no SQL, parameters, or query text persisted',
        cases: casesReport,
      }, null, 2)}\n`, 'utf8');
      if (sprintLabel === 'SPRINT1491') await writeFile(resolve(benchmarkRoot, 'run-samples.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), queryTextPersisted: false, samples: runSamples }, null, 2)}\n`, 'utf8');
    }

    const report = {
      status: `${sprintLabel}_SEARCH_${phase.toUpperCase()}_COMPLETE`,
      generatedAt: new Date().toISOString(),
      environment: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      repetitions,
      selectedFamilies: Object.keys(casesReport),
      warmupRequests: 1,
      queryTextPersisted: false,
      eventWritesSuppressed: true,
      collectionFilterAvailable: Boolean(collection),
      topicFilterAvailable: Boolean(topic),
      tagFilterAvailable: Boolean(tag),
      unsupportedTaxonomyFilters: [!topic ? 'TOPIC_FILTER' : null, !tag ? 'TAG_FILTER' : null].filter(Boolean),
      instrumentation: sprintLabel === 'SPRINT1491' ? 'Per-run total, parser, adapter query/page, candidate count, query count, and adaptive-window instrumentation; query text and SQL values are not persisted.' : 'engine and per-source engine identify routing; timings and SQL fingerprints only, no SQL, parameters, or query text persisted',
      cases: casesReport,
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (sprintLabel === 'SPRINT1491') await writeFile(resolve(benchmarkRoot, 'run-samples.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), queryTextPersisted: false, samples: runSamples }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, output: outputPath }, null, 2));
  } finally {
    await app.close();
  }
}

function summarize(rows: Profile[], status: number) {
  const metric = (values: number[]): Metric => {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
    return { minMs: round(sorted[0]), averageMs: round(values.reduce((sum, value) => sum + value, 0) / values.length), p50Ms: round(percentile(0.5)), p95Ms: round(percentile(0.95)), maxMs: round(sorted[sorted.length - 1]) };
  };
  const result: Record<string, unknown> = {
    httpStatus: status,
    requests: rows.length,
    engineRouting: {
      engines: [...new Set(rows.map((row) => row.engine ?? 'unknown'))],
      perSource: Object.fromEntries([...new Set(rows.flatMap((row) => Object.keys(row.enginesBySource ?? {})))].map((source) => [
        source,
        [...new Set(rows.map((row) => row.enginesBySource?.[source] ?? 'unknown'))],
      ])),
    },
    legacyMs: metric(rows.map((row) => row.legacyMs)),
    federatedMs: metric(rows.map((row) => row.federatedMs)),
    totalMs: metric(rows.map((row) => row.totalMs)),
    parserMs: metric(rows.flatMap((row) => row.parserMs === null ? [] : [row.parserMs])),
    mergeAndRankingMs: metric(rows.flatMap((row) => row.mergeAndRankingMs === null ? [] : [row.mergeAndRankingMs])),
  };
  for (const source of ['JURISPRUDENCIA', 'CORPUS']) {
    const profiles = rows.map((row) => row.adapterProfiles?.[source]).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const sourceRuns = rows.flatMap((row) => row.adapters.filter((item) => item.source === source));
    const latencies = sourceRuns.map((item) => item.latencyMs);
    const entry: Record<string, unknown> = {
      latencyMs: latencies.length ? metric(latencies) : null,
      successfulRequests: sourceRuns.filter((item) => item.ok).length,
      failedRequests: sourceRuns.filter((item) => !item.ok).length,
      countMs: null,
      pageMs: null,
      serializationMs: null,
    };
    if (profiles.length) {
      entry.countMs = metric(profiles.map((item) => item.countMs));
      entry.pageMs = metric(profiles.map((item) => item.resultPageMs));
      entry.queryFailures = profiles.flatMap((item) => item.failedQuery ? [{ query: item.failedQuery, errorCode: item.errorCode ?? 'unknown', errorMessage: item.errorMessage ?? null }] : []);
      entry.queryCount = profiles.reduce((sum, item) => sum + (item.queryCount ?? 0), 0) / profiles.length;
      entry.queryFingerprints = [...new Set(profiles.flatMap((item) => item.queryFingerprints ?? []))];
      const serialization = profiles.flatMap((item) => item.serializationMs === undefined ? [] : [item.serializationMs]);
      entry.serializationMs = serialization.length ? metric(serialization) : null;
    }
    result[source] = entry;
  }
  const legacyProfiles = rows.map((row) => row.legacyProfile).filter((item): item is Record<string, unknown> => Boolean(item));
  if (legacyProfiles.length) result['LEGACY_DIAGNOSTICS'] = legacyProfiles;
  const poolNames = [...new Set(rows.flatMap((row) => Object.keys(row.poolDiagnostics ?? {})))];
  if (poolNames.length) {
    result['POOL_DIAGNOSTICS'] = Object.fromEntries(poolNames.map((name) => {
      const samples = rows.map((row) => row.poolDiagnostics?.[name]).filter((item): item is NonNullable<typeof item> => Boolean(item));
      return [name, {
        maxConnections: samples[0]?.max ?? null,
        peakTotal: Math.max(0, ...samples.map((item) => item.total)),
        peakActive: Math.max(0, ...samples.map((item) => item.active)),
        peakIdle: Math.max(0, ...samples.map((item) => item.idle)),
        peakWaiting: Math.max(0, ...samples.map((item) => item.waiting)),
      }];
    }));
  }
  return result;
}

function round(value: number) { return Math.round(value * 100) / 100; }
function assertDevDatabase(raw?: string) {
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

if (require.main === module) main().catch((error) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(process.env.BJC_SPRINT1491 === 'true' || /^(DEV_DATABASE_[A-Z_]+|SEARCH_PROFILE_NOT_ENABLED|SEARCH_BENCHMARK_HTTP_[0-9]{3}:[A-Z_]+|SEARCH_BENCHMARK_OUTPUT_PATH_REJECTED)$/u.test(message) ? message : 'SPRINT12_SEARCH_BENCHMARK_FAILED');
  process.exitCode = 1;
});
