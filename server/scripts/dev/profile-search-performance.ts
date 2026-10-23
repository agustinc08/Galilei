import { readFileSync, writeFileSync } from 'node:fs';
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
    legacyComparisonQuery?: string;
    filters?: { sala?: string; fechaDesde?: string; fechaHastaExclusive?: string };
  };
};

const root = resolve(__dirname, '../../../');
const benchmarkPath = resolve(root, 'docs/integracion/benchmark-busqueda.json');
const stage = process.argv[2] === 'after' ? 'after' : 'before';
const focus = process.argv[3];
const outputPath = resolve(root, focus
  ? `docs/integracion/35-performance-${focus.toLowerCase()}.json`
  : stage === 'before'
    ? 'docs/integracion/33-performance-baseline-postgresql.json'
    : 'docs/integracion/35-performance-final-postgresql.json');
const sourcePath = process.env.SEARCH_SPIKE_SQLITE_PATH;
const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as { cases: BenchmarkCase[] };
const cases = benchmark.cases.filter((item) => item.legacyMeasurement.status === 'measured_legacy_sqlite');
const samples = process.argv[3] ? 20 : 8;
const warmups = process.argv[3] ? 3 : 2;

if (!sourcePath || !process.env.DATABASE_URL) throw new Error('Run through the DEV database guard.');

const categories: Array<{ category: string; id: string; queryOverride?: string; dialect?: 'modern' }> = [
  { category: 'IDENTIFIER_CANDIDATE', id: 'BJC-022' },
  { category: 'IDENTIFIER_FIELD', id: 'BJC-022', queryOverride: 'numeroSentencia:1113' },
  { category: 'TERM', id: 'BJC-001' },
  { category: 'PHRASE', id: 'BJC-008' },
  { category: 'AND', id: 'BJC-005' },
  { category: 'OR', id: 'BJC-006' },
  { category: 'NOT', id: 'BJC-007' },
  { category: 'FIELD', id: 'BJC-033' },
  { category: 'PREFIX', id: 'BJC-009' },
  { category: 'SUFFIX', id: 'BJC-010' },
  { category: 'SUFFIX_MATCHING', id: 'BJC-010', queryOverride: '%civil' },
  { category: 'COMPLEX_BOOLEAN', id: 'BJC-054' },
  { category: 'RANKED_TEXT', id: 'BJC-011', dialect: 'modern' },
  { category: 'SHORT_TERM_DE', id: 'BJC-020' },
  { category: 'SHORT_TERM_A', id: 'BJC-021' },
];

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return { min: +(sorted[0] ?? 0).toFixed(3), p50: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), max: +at(1).toFixed(3) };
}

function contextFor(item: BenchmarkCase): SearchContext {
  return {
    visibility: 'INTERNAL',
    dialect: 'legacy-reference',
    publicationPolicy: 'legacy-active-only',
    page: 1,
    pageSize: 25,
    filters: {
      sala: item.legacyMeasurement.filters?.sala,
      fechaDesde: item.legacyMeasurement.filters?.fechaDesde,
      fechaHastaExclusive: item.legacyMeasurement.filters?.fechaHastaExclusive,
    },
  };
}

function queryFor(item: BenchmarkCase) {
  return item.id === 'BJC-031' || item.id === 'BJC-032'
    ? 'daño'
    : item.legacyMeasurement.legacyComparisonQuery ?? item.query;
}

async function main() {
  const sqlite = new LegacySqliteSearchAdapter(sourcePath!);
  const postgres = new PostgresJurisprudenciaSearchAdapter(process.env.DATABASE_URL);
  const results: Array<Record<string, unknown>> = [];
  try {
    const selectedCategories = focus ? categories.filter((selection) => selection.category.toLowerCase() === focus.toLowerCase()) : categories;
    if (selectedCategories.length === 0) throw new Error(`Unknown profile category ${focus}.`);
    for (const selection of selectedCategories) {
      const item = cases.find((candidate) => candidate.id === selection.id);
      if (!item) throw new Error(`Missing representative benchmark case ${selection.id}.`);
      const sourceQuery = selection.queryOverride ?? queryFor(item);
      const parseTimes: number[] = [];
      const sqliteTimes: number[] = [];
      const countTimes: number[] = [];
      const resultPageTimes: number[] = [];
      const totalTimes: number[] = [];
      const sampleRows: Array<Record<string, number>> = [];
      let resultCount = 0;

      for (let i = 0; i < warmups + samples; i += 1) {
        const parseStart = performance.now();
        const query = parseSearchQuery(sourceQuery);
        const parseMs = performance.now() - parseStart;
        const ctx = contextFor(item);
        const sqliteStart = performance.now();
        const sqlitePage = await sqlite.search(query, ctx);
        const sqliteMs = performance.now() - sqliteStart;
        const pgStart = performance.now();
        const pgPage = await postgres.search(query, { ...ctx, dialect: selection.dialect ?? 'modern' });
        const pgMs = performance.now() - pgStart;
        const pgProfile = postgres.getLastSearchProfile();
        resultCount = pgPage.total;
        if (i >= warmups && pgProfile) {
          parseTimes.push(parseMs);
          sqliteTimes.push(sqliteMs);
          countTimes.push(pgProfile.countMs);
          resultPageTimes.push(pgProfile.resultPageMs);
          totalTimes.push(pgMs + parseMs);
          sampleRows.push({ parseMs, sqliteTotalMs: sqliteMs, postgresCountMs: pgProfile.countMs,
            postgresResultPageAndRankingMs: pgProfile.resultPageMs, postgresTotalMs: pgMs + parseMs });
        }
      }
      results.push({
        category: selection.category,
        caseId: item.id,
        query: sourceQuery,
        dialect: selection.dialect ?? 'modern',
        count: resultCount,
        warmups,
        repetitions: samples,
        parseMs: summary(parseTimes),
        sqliteTotalMs: summary(sqliteTimes),
        postgresCountMs: summary(countTimes),
        postgresResultPageAndRankingMs: summary(resultPageTimes),
        postgresTotalMs: summary(totalTimes),
        samples: sampleRows,
      });
      console.log(`PROFILE=${selection.category}; count=${resultCount}; pg_p50=${summary(totalTimes).p50}ms; count_p50=${summary(countTimes).p50}ms; page_p50=${summary(resultPageTimes).p50}ms`);
    }
    const report = {
      mission: stage === 'before' ? '5.4 baseline' : '5.4 final',
      generatedAt: new Date().toISOString(),
      target: { postgres: '16.15', endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      hardware: { cpu: '13th Gen Intel(R) Core(TM) i7-13620H', memoryGiB: 15.7, os: 'Windows 11 Home 10.0.26300' },
      corpus: { source: 'jurisp_6/db/jurisprudencia_db.sqlite (read-only immutable query_only)', sentencias: 21109, sumarios: 25138, tbMicroisisImported: false },
      method: { warmups, repetitions: samples, pageSize: 25, measuredStages: ['parse', 'SQLite total', 'PostgreSQL COUNT', 'PostgreSQL result-page plus ranking', 'PostgreSQL total'] },
      results,
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`PROFILE=PASS; stage=${stage}; categories=${results.length}; output=${outputPath.split(/[\\/]/u).at(-1)}`);
  } finally {
    await postgres.close();
  }
}

main().catch((error) => { console.error(`PROFILE=FAIL; ${error.message}`); process.exitCode = 1; });
