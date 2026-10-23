import { performance } from 'node:perf_hooks';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { PostgresJurisprudenciaSearchAdapter } from '../../src/busqueda/adapters/postgres-jurisprudencia-search.adapter';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Run through DEV DB guard.');
  const adapter = new PostgresJurisprudenciaSearchAdapter(process.env.DATABASE_URL);
  const query = parseSearchQuery('numeroSentencia:1113');
  const context = { visibility: 'INTERNAL' as const, dialect: 'modern' as const, publicationPolicy: 'published-active-only' as const, page: 1, pageSize: 20 };
  const timings: number[] = [];
  try {
    await adapter.search(query, context);
    for (let index = 0; index < 3; index++) {
      const started = performance.now();
      const result = await adapter.search(query, context);
      timings.push(performance.now() - started);
      if (result.total < 0) throw new Error('Invalid result count.');
    }
    timings.sort((a, b) => a - b);
    console.log(`SEARCH_SMOKE=PASS; query=numeroSentencia:1113; samples=${timings.length}; p50Ms=${timings[1].toFixed(2)}; p95Ms=${timings[2].toFixed(2)}`);
  } finally {
    await adapter.close();
  }
}

main().catch((error) => { console.error(`SEARCH_SMOKE=FAIL; ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
