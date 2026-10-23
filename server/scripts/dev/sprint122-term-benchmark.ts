import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { PostgresJurisprudenciaSearchAdapter } from '../../src/busqueda/adapters/postgres-jurisprudencia-search.adapter';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('Run through the DEV database guard.');
const context: SearchContext = {
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 25,
};
const cases = [
  { id: 'TERM_COMMON', query: 'daño' },
  { id: 'TERM_RARE', query: 'usucapión' },
  { id: 'ZERO', query: 'zzzxqv' },
  { id: 'SHORT', query: 'de' },
  { id: 'NUMERIC', query: '1113' },
];
const warmups = 2;
const repetitions = 10;

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0).toFixed(2));
}

function summary(values: number[]) {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: percentile(values, 1),
  };
}

async function main() {
  const oldExecutor = new PostgresJurisprudenciaSearchAdapter(DATABASE_URL, 'predicate-v1');
  const newExecutor = new PostgresJurisprudenciaSearchAdapter(DATABASE_URL, 'set-algebra-v2');
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const sample of cases) {
      const query = parseSearchQuery(sample.query);
      const oldIds = await oldExecutor.searchIds(query, context);
      const newIds = await newExecutor.searchIds(query, context);
      const oldSet = new Set(oldIds);
      const newSet = new Set(newIds);
      const oldPage = await oldExecutor.search(query, context);
      const newPage = await newExecutor.search(query, context);
      const oldOrder = oldPage.results.map((row) => row.sourceId);
      const newOrder = newPage.results.map((row) => row.sourceId);
      const missing = oldIds.filter((id) => !newSet.has(id));
      const extra = newIds.filter((id) => !oldSet.has(id));
      const orderDifferent = missing.length === 0 && extra.length === 0 && oldOrder.join('|') !== newOrder.join('|');
      const totalMs: number[] = [];
      const countMs: number[] = [];
      const resultPageMs: number[] = [];
      for (let index = 0; index < warmups + repetitions; index += 1) {
        const startedAt = performance.now();
        const page = await newExecutor.search(query, context);
        const elapsedMs = performance.now() - startedAt;
        if (index >= warmups) {
          totalMs.push(elapsedMs);
          const profile = newExecutor.getLastSearchProfile();
          if (profile) {
            countMs.push(profile.countMs);
            resultPageMs.push(profile.resultPageMs);
          }
          if (page.total !== newIds.length) throw new Error(`${sample.id}: total/searchIds mismatch`);
        }
      }
      results.push({
        id: sample.id,
        query: sample.query,
        countV1: oldIds.length,
        countV2: newIds.length,
        parity: missing.length === 0 && extra.length === 0 && !orderDifferent ? 'PASS' : 'DIFF',
        missing: missing.slice(0, 50),
        extra: extra.slice(0, 50),
        orderDifferent,
        oldFirstPage: oldOrder,
        newFirstPage: newOrder,
        warmups,
        repetitions,
        total: summary(totalMs),
        candidateAndCount: summary(countMs),
        rankingAndPage: summary(resultPageMs),
      });
      const last = results.at(-1)!;
      console.log(`TERM_PROFILE=${sample.id}; count=${newIds.length}; p50=${(last.total as ReturnType<typeof summary>).p50Ms}ms; parity=${last.parity}`);
    }
    const root = resolve(__dirname, '../../../');
    const outputDirectory = resolve(root, '_recovery-work/sprint122/term');
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = resolve(outputDirectory, 'term-benchmark.json');
    writeFileSync(outputPath, `${JSON.stringify({
      mission: 'Sprint 12.2 TERM gate',
      generatedAt: new Date().toISOString(),
      target: { host: '127.0.0.1', port: 55432, database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      baseline: { commonTermP50Ms: 6262, source: 'Sprint 12.1 benchmark' },
      candidateStrategy: 'AST leaves to materialized ID sets; INTERSECT/UNION/EXCEPT; exact LIKE semantics retained',
      warmups,
      repetitions,
      results,
    }, null, 2)}\n`, 'utf8');
    if (results.some((result) => result.parity !== 'PASS')) process.exitCode = 2;
    console.log(`TERM_BENCHMARK=${results.every((result) => result.parity === 'PASS') ? 'PASS' : 'PARITY_DIFF'}; output=${outputPath}`);
  } finally {
    await Promise.all([oldExecutor.close(), newExecutor.close()]);
  }
}

main().catch((error: unknown) => {
  console.error(`TERM_BENCHMARK=FAIL; ${(error as Error).message}`);
  process.exitCode = 1;
});
