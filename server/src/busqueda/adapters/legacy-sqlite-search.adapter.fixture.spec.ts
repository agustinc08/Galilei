import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { parseSearchQuery } from '../utils/search-parser';
import { LegacySqliteSearchAdapter } from './legacy-sqlite-search.adapter';
import type { SearchContext } from './search-source.adapter';

type FixtureSentence = {
  id: number;
  date: string;
  sala: string;
  actor: string;
  active?: number;
};

type FixtureSummary = {
  id: number;
  sentenceId: number;
  summary: string;
  topic: string;
  active?: number;
  published?: number;
};

type FixtureDatabase = { directory: string; path: string };

async function createFixtureDatabase(
  sentences: FixtureSentence[],
  summaries: FixtureSummary[],
): Promise<FixtureDatabase> {
  const directory = mkdtempSync(join(tmpdir(), 'galilei-sqlite-search-'));
  const path = join(directory, 'fixture.sqlite');
  const database = await open({ filename: path, driver: sqlite3.Database });

  try {
    await database.exec(`
      CREATE TABLE tb_sentencias (
        id_sentencia INTEGER PRIMARY KEY,
        fecha TEXT,
        sala TEXT,
        actor TEXT,
        demandado TEXT,
        tipo_fallo TEXT,
        tribunal_origen TEXT,
        nro_expte TEXT,
        objeto TEXT,
        magistrados TEXT,
        codigo_sentencia TEXT,
        activo INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE tb_sumarios (
        id_sumario INTEGER PRIMARY KEY,
        id_sentencia INTEGER NOT NULL,
        numero_sumario INTEGER,
        tema TEXT,
        resumen TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        publicado INTEGER NOT NULL DEFAULT 1
      );
    `);

    for (const sentence of sentences) {
      await database.run(
        `INSERT INTO tb_sentencias
          (id_sentencia, fecha, sala, actor, activo)
         VALUES (?, ?, ?, ?, ?)`,
        sentence.id,
        sentence.date,
        sentence.sala,
        sentence.actor,
        sentence.active ?? 1,
      );
    }

    for (const summary of summaries) {
      await database.run(
        `INSERT INTO tb_sumarios
          (id_sumario, id_sentencia, numero_sumario, tema, resumen, activo, publicado)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        summary.id,
        summary.sentenceId,
        summary.id,
        summary.topic,
        summary.summary,
        summary.active ?? 1,
        summary.published ?? 1,
      );
    }
  } finally {
    await database.close();
  }

  return { directory, path };
}

const sentences: FixtureSentence[] = [
  { id: 1, date: '2015-02-01', sala: 'A', actor: 'peña' },
  { id: 2, date: '2016-04-10', sala: 'B', actor: 'pena' },
  { id: 3, date: '2014-06-12', sala: 'A', actor: 'maria' },
  { id: 4, date: '2013-01-01', sala: 'A', actor: 'juan', active: 0 },
  { id: 5, date: '2012-01-01', sala: 'A', actor: 'ana' },
  { id: 6, date: '2017-01-01', sala: 'C', actor: 'luis' },
];

const summaries: FixtureSummary[] = [
  {
    id: 1,
    sentenceId: 1,
    summary: ' dano moral responsabilidad civil accidente prescripcion ',
    topic: 'Daños y perjuicios',
  },
  {
    id: 2,
    sentenceId: 2,
    summary: ' dano contractual contrato ',
    topic: 'Contratos',
  },
  {
    id: 3,
    sentenceId: 3,
    summary: ' dano procesal contrato civil ',
    topic: 'Proceso civil',
    published: 0,
  },
  {
    id: 4,
    sentenceId: 4,
    summary: ' dano moral ',
    topic: 'Responsabilidad civil',
  },
  {
    id: 5,
    sentenceId: 5,
    summary: ' dano inactivo ',
    topic: 'Responsabilidad civil',
    active: 0,
  },
  {
    id: 6,
    sentenceId: 6,
    summary: ' prescripcion responsabilidad ',
    topic: 'Prescripción',
  },
];

for (let index = 0; index < 301; index += 1) {
  const id = 100 + index;
  sentences.push({
    id,
    date: '2000-01-01',
    sala: 'Z',
    actor: `actor-${id}`,
  });
  summaries.push({
    id,
    sentenceId: id,
    summary: ' dano paginacion ',
    topic: 'Daños',
  });
}

const legacyContext = (
  overrides: Partial<SearchContext> = {},
): SearchContext => ({
  visibility: 'PUBLIC',
  dialect: 'legacy-reference',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 25,
  ...overrides,
});

const modernContext = (
  overrides: Partial<SearchContext> = {},
): SearchContext => ({
  ...legacyContext(),
  dialect: 'modern',
  ...overrides,
});

describe('LegacySqliteSearchAdapter with synthetic schema fixture', () => {
  let fixture: FixtureDatabase;
  let adapter: LegacySqliteSearchAdapter;

  beforeAll(async () => {
    fixture = await createFixtureDatabase(sentences, summaries);
    adapter = new LegacySqliteSearchAdapter(fixture.path);
  });

  afterAll(() => {
    if (fixture) rmSync(fixture.directory, { recursive: true, force: true });
  });

  it('reads an empty legacy schema without inventing matches', async () => {
    const empty = await createFixtureDatabase([], []);
    try {
      const result = await new LegacySqliteSearchAdapter(empty.path).search(
        parseSearchQuery('responsabilidad'),
        legacyContext(),
      );
      expect(result).toMatchObject({
        total: 0,
        results: [],
        page: 1,
        pageSize: 25,
      });
    } finally {
      rmSync(empty.directory, { recursive: true, force: true });
    }
  });

  it('excludes inactive sentences and summaries, and honors the publication policy', async () => {
    const legacy = await adapter.search(
      parseSearchQuery('dano'),
      legacyContext(),
    );
    const published = await adapter.search(
      parseSearchQuery('dano'),
      legacyContext({ publicationPolicy: 'published-active-only' }),
    );

    expect(legacy.total).toBe(304);
    expect(published.total).toBe(303);
    expect(legacy.results.map((item) => item.sourceId)).not.toContain('4');
    expect(legacy.results.map((item) => item.sourceId)).not.toContain('5');
    expect(published.results.map((item) => item.sourceId)).not.toContain('3');
  });

  it('separates total matches from the requested result window', async () => {
    const result = await adapter.search(
      parseSearchQuery('dano'),
      legacyContext({ pageSize: 20 }),
    );

    expect(result.total).toBe(304);
    expect(result.results).toHaveLength(20);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('normalizes accents and letter case for summary text', async () => {
    const accented = await adapter.search(
      parseSearchQuery('prescripción'),
      legacyContext(),
    );
    const plain = await adapter.search(
      parseSearchQuery('PRESCRIPCION'),
      legacyContext(),
    );

    expect(accented.total).toBe(2);
    expect(plain.total).toBe(accented.total);
  });

  it('keeps ñ distinct from n in a whitelisted party field', async () => {
    const enye = await adapter.search(
      parseSearchQuery('actor:Peña'),
      modernContext(),
    );
    const ene = await adapter.search(
      parseSearchQuery('actor:Pena'),
      modernContext(),
    );

    expect(enye.results.map((item) => item.sourceId)).toEqual(['1']);
    expect(ene.results.map((item) => item.sourceId)).toEqual(['2']);
  });

  it('matches a quoted phrase as a phrase rather than independent terms', async () => {
    const phrase = await adapter.search(
      parseSearchQuery('"dano moral"'),
      legacyContext(),
    );

    expect(phrase.total).toBe(1);
    expect(phrase.results[0]?.sourceId).toBe('1');
  });

  it('evaluates AND, OR, and NOT through the parsed search tree', async () => {
    const both = await adapter.search(
      parseSearchQuery('dano AND contrato'),
      legacyContext(),
    );
    const either = await adapter.search(
      parseSearchQuery('dano OR prescripcion'),
      legacyContext(),
    );
    const withoutMoral = await adapter.search(
      parseSearchQuery('dano NOT moral'),
      legacyContext(),
    );

    expect(both.results.map((item) => item.sourceId)).toContain('2');
    expect(either.total).toBeGreaterThan(both.total);
    expect(withoutMoral.results.map((item) => item.sourceId)).not.toContain(
      '1',
    );
  });

  it('supports token-prefix and token-suffix queries', async () => {
    const prefix = await adapter.search(
      parseSearchQuery('accident%'),
      legacyContext(),
    );
    const suffix = await adapter.search(
      parseSearchQuery('%civil'),
      legacyContext(),
    );

    expect(prefix.results.map((item) => item.sourceId)).toContain('1');
    expect(suffix.results.map((item) => item.sourceId)).toContain('1');
  });

  it('applies sala and inclusive/exclusive date filters', async () => {
    const result = await adapter.search(
      parseSearchQuery('dano'),
      legacyContext({
        filters: {
          sala: 'A',
          fechaDesde: '2015-01-01',
          fechaHastaExclusive: '2016-01-01',
        },
      }),
    );

    expect(result.total).toBe(1);
    expect(result.results[0]?.sourceId).toBe('1');
  });

  it('binds hostile input and clamps pagination while preserving descending date order', async () => {
    const hostile = await adapter.search(
      parseSearchQuery('"%' + "' OR 1=1 --" + '"'),
      legacyContext(),
    );
    const firstPage = await adapter.search(
      parseSearchQuery('dano'),
      legacyContext({ page: 1, pageSize: 500 }),
    );
    const secondPage = await adapter.search(
      parseSearchQuery('dano'),
      legacyContext({ page: 2, pageSize: 500 }),
    );

    expect(hostile.total).toBe(0);
    expect(firstPage.pageSize).toBe(300);
    expect(firstPage.results).toHaveLength(300);
    expect(secondPage.total).toBe(304);
    expect(secondPage.results).toHaveLength(4);
    for (let index = 1; index < firstPage.results.length; index += 1) {
      expect(
        String(firstPage.results[index - 1].date ?? '') >=
          String(firstPage.results[index].date ?? ''),
      ).toBe(true);
    }
  });
});
