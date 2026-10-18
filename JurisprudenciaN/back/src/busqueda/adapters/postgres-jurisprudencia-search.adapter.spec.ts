import { existsSync } from 'node:fs';
import { parseSearchQuery } from '../utils/search-parser';
import { LegacySqliteSearchAdapter } from './legacy-sqlite-search.adapter';
import { PostgresJurisprudenciaSearchAdapter } from './postgres-jurisprudencia-search.adapter';
import type { SearchContext } from './search-source.adapter';

const enabled =
  process.env.SEARCH_POSTGRES_TEST === '1' && Boolean(process.env.DATABASE_URL);
const postgresDescribe = enabled ? describe : describe.skip;
const legacyFixturePath = process.env.SEARCH_SPIKE_SQLITE_PATH;
const hasLegacyFixture = Boolean(
  legacyFixturePath && existsSync(legacyFixturePath),
);
const legacyParityIt = hasLegacyFixture ? it : it.skip;

describe('PostgresJurisprudenciaSearchAdapter phrase candidate SQL', () => {
  it('materializes phrase text candidates before publication filtering and binds the phrase', async () => {
    const adapter = new PostgresJurisprudenciaSearchAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
      'set-algebra-v2',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [{ id: null, total: '0' }],
      rowCount: 1,
    } as never);
    try {
      await adapter.search(parseSearchQuery('"daño moral"'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 10,
      });
      const [sql, values] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain(
        '"candidateNode0" AS MATERIALIZED (\n        SELECT t."id" FROM "Sentencia" t',
      );
      expect(sql.indexOf('"candidateNode0" AS MATERIALIZED')).toBeLessThan(
        sql.indexOf('t."publicado" = TRUE'),
      );
      expect(sql).not.toContain('daño');
      expect(values).toContain('% daño moral %');
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      await adapter.close();
    }
  });

  it('uses direct parameterized AST predicates by default instead of materializing every leaf set', async () => {
    const adapter = new PostgresJurisprudenciaSearchAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('daño OR contrato'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        page: 1,
        pageSize: 10,
      });
      const [countSql, countValues] = query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(countSql).toContain('s."textoBusquedaNormalizado" LIKE $1');
      expect(countSql).toContain('t."textoBusquedaNormalizado" LIKE $2');
      expect(countSql).toContain(' OR ');
      expect(countSql).not.toContain('AS MATERIALIZED');
      expect(countSql).not.toContain('"searchCandidates"');
      expect(countValues).toEqual(['%daño%', '%contrato%']);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      await adapter.close();
    }
  });

  it('computes exact phrase totals and the result page from one materialized match set', async () => {
    const adapter = new PostgresJurisprudenciaSearchAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [{ id: null, total: '17' }],
      rowCount: 1,
    } as never);
    try {
      const result = await adapter.search(
        parseSearchQuery('"responsabilidad civil"'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          page: 1,
          pageSize: 10,
        },
      );
      const [sql, values] = query.mock.calls[0] as [string, unknown[]];
      expect(result.total).toBe(17);
      expect(result.totalExact).not.toBe(false);
      expect(sql).toContain('"matchedSumarios" AS MATERIALIZED');
      expect(sql).toContain('"totalCount" AS');
      expect(sql).toContain('"pageRows" AS');
      expect(sql).toContain('LEFT JOIN "pageRows" ON TRUE');
      expect(sql).not.toContain('responsabilidad civil');
      expect(values).toContain('% responsabilidad civil %');
      expect(query).toHaveBeenCalledTimes(1);
      expect(adapter.getLastSearchProfile()?.queryCount).toBe(1);
    } finally {
      await adapter.close();
    }
  });
});

const legacyContext = (
  overrides: Partial<SearchContext> = {},
): SearchContext => ({
  visibility: 'INTERNAL',
  dialect: 'legacy-reference',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 300,
  ...overrides,
});

const modernContext = (
  overrides: Partial<SearchContext> = {},
): SearchContext => ({
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 300,
  ...overrides,
});

postgresDescribe(
  'PostgresJurisprudenciaSearchAdapter (isolated DEV integration)',
  () => {
    let postgres: PostgresJurisprudenciaSearchAdapter;
    let sqlite: LegacySqliteSearchAdapter;

    beforeAll(() => {
      postgres = new PostgresJurisprudenciaSearchAdapter(
        process.env.DATABASE_URL,
      );
      if (hasLegacyFixture && legacyFixturePath) {
        sqlite = new LegacySqliteSearchAdapter(legacyFixturePath);
      }
    });

    afterAll(async () => {
      await postgres?.close();
    });

    legacyParityIt(
      'reproduces the legacy SQLite BJC-001 count on the same complete table universe when the historical reference DB is configured',
      async () => {
        const query = parseSearchQuery('daño');
        const [pgResult, sqliteResult] = await Promise.all([
          postgres.search(query, legacyContext()),
          sqlite.search(query, legacyContext()),
        ]);
        expect(sqliteResult.total).toBe(2708);
        expect(pgResult.total).toBe(sqliteResult.total);
      },
    );

    it('keeps case-insensitive accent handling for modern Spanish text', async () => {
      const [accented, plain, upper] = await Promise.all([
        postgres.search(parseSearchQuery('prescripción'), modernContext()),
        postgres.search(parseSearchQuery('prescripcion'), modernContext()),
        postgres.search(parseSearchQuery('PRESCRIPCIÓN'), modernContext()),
      ]);
      expect(accented.total).toBeGreaterThan(0);
      expect(plain.total).toBe(accented.total);
      expect(upper.total).toBe(accented.total);
    });

    it('keeps ñ distinct from n in a whitelisted party field', async () => {
      const [enye, ene] = await Promise.all([
        postgres.search(parseSearchQuery('actor:Peña'), modernContext()),
        postgres.search(parseSearchQuery('actor:Pena'), modernContext()),
      ]);
      expect(enye.total).toBeGreaterThan(0);
      expect(ene.total).toBeGreaterThan(0);
      const ids = new Set(ene.results.map((row) => row.sourceId));
      expect(enye.results.some((row) => ids.has(row.sourceId))).toBe(false);
    });

    it('executes phrase, boolean, prefix, suffix and NOT nodes through the shared AST', async () => {
      const queries = [
        '"daño moral"',
        'daño AND responsabilidad',
        'daño OR contrato',
        'accident%',
        '%accident',
        'daño NOT moral',
      ];
      for (const query of queries) {
        const result = await postgres.search(
          parseSearchQuery(query),
          modernContext({ pageSize: 5 }),
        );
        expect(result.total).toBeGreaterThanOrEqual(0);
        expect(result.results.length).toBeLessThanOrEqual(5);
        for (let index = 1; index < result.results.length; index += 1) {
          expect(result.results[index - 1].score).toBeGreaterThanOrEqual(
            result.results[index].score,
          );
        }
      }
      const noSuffixMatch = await postgres.search(
        parseSearchQuery('%accident'),
        modernContext({ pageSize: 5 }),
      );
      expect(noSuffixMatch.total).toBe(0);
      expect(noSuffixMatch.results).toHaveLength(0);
      const suffixMatches = await postgres.search(
        parseSearchQuery('%civil'),
        modernContext({ pageSize: 5 }),
      );
      expect(suffixMatches.total).toBeGreaterThan(0);
      expect(suffixMatches.results.length).toBeGreaterThan(0);
    });

    it('keeps full-text score constant only when every matching branch guarantees a positive literal', async () => {
      const positiveOnly = await postgres.search(
        parseSearchQuery('daño OR contrato'),
        modernContext({ pageSize: 25 }),
      );
      expect(positiveOnly.results.length).toBeGreaterThan(0);
      expect(
        positiveOnly.results.every(
          (row) => row.scoreComponents?.fullText === 1,
        ),
      ).toBe(true);

      const negativeAlternativeQuery = parseSearchQuery('daño OR NOT zzzxqv');
      const firstPage = await postgres.search(
        negativeAlternativeQuery,
        modernContext({ pageSize: 25 }),
      );
      const laterPage = await postgres.search(
        negativeAlternativeQuery,
        modernContext({ page: 500, pageSize: 25 }),
      );
      expect(
        firstPage.results.some((row) => row.scoreComponents?.fullText === 1),
      ).toBe(true);
      expect(
        laterPage.results.some((row) => row.scoreComponents?.fullText === 0),
      ).toBe(true);
    });

    it('binds hostile text as a parameter and returns score explanations', async () => {
      const result = await postgres.search(
        parseSearchQuery('"%\' OR 1=1 --"'),
        modernContext(),
      );
      expect(result.total).toBe(0);
      const ordinary = await postgres.search(
        parseSearchQuery('daño'),
        modernContext({ pageSize: 1 }),
      );
      const scoreComponents = ordinary.results[0]?.scoreComponents;
      expect(typeof scoreComponents?.identifierExact).toBe('number');
      expect(typeof scoreComponents?.phraseExact).toBe('number');
      expect(typeof scoreComponents?.fieldExact).toBe('number');
      expect(typeof scoreComponents?.fullText).toBe('number');
      expect(typeof scoreComponents?.trigram).toBe('number');
    });

    it('does not surface unpublished fixture records under the public publication policy', async () => {
      const result = await postgres.search(
        parseSearchQuery('daño'),
        modernContext({ publicationPolicy: 'published-active-only' }),
      );
      expect(result.total).toBe(0);
    });
  },
);
