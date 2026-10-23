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
const allCases = [
  { family: 'PHRASE', query: '"daño moral"' },
  { family: 'PHRASE', query: '"responsabilidad civil"' },
  { family: 'AND', query: 'daño AND responsabilidad' },
  { family: 'OR', query: 'daño OR contrato' },
  { family: 'NOT', query: 'daño NOT moral' },
  { family: 'NOT_PURE', query: 'NOT zzzxqv' },
  { family: 'BOOLEAN_COMPLEX', query: 'daño OR moral AND accidente' },
  { family: 'FIELD', query: 'tema:daños' },
  { family: 'PREFIX', query: 'accident%' },
  { family: 'SUFFIX', query: '%civil' },
  { family: 'IDENTIFIER', query: 'numeroSentencia:1113' },
];
const familyArg = process.argv.find((argument) => argument.startsWith('--family='))?.split('=')[1]?.toUpperCase();
const cases = familyArg ? allCases.filter((sample) => sample.family === familyArg) : allCases;
if (familyArg && cases.length === 0) throw new Error(`Unknown semantic parity family: ${familyArg}`);
const warmups = 2;
const repetitions = 10;

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => Number((sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0).toFixed(2));
  return { p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}

async function main() {
  const oldExecutor = new PostgresJurisprudenciaSearchAdapter(DATABASE_URL, 'predicate-v1');
  const newExecutor = new PostgresJurisprudenciaSearchAdapter(DATABASE_URL, 'set-algebra-v2');
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const sample of cases) {
      const query = parseSearchQuery(sample.query);
      let oldIds: string[] = [];
      let oldPageIds: string[] = [];
      let oldError: string | null = null;
      try {
        oldIds = await oldExecutor.searchIds(query, context);
        oldPageIds = (await oldExecutor.search(query, context)).results.map((row) => row.sourceId);
      } catch (error) {
        oldError = (error as { code?: string }).code ?? (error as Error).message;
      }
      const newIds = await newExecutor.searchIds(query, context);
      const newPage = await newExecutor.search(query, context);
      const oldSet = new Set(oldIds);
      const newSet = new Set(newIds);
      const missing = oldError ? [] : oldIds.filter((id) => !newSet.has(id));
      const extra = oldError ? [] : newIds.filter((id) => !oldSet.has(id));
      const orderDifferent = !oldError && missing.length === 0 && extra.length === 0 && oldPageIds.join('|') !== newPage.results.map((row) => row.sourceId).join('|');
      const durations: number[] = [];
      const countDurations: number[] = [];
      const pageDurations: number[] = [];
      for (let index = 0; index < warmups + repetitions; index += 1) {
        const startedAt = performance.now();
        await newExecutor.search(query, context);
        if (index >= warmups) {
          durations.push(performance.now() - startedAt);
          const profile = newExecutor.getLastSearchProfile();
          if (profile) {
            countDurations.push(profile.countMs);
            pageDurations.push(profile.resultPageMs);
          }
        }
      }
      const parity = oldError ? 'OLD_EXECUTOR_ERROR' : missing.length || extra.length ? 'ID_DIFF' : orderDifferent ? 'ORDER_DIFF' : 'PASS';
      results.push({
        family: sample.family,
        query: sample.query,
        oldTotal: oldError ? null : oldIds.length,
        newTotal: newIds.length,
        parity,
        oldError,
        missing: missing.slice(0, 100),
        extra: extra.slice(0, 100),
        sameFirstPageOrder: !orderDifferent && !oldError,
        oldFirstPage: oldPageIds,
        newFirstPage: newPage.results.map((row) => row.sourceId),
        warmups,
        repetitions,
        total: stats(durations),
        candidateAndCount: stats(countDurations),
        rankingAndPage: stats(pageDurations),
      });
      console.log(`SEMANTIC=${sample.family}; query=${sample.query}; count=${newIds.length}; p50=${stats(durations).p50Ms}ms; parity=${parity}`);
    }
    const root = resolve(__dirname, '../../../');
    const outputDirectory = resolve(root, '_recovery-work/sprint122/semantic');
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = resolve(outputDirectory, familyArg ? `${familyArg.toLowerCase()}-parity.json` : 'extended-parity.json');
    writeFileSync(outputPath, `${JSON.stringify({
      mission: familyArg ? `Sprint 12.2 ${familyArg} semantic parity` : 'Sprint 12.2 extended semantic parity',
      generatedAt: new Date().toISOString(),
      target: { host: '127.0.0.1', port: 55432, database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      oldExecutor: 'predicate-v1 modern AST WHERE expression',
      newExecutor: 'set-algebra-v2 candidate IDs, boolean set operations, then page/rank',
      warmups,
      repetitions,
      resultCount: results.length,
      passed: results.filter((item) => item.parity === 'PASS').length,
      results,
    }, null, 2)}\n`, 'utf8');
    const failed = results.some((item) => item.parity !== 'PASS');
    console.log(`EXTENDED_PARITY=${failed ? 'DIFF' : 'PASS'}; cases=${results.length}; output=${outputPath}`);
    if (failed) process.exitCode = 2;
  } finally {
    await Promise.all([oldExecutor.close(), newExecutor.close()]);
  }
}

main().catch((error: unknown) => {
  console.error(`EXTENDED_PARITY=FAIL; ${(error as Error).message}`);
  process.exitCode = 1;
});
