import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSearchQuery } from '../utils/search-parser';
import { LegacySqliteSearchAdapter } from './legacy-sqlite-search.adapter';
import type { SearchContext } from './search-source.adapter';

type BenchmarkCase = {
  id: string;
  query: string;
  legacyMeasurement: {
    status: string;
    matches?: number;
    topIdsByDate?: Array<{ sumarioId: number; sentenciaId: number }>;
    legacyComparisonQuery?: string;
    filters?: {
      sala?: string;
      fechaDesde?: string;
      fechaHastaExclusive?: string;
    };
  };
};

const databasePath = process.env.SEARCH_SPIKE_SQLITE_PATH;
const hasLegacyFixture = Boolean(databasePath && existsSync(databasePath));
const benchmarkPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/integracion/benchmark-busqueda.json',
);
const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as {
  cases: BenchmarkCase[];
};
const measuredCases = benchmark.cases.filter(
  (testCase) => testCase.legacyMeasurement.status === 'measured_legacy_sqlite',
);

const legacyContext = (testCase: BenchmarkCase): SearchContext => ({
  visibility: 'PUBLIC',
  dialect: 'legacy-reference',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 300,
  filters: {
    sala: testCase.legacyMeasurement.filters?.sala,
    fechaDesde: testCase.legacyMeasurement.filters?.fechaDesde,
    fechaHastaExclusive:
      testCase.legacyMeasurement.filters?.fechaHastaExclusive,
  },
});

const queryForBenchmarkCase = (testCase: BenchmarkCase) => {
  if (testCase.id === 'BJC-031' || testCase.id === 'BJC-032') return 'daño';
  return testCase.legacyMeasurement.legacyComparisonQuery ?? testCase.query;
};

const sqliteDescribe = hasLegacyFixture ? describe : describe.skip;

sqliteDescribe(
  'LegacySqliteSearchAdapter (opt-in, immutable reference fixture)',
  () => {
    const createAdapter = () => {
      if (!databasePath || !hasLegacyFixture) {
        throw new Error('SEARCH_SPIKE_SQLITE_FIXTURE_REQUIRED');
      }
      return new LegacySqliteSearchAdapter(databasePath);
    };

    it('reproduces all legacy SQLite counts recorded as measured in the benchmark', async () => {
      const adapter = createAdapter();
      for (const testCase of measuredCases) {
        const result = await adapter.search(
          parseSearchQuery(queryForBenchmarkCase(testCase)),
          legacyContext(testCase),
        );
        expect({ id: testCase.id, total: result.total }).toEqual({
          id: testCase.id,
          total: testCase.legacyMeasurement.matches,
        });

        const expectedTop = testCase.legacyMeasurement.topIdsByDate ?? [];
        if (expectedTop.length) {
          const actualTop = result.results.slice(0, expectedTop.length);
          const rowsById = new Map(
            result.results.map((item) => [item.sourceId, item]),
          );
          const expectedRows = expectedTop.map((item) =>
            rowsById.get(String(item.sumarioId)),
          );
          expect(expectedRows.every(Boolean)).toBe(true);
          expect(
            actualTop.every(
              (item, index) =>
                index === 0 ||
                String(actualTop[index - 1].date ?? '') >=
                  String(item.date ?? ''),
            ),
          ).toBe(true);
          expect(expectedRows.map((item) => item?.date).sort()).toEqual(
            actualTop.map((item) => item.date).sort(),
          );
        }
      }
    }, 120_000);

    it('separates total matches from the paged result window', async () => {
      const adapter = createAdapter();
      const result = await adapter.search(
        parseSearchQuery('daño'),
        legacyContext(measuredCases[0]),
      );
      expect(result.total).toBe(2708);
      expect(result.results).toHaveLength(300);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(300);
    });

    it('binds literal input instead of treating it as SQL or a LIKE pattern', async () => {
      const adapter = createAdapter();
      const result = await adapter.search(
        parseSearchQuery('"%\' OR 1=1 --"'),
        legacyContext(measuredCases[0]),
      );
      expect(result.total).toBe(0);
    });
  },
);
