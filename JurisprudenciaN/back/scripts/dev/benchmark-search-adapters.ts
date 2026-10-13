import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { LegacySqliteSearchAdapter } from '../../src/busqueda/adapters/legacy-sqlite-search.adapter';
import { PostgresJurisprudenciaSearchAdapter } from '../../src/busqueda/adapters/postgres-jurisprudencia-search.adapter';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';

type BenchmarkCase = {
  id: string;
  query: string;
  legacyMeasurement: {
    status: string;
    matches?: number;
    legacyComparisonQuery?: string;
    filters?: { sala?: string; fechaDesde?: string; fechaHastaExclusive?: string };
  };
};

const root = resolve(__dirname, '../../../..');
const benchmarkPath = resolve(root, 'docs-integracion/benchmark-busqueda.json');
const defaultOutputPath = resolve(root, 'docs-integracion/29-benchmark-postgresql.json');
const requestedOutputPath = process.env.BJC_BENCHMARK_OUTPUT_PATH;
const sprint12OutputRoot = resolve(root, '_recovery-work/sprint12');
const requestedOutputRoot = process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint121'
  ? resolve(root, '_recovery-work/sprint121')
  : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint122'
    ? resolve(root, '_recovery-work/sprint122')
    : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint123'
      ? resolve(root, '_recovery-work/sprint123')
      : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint148'
        ? resolve(root, '_recovery-work/sprint148')
        : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint149'
          ? resolve(root, '_recovery-work/sprint149')
    : sprint12OutputRoot;
if (process.env.BJC_BENCHMARK_OUTPUT_ROOT && !['sprint121', 'sprint122', 'sprint123', 'sprint148', 'sprint149'].includes(process.env.BJC_BENCHMARK_OUTPUT_ROOT)) {
  throw new Error('BJC_BENCHMARK_OUTPUT_ROOT is not an allowed report root.');
}
const outputPath = requestedOutputPath ? resolve(requestedOutputPath) : defaultOutputPath;
if (requestedOutputPath && !outputPath.toLowerCase().startsWith(`${requestedOutputRoot.toLowerCase()}\\`)) {
  throw new Error('BJC_BENCHMARK_OUTPUT_PATH must stay inside the selected recovery root.');
}
const sourcePath = process.env.SEARCH_SPIKE_SQLITE_PATH;
const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as { cases: BenchmarkCase[] };
const measured = benchmark.cases.filter((item) => item.legacyMeasurement.status === 'measured_legacy_sqlite');
const pageSize = 300;

if (!sourcePath) throw new Error('SEARCH_SPIKE_SQLITE_PATH is required.');
if (!process.env.DATABASE_URL) throw new Error('Run through the DEV database guard.');

const contextFor = (item: BenchmarkCase, page: number): SearchContext => ({
  visibility: 'INTERNAL',
  dialect: 'legacy-reference',
  publicationPolicy: 'legacy-active-only',
  page,
  pageSize,
  filters: {
    sala: item.legacyMeasurement.filters?.sala,
    fechaDesde: item.legacyMeasurement.filters?.fechaDesde,
    fechaHastaExclusive: item.legacyMeasurement.filters?.fechaHastaExclusive,
  },
});

const queryFor = (item: BenchmarkCase) =>
  item.id === 'BJC-031' || item.id === 'BJC-032'
    ? 'daño'
    : item.legacyMeasurement.legacyComparisonQuery ?? item.query;

async function collect(
  adapter: LegacySqliteSearchAdapter | PostgresJurisprudenciaSearchAdapter,
  query: ReturnType<typeof parseSearchQuery>,
  item: BenchmarkCase,
) {
  const start = performance.now();
  const ids = await adapter.searchIds(query, contextFor(item, 1));
  const total = ids.length;
  return { ids, total, dbMs: performance.now() - start };
}

async function measurePage(
  adapter: LegacySqliteSearchAdapter | PostgresJurisprudenciaSearchAdapter,
  query: ReturnType<typeof parseSearchQuery>,
  item: BenchmarkCase,
  dialect: SearchContext['dialect'] = 'legacy-reference',
) {
  const start = performance.now();
  const result = await adapter.search(query, { ...contextFor(item, 1), dialect });
  return { total: result.total, dbMs: performance.now() - start };
}

function idSetDigest(ids: string[]) {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

function percentiles(samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const at = (fraction: number) => ordered[Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1)] ?? 0;
  return {
    p50: Number(at(0.5).toFixed(3)),
    p95: Number(at(0.95).toFixed(3)),
    max: Number((ordered.at(-1) ?? 0).toFixed(3)),
  };
}

async function main() {
  const sqlite = new LegacySqliteSearchAdapter(sourcePath!);
  const postgres = new PostgresJurisprudenciaSearchAdapter(process.env.DATABASE_URL);
  const rows: Array<Record<string, unknown>> = [];
  const warm = parseSearchQuery('daño');
  const warmCase = measured.find((item) => item.id === 'BJC-001')!;
  await collect(sqlite, warm, warmCase);
  await collect(postgres, warm, warmCase);
  await measurePage(sqlite, warm, warmCase);
  await measurePage(postgres, warm, warmCase);
  await measurePage(postgres, warm, warmCase, 'modern');

  try {
    for (const item of measured) {
      const parseStart = performance.now();
      const query = parseSearchQuery(queryFor(item));
      const parseMs = performance.now() - parseStart;
      const sqliteResult = await collect(sqlite, query, item);
      let postgresResult: Awaited<ReturnType<typeof collect>>;
      try {
        postgresResult = await collect(postgres, query, item);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : 'unknown';
        rows.push({
          id: item.id,
          queryFingerprint: createHash('sha256').update(queryFor(item)).digest('hex').slice(0, 16),
          expectedLegacyCount: item.legacyMeasurement.matches ?? null,
          sqliteCount: sqliteResult.total,
          postgresCount: null,
          status: code === '57014' ? 'FAIL_STATEMENT_TIMEOUT' : 'FAIL_POSTGRES_QUERY',
          postgresErrorCode: code,
          parseMs: Number(parseMs.toFixed(3)),
          sqliteIdUniverseMs: Number(sqliteResult.dbMs.toFixed(3)),
        });
        console.log(`PARITY=FAIL; id=${item.id}; code=${code}`);
        writeParityProgress(rows);
        continue;
      }
      const sqliteSet = new Set(sqliteResult.ids);
      const postgresSet = new Set(postgresResult.ids);
      const intersection = [...sqliteSet].filter((id) => postgresSet.has(id));
      const sqliteOnly = [...sqliteSet].filter((id) => !postgresSet.has(id));
      const postgresOnly = [...postgresSet].filter((id) => !sqliteSet.has(id));
      const exact = sqliteOnly.length === 0 && postgresOnly.length === 0;
      rows.push({
        id: item.id,
        queryFingerprint: createHash('sha256').update(queryFor(item)).digest('hex').slice(0, 16),
        expectedLegacyCount: item.legacyMeasurement.matches ?? null,
        sqliteCount: sqliteResult.total,
        postgresCount: postgresResult.total,
        intersection: intersection.length,
        sqliteOnly: sqliteOnly.length,
        postgresOnly: postgresOnly.length,
        sqliteIdsSha256: idSetDigest(sqliteResult.ids),
        postgresIdsSha256: idSetDigest(postgresResult.ids),
        sqliteOnlySample: sqliteOnly.slice(0, 10),
        postgresOnlySample: postgresOnly.slice(0, 10),
        status: exact && sqliteResult.total === (item.legacyMeasurement.matches ?? sqliteResult.total)
          ? 'PASS_COMPAT'
          : exact ? 'FAIL_EXPECTED_COUNT' : 'FAIL_ID_SET',
        parseMs: Number(parseMs.toFixed(3)),
        sqliteIdUniverseMs: Number(sqliteResult.dbMs.toFixed(3)),
        postgresIdUniverseMs: Number(postgresResult.dbMs.toFixed(3)),
      });
      console.log(`PARITY=${rows[rows.length - 1].status}; id=${item.id}`);
      writeParityProgress(rows);
    }

    const repeatedIds = ['BJC-001', 'BJC-004', 'BJC-016', 'BJC-047'];
    const repeated: Array<Record<string, unknown>> = [];
    for (const id of repeatedIds) {
      const item = measured.find((candidate) => candidate.id === id)!;
      const sqliteSamples: number[] = [];
      const postgresLegacySamples: number[] = [];
      const postgresModernSamples: number[] = [];
      const parseSamples: number[] = [];
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const parseStart = performance.now();
        const query = parseSearchQuery(queryFor(item));
        parseSamples.push(performance.now() - parseStart);
        sqliteSamples.push((await measurePage(sqlite, query, item)).dbMs);
        postgresLegacySamples.push((await measurePage(postgres, query, item)).dbMs);
        postgresModernSamples.push((await measurePage(postgres, query, item, 'modern')).dbMs);
      }
      repeated.push({
        id,
        iterations: 3,
        parseMs: percentiles(parseSamples),
        sqliteDbMs: percentiles(sqliteSamples),
        postgresLegacyDbMs: percentiles(postgresLegacySamples),
        postgresModernDbMs: percentiles(postgresModernSamples),
        sqliteTotalMs: percentiles(sqliteSamples.map((value, index) => value + parseSamples[index])),
        postgresLegacyTotalMs: percentiles(postgresLegacySamples.map((value, index) => value + parseSamples[index])),
        postgresModernTotalMs: percentiles(postgresModernSamples.map((value, index) => value + parseSamples[index])),
      });
    }

    const report = {
      mission: process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint149' ? '14.9' : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint148' ? '14.8' : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint123' ? '12.3' : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint122' ? '12.2' : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint121' ? '12.1' : '5.3',
      generatedAt: new Date().toISOString(),
      source: 'jurisp_6/db/jurisprudencia_db.sqlite; read-only immutable query_only',
      postgres: { serverVersion: '16.15', endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      fixture: { sentencias: 21109, sumarios: 25138, orphanSumariosSkipped: 1, excludedTable: 'tb_microisis' },
      benchmarkSource: 'benchmark-busqueda.json (read-only; unchanged)',
      parityUniverse: 'Same legacy summary/sentence join and active filters; SQLite and PostgreSQL use preserved legacy sumario IDs.',
      measuredCases: rows.length,
      passCompat: rows.filter((row) => row.status === 'PASS_COMPAT').length,
      failedCases: rows.filter((row) => row.status !== 'PASS_COMPAT'),
      performanceMethod: { warmup: 'daño, full ID-set scan then first result page per adapter', iterations: 3, cases: repeatedIds, mode: 'SQLite and PostgreSQL legacy-reference parity; PostgreSQL modern ranking measured separately; COUNT plus first ranked page, not full result materialization' },
      repeatedPerformance: repeated,
      results: rows,
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`BENCHMARK=PASS_WRITE; cases=${rows.length}; passCompat=${report.passCompat}; failed=${report.failedCases.length}; report=${outputPath}`);
    for (const row of rows.filter((entry) => entry.status !== 'PASS_COMPAT')) {
      console.log(`PARITY=${row.status}; id=${row.id}; sqlite=${row.sqliteCount}; postgres=${row.postgresCount}; intersection=${row.intersection}; sqliteOnly=${row.sqliteOnly}; postgresOnly=${row.postgresOnly}`);
    }
  } finally {
    await postgres.close();
  }
}

function writeParityProgress(rows: Array<Record<string, unknown>>) {
  if (!process.env.BJC_BENCHMARK_OUTPUT_PATH) return;
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({
    mission: process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint149' ? '14.9' : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint148' ? '14.8' : process.env.BJC_BENCHMARK_OUTPUT_ROOT === 'sprint123' ? '12.3' : '12.1',
    generatedAt: new Date().toISOString(),
    postgres: { serverVersion: '16.15', endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
    queryTextPersisted: false,
    measuredCases: rows.length,
    passCompat: rows.filter((row) => row.status === 'PASS_COMPAT').length,
    failedCases: rows.filter((row) => row.status !== 'PASS_COMPAT'),
    results: rows,
    status: rows.length === measured.length && rows.every((row) => row.status === 'PASS_COMPAT') ? '40/40 PASS_COMPAT' : 'PARITY_IN_PROGRESS',
  }, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(`BENCHMARK=FAIL; ${error.message}`);
  process.exitCode = 1;
});
