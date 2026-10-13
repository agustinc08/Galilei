import { parseSearchQuery } from '../utils/search-parser';
import { LegacySqliteSearchAdapter } from './legacy-sqlite-search.adapter';
import { PostgresJurisprudenciaSearchAdapter } from './postgres-jurisprudencia-search.adapter';
import type { SearchContext } from './search-source.adapter';

const enabled = process.env.SEARCH_POSTGRES_TEST === '1' && Boolean(process.env.DATABASE_URL);
const postgresDescribe = enabled ? describe : describe.skip;
const legacyFixturePath = process.env.SEARCH_SPIKE_SQLITE_PATH;

const legacyContext = (overrides: Partial<SearchContext> = {}): SearchContext => ({
  visibility: 'INTERNAL',
  dialect: 'legacy-reference',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 300,
  ...overrides,
});

const modernContext = (overrides: Partial<SearchContext> = {}): SearchContext => ({
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 300,
  ...overrides,
});

postgresDescribe('PostgresJurisprudenciaSearchAdapter (isolated DEV integration)', () => {
  let postgres: PostgresJurisprudenciaSearchAdapter;
  let sqlite: LegacySqliteSearchAdapter;

  beforeAll(() => {
    if (!legacyFixturePath) throw new Error('SEARCH_SPIKE_SQLITE_PATH is required for parity tests.');
    postgres = new PostgresJurisprudenciaSearchAdapter(process.env.DATABASE_URL);
    sqlite = new LegacySqliteSearchAdapter(legacyFixturePath);
  });

  afterAll(async () => {
    await postgres?.close();
  });

  it('reproduces the legacy SQLite BJC-001 count on the same complete table universe', async () => {
    const query = parseSearchQuery('daño');
    const [pgResult, sqliteResult] = await Promise.all([
      postgres.search(query, legacyContext()),
      sqlite.search(query, legacyContext()),
    ]);
    expect(sqliteResult.total).toBe(2708);
    expect(pgResult.total).toBe(sqliteResult.total);
  });

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
      const result = await postgres.search(parseSearchQuery(query), modernContext({ pageSize: 5 }));
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.results.length).toBeLessThanOrEqual(5);
      for (let index = 1; index < result.results.length; index += 1) {
        expect(result.results[index - 1].score).toBeGreaterThanOrEqual(result.results[index].score);
      }
    }
    const noSuffixMatch = await postgres.search(parseSearchQuery('%accident'), modernContext({ pageSize: 5 }));
    expect(noSuffixMatch.total).toBe(0);
    expect(noSuffixMatch.results).toHaveLength(0);
    const suffixMatches = await postgres.search(parseSearchQuery('%civil'), modernContext({ pageSize: 5 }));
    expect(suffixMatches.total).toBeGreaterThan(0);
    expect(suffixMatches.results.length).toBeGreaterThan(0);
  });

  it('keeps full-text score constant only when every matching branch guarantees a positive literal', async () => {
    const positiveOnly = await postgres.search(
      parseSearchQuery('daño OR contrato'),
      modernContext({ pageSize: 25 }),
    );
    expect(positiveOnly.results.length).toBeGreaterThan(0);
    expect(positiveOnly.results.every((row) => row.scoreComponents?.fullText === 1)).toBe(true);

    const negativeAlternativeQuery = parseSearchQuery('daño OR NOT zzzxqv');
    const firstPage = await postgres.search(negativeAlternativeQuery, modernContext({ pageSize: 25 }));
    const laterPage = await postgres.search(negativeAlternativeQuery, modernContext({ page: 500, pageSize: 25 }));
    expect(firstPage.results.some((row) => row.scoreComponents?.fullText === 1)).toBe(true);
    expect(laterPage.results.some((row) => row.scoreComponents?.fullText === 0)).toBe(true);
  });

  it('binds hostile text as a parameter and returns score explanations', async () => {
    const result = await postgres.search(
      parseSearchQuery('"%\' OR 1=1 --"'),
      modernContext(),
    );
    expect(result.total).toBe(0);
    const ordinary = await postgres.search(parseSearchQuery('daño'), modernContext({ pageSize: 1 }));
    expect(ordinary.results[0]?.scoreComponents).toEqual(expect.objectContaining({
      identifierExact: expect.any(Number),
      phraseExact: expect.any(Number),
      fieldExact: expect.any(Number),
      fullText: expect.any(Number),
      trigram: expect.any(Number),
    }));
  });

  it('does not surface unpublished fixture records under the public publication policy', async () => {
    const result = await postgres.search(
      parseSearchQuery('daño'),
      modernContext({ publicationPolicy: 'published-active-only' }),
    );
    expect(result.total).toBe(0);
  });
});
