import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const adapter = new CorpusSearchSourceAdapter(raw);
  try {
    const cases = [
      { family: 'TERM_COMMON', query: 'responsabilidad' },
      { family: 'TERM_RARE', query: 'Rondinella' },
      { family: 'ZERO', query: 'zzqvnoresult2026sprint12' },
      { family: 'SHORT', query: 'de' },
      { family: 'NUMERIC', query: '1113' },
      { family: 'PHRASE', query: '"responsabilidad civil"' },
      { family: 'AND', query: 'responsabilidad AND contrato' },
      { family: 'OR', query: 'responsabilidad OR contrato' },
      { family: 'NOT', query: 'responsabilidad NOT mediacion' },
      { family: 'COMPLEX', query: '(responsabilidad OR contrato) AND NOT mediacion' },
      { family: 'FIELD', query: 'tema:responsabilidad' },
      { family: 'PREFIX', query: 'responsabilid%' },
      { family: 'SUFFIX', query: '%civil' },
      { family: 'IDENTIFIER', query: 'expediente:0000000' },
    ];
    const measuredRequests = 5;
    const caseReports: Record<string, unknown> = {};
    let failedRequests = 0;
    for (const sample of cases) {
      const durations: number[] = [];
      const profiles: Array<ReturnType<typeof adapter.getLastSearchProfile>> = [];
      const outcomes: Array<{ total: number | null; totalExact: boolean | null; hasMore: boolean | null; resultCount: number | null }> = [];
      for (let i = 0; i <= measuredRequests; i += 1) {
        const start = performance.now();
        let result: Awaited<ReturnType<typeof adapter.search>> | null = null;
        try {
          result = await adapter.search(parseSearchQuery(sample.query), {
            visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
            page: 1, pageSize: 10, sourceSystems: ['CORPUS'],
          });
        } catch {
          failedRequests += i === 0 ? 0 : 1;
        }
        const durationMs = Math.round((performance.now() - start) * 100) / 100;
        if (i > 0) {
          durations.push(durationMs);
          profiles.push(adapter.getLastSearchProfile());
          outcomes.push(result ? { total: result.total, totalExact: result.totalExact ?? null, hasMore: result.hasMore ?? null, resultCount: result.results.length } : { total: null, totalExact: null, hasMore: null, resultCount: null });
        }
      }
      const sorted = [...durations].sort((a, b) => a - b);
      const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
      caseReports[sample.family] = {
        measuredRequests,
        failedRequests: outcomes.filter((item) => item.total === null).length,
        latencyMs: { min: sorted[0], p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) },
        outcomes,
        profiles,
      };
      console.log(JSON.stringify({ family: sample.family, failedRequests: outcomes.filter((item) => item.total === null).length, p50Ms: percentile(0.5) }));
    }
    const sortedAll = Object.values(caseReports).flatMap((report) => {
      const item = report as { latencyMs: { p50: number } };
      return [item.latencyMs.p50];
    }).sort((a, b) => a - b);
    const report = {
      status: failedRequests === 0
        ? `${process.env.BJC_SPRINT122 === 'true' ? 'SPRINT122' : 'SPRINT121'}_CORPUS_ADAPTER_BENCHMARK_PASS`
        : `${process.env.BJC_SPRINT122 === 'true' ? 'SPRINT122' : 'SPRINT121'}_CORPUS_ADAPTER_BENCHMARK_WITH_QUERY_ERRORS`,
      generatedAt: new Date().toISOString(),
      target: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      warmupRequests: 1,
      measuredRequestsPerFamily: measuredRequests,
      families: cases.length,
      failedRequests,
      queryTextPersisted: false,
      latencyMs: { medianFamilyP50: sortedAll[Math.floor(sortedAll.length / 2)] },
      cases: caseReports,
    };
    const destination = resolve(process.cwd(), '..', '_recovery-work', process.env.BJC_SPRINT122 === 'true' ? 'sprint122' : 'sprint121', 'performance');
    await mkdir(destination, { recursive: true });
    await writeFile(resolve(destination, 'corpus-adapter.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await adapter.close();
  }
}

main().catch((error) => {
  const reason = (error as Error)?.message ?? '';
  console.error(reason.startsWith('DEV_DATABASE_') ? reason : JSON.stringify({ status: 'SPRINT121_CORPUS_ADAPTER_BENCHMARK_FAILED', name: (error as Error)?.name ?? 'Error', code: (error as { code?: string })?.code ?? 'unknown' }));
  process.exitCode = 1;
});
