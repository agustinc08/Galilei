import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';

const enabled = process.env.SPRINT155_POSTGRES_TEST === '1';
const fixedTimestamp = new Date('2020-01-01T00:00:00.000Z');
const alphabet = 'abcdefghijklmnopqrstuvwxyz';

function alphaCode(value: number) {
  let remaining = value;
  let result = '';
  for (let position = 0; position < 3; position += 1) {
    result = alphabet[remaining % alphabet.length] + result;
    remaining = Math.floor(remaining / alphabet.length);
  }
  return result;
}

const grammarDocuments = [
  {
    label: 'acción niño',
    text: 'zzspraccion acción zzsprniño niño zzsprresponsabilidad zzsprcivil responsabilidad civil zzspralpha primero',
  },
  {
    label: 'accion nino',
    text: 'zzspraccion accion zzsprnino nino zzsprresponsabilidad zzsprcivil responsabilidad civil zzsprbeta segundo',
  },
  {
    label: 'niño daño',
    text: 'zzsprniño niño zzsprdaño daño zzsprzero 0 zzspra a zzsprarticulo artículo 12345/2026',
  },
  {
    label: 'nino daños',
    text: 'zzsprnino nino zzsprdanos daños zzsprzero 0 zzspra a zzspradministrativo derecho',
  },
  {
    label: 'responsabilidad civil repeated',
    text: 'zzsprresponsabilidad zzsprcivil responsabilidad civil zzsprresponsabilidad responsabilidad',
  },
  {
    label: 'acción apelación',
    text: 'zzspraccion acción zzsprcivil civil zzsprnarrow apelación 2026 111',
  },
  {
    label: 'responsabilidad penal',
    text: 'zzsprresponsabilidad responsabilidad zzsprpenal penal zzspraudiencia audiencia',
  },
  {
    label: 'OCR text',
    text: 'zzsprocr zzsprreconocido texto reconocido automáticamente',
  },
  {
    label: 'phrase native',
    text: 'zzsprphrase zzsprresponsabilidad zzsprcivil responsabilidad civil',
  },
  {
    label: 'punctuated phrase',
    text: 'zzsprpunct zzsprresponsabilidad responsabilidad, civil',
  },
  {
    label: 'line break phrase',
    text: 'zzsprline zzsprlinebreak line\nbreak phrase target',
  },
  {
    label: 'case and numeric identifiers',
    text: 'zzsprcase zzsprciv12345 CIV 12345/2026 Sala H artículo 1 111 2026',
  },
] as const;

type GoldenQueryCase = {
  id: string;
  query: string;
  expectedDocumentIds: string[];
  forbiddenDocumentIds: string[];
  expectedOrdering: string[];
  notes: string;
};

function buildGoldenQueryCases(documentIds: string[]): GoldenQueryCase[] {
  const cases: GoldenQueryCase[] = [];
  const add = (
    id: string,
    query: string,
    expected: number[],
    notes: string,
  ) => {
    const expectedDocumentIds = expected
      .map((index) => documentIds[index])
      .sort();
    cases.push({
      id,
      query,
      expectedDocumentIds,
      forbiddenDocumentIds: documentIds.filter(
        (documentId) => !expectedDocumentIds.includes(documentId),
      ),
      expectedOrdering: expectedDocumentIds,
      notes,
    });
  };

  for (let index = 0; index < 300; index += 1) {
    const token = `zzsprintgoldtoken${alphaCode(index)}`;
    const expected = documentIds
      .map((_, documentIndex) => documentIndex)
      .filter(
        (documentIndex) =>
          (index * 7 + documentIndex * 5) % 12 < 1 + (index % 5),
      );
    add(
      `G-${String(index + 1).padStart(3, '0')}`,
      token,
      expected,
      'Unique synthetic TERM token; exact generated set.',
    );
  }

  add(
    'C-TERM',
    'zzsprresponsabilidad',
    [0, 1, 4, 6, 8, 9],
    'TERM has exact synthetic result set.',
  );
  add(
    'C-CASE',
    'ZZSPRRESPONSABILIDAD',
    [0, 1, 4, 6, 8, 9],
    'Case insensitive.',
  );
  add('C-ACCENT', 'zzspracción', [0, 1, 5], 'Vowel accent folding.');
  add(
    'C-ACCENT-FOLDED',
    'zzspraccion',
    [0, 1, 5],
    'Unaccented query equals accented query.',
  );
  add('C-ENYE', 'zzsprniño', [0, 2], 'Ñ remains distinct from n.');
  add('C-N', 'zzsprnino', [1, 3], 'N is not folded to ñ.');
  add('C-AND', 'zzspraccion * zzsprcivil', [0, 1, 5], 'AND intersection.');
  add(
    'C-OR',
    'zzspraccion + zzsprpenal',
    [0, 1, 5, 6],
    'OR union without duplicate IDs.',
  );
  add(
    'C-NOT',
    'zzsprresponsabilidad - zzsprpenal',
    [0, 1, 4, 8, 9],
    'Exclusion removes matching penal record.',
  );
  add(
    'C-PRECEDENCE',
    'zzspraccion + zzsprresponsabilidad * zzsprpenal',
    [0, 1, 5, 6],
    'NOT > AND > OR contract; AND binds before OR.',
  );
  add(
    'C-PARENS',
    '(zzspraccion + zzsprresponsabilidad) * zzsprpenal',
    [6],
    'Parentheses override precedence.',
  );
  add(
    'C-PHRASE',
    '"zzsprresponsabilidad zzsprcivil"',
    [0, 1, 4, 8],
    'Adjacent phrase excludes inserted punctuation.',
  );
  add(
    'C-PHRASE-LINE',
    '"zzsprlinebreak line break"',
    [10],
    'Whitespace normalization keeps a line break searchable.',
  );
  add(
    'C-PREFIX',
    'zzsprrespons%',
    [0, 1, 4, 6, 8, 9],
    'Prefix searches a token start.',
  );
  add(
    'C-SUFFIX',
    '%zzsprresponsabilidad',
    [0, 1, 4, 6, 8, 9],
    'Suffix searches a token end.',
  );
  add(
    'C-NUMBER',
    'zzsprciv12345',
    [11],
    'Numeric and case identifier text is searchable.',
  );
  add(
    'C-REPEAT-AND',
    'zzspraccion * zzspraccion',
    [0, 1, 5],
    'Repeated AND term never duplicates result IDs.',
  );
  add(
    'C-REPEAT-OR',
    'zzspraccion + zzspraccion',
    [0, 1, 5],
    'Repeated OR term never duplicates result IDs.',
  );
  add(
    'C-WS',
    '  zzsprresponsabilidad\t ',
    [0, 1, 4, 6, 8, 9],
    'Leading, trailing, and tab whitespace normalization.',
  );

  return cases;
}

describe('Sprint 15.5 Search golden PostgreSQL certification', () => {
  const prisma = new PrismaService();
  let source: CorpusSearchSourceAdapter | undefined;
  const documentIds: string[] = [];
  const runSuffix = `${Date.now()}_${process.pid}`;
  const ids = grammarDocuments.map(
    (_, index) => `s155g_${runSuffix}_${String(index).padStart(3, '0')}`,
  );
  const paginationIds = Array.from(
    { length: 325 },
    (_, index) => `s155p_${runSuffix}_${String(index).padStart(3, '0')}`,
  );

  beforeAll(async () => {
    if (!enabled) return;
    await prisma.$connect();
    source = new CorpusSearchSourceAdapter();
    const goldenTokensByDocument = ids.map(() => [] as string[]);
    for (let tokenIndex = 0; tokenIndex < 300; tokenIndex += 1) {
      const token = `zzsprintgoldtoken${alphaCode(tokenIndex)}`;
      for (
        let documentIndex = 0;
        documentIndex < ids.length;
        documentIndex += 1
      ) {
        if ((tokenIndex * 7 + documentIndex * 5) % 12 < 1 + (tokenIndex % 5)) {
          goldenTokensByDocument[documentIndex].push(token);
        }
      }
    }

    const data = [
      ...grammarDocuments.map((document, index) => ({
        id: ids[index],
        title: `Synthetic Sprint 15.5 ${document.label}`,
        documentType: 'SPRINT155_SYNTHETIC',
        jurisdiction: 'CIVIL',
        visibility: 'INTERNAL',
        documentScope: 'GENERAL' as const,
        status: 'INDEXED',
        searchText: normalizeSearchText(
          document.text,
          ...goldenTokensByDocument[index],
        ),
        decisionDate: null,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      })),
      ...paginationIds.map((id, index) => ({
        id,
        title: `Synthetic Sprint 15.5 pagination ${index}`,
        documentType: 'SPRINT155_SYNTHETIC',
        jurisdiction: 'CIVIL',
        visibility: 'INTERNAL',
        documentScope: 'GENERAL' as const,
        status: 'INDEXED',
        searchText: `zzsprpagination stable synthetic result ${String(index).padStart(3, '0')}`,
        decisionDate: null,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      })),
    ];
    documentIds.push(...data.map((row) => row.id));
    await prisma.corpusDocument.createMany({ data });
  });

  afterAll(async () => {
    if (source) await source.close();
    if (documentIds.length) {
      await prisma.corpusDocument.deleteMany({
        where: { id: { in: documentIds } },
      });
    }
    await prisma.$disconnect();
  });

  (enabled ? it : it.skip)(
    'passes 300 exact synthetic queries and fully traverses 325 paginated hits',
    async () => {
      if (!source) throw new Error('SPRINT155_SEARCH_SOURCE_NOT_INITIALIZED');
      const cases = buildGoldenQueryCases(ids);
      const results: Array<Record<string, unknown>> = [];
      const failures: Array<Record<string, unknown>> = [];
      const queryTimings: number[] = [];

      for (const testCase of cases) {
        const startedAt = performance.now();
        let result: Awaited<ReturnType<CorpusSearchSourceAdapter['search']>>;
        try {
          result = await source.search(parseSearchQuery(testCase.query), {
            visibility: 'INTERNAL',
            dialect: 'modern',
            publicationPolicy: 'published-active-only',
            page: 1,
            pageSize: 100,
            sourceSystems: ['CORPUS'],
          });
        } catch (error) {
          console.error(
            `SPRINT155_GOLDEN_QUERY_FAILURE=${JSON.stringify({ id: testCase.id, query: testCase.query })}`,
          );
          throw error;
        }
        const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
        queryTimings.push(elapsedMs);
        const actualIds = result.results.map((row) => row.sourceId).sort();
        const orderedIds = result.results.map((row) => row.sourceId);
        const passed =
          JSON.stringify(actualIds) ===
            JSON.stringify(testCase.expectedDocumentIds) &&
          JSON.stringify(orderedIds) ===
            JSON.stringify(testCase.expectedOrdering) &&
          result.total === testCase.expectedDocumentIds.length &&
          result.totalExact === true;
        const record = {
          id: testCase.id,
          query: testCase.query,
          expectedDocumentIds: testCase.expectedDocumentIds,
          forbiddenDocumentIds: testCase.forbiddenDocumentIds,
          actualDocumentIds: actualIds,
          actualOrdering: orderedIds,
          expectedTotal: testCase.expectedDocumentIds.length,
          actualTotal: result.total,
          totalExact: result.totalExact ?? null,
          elapsedMs,
          passed,
          notes: testCase.notes,
        };
        results.push(record);
        if (!passed) failures.push(record);
      }

      const artifactRoot = path.resolve(
        process.cwd(),
        '../_recovery-work/sprint155',
      );
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(
        path.join(artifactRoot, 'golden-suite-results.json'),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            suite: 'Sprint 15.5 Search PostgreSQL golden suite',
            deterministicQueryCount: 300,
            totalCaseCount: cases.length,
            passed: results.filter((row) => row.passed).length,
            failed: failures.length,
            failures,
            queryTimingsMs: {
              p50: percentile(queryTimings, 0.5),
              p95: percentile(queryTimings, 0.95),
              max: Math.max(...queryTimings),
            },
            cases: results,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      expect(new Set(cases.map((testCase) => testCase.query)).size).toBe(
        300 + 19,
      );
      expect(failures).toEqual([]);
      expect(results.filter((row) => row.passed)).toHaveLength(300 + 19);

      const paginationQuery = parseSearchQuery('zzsprpagination');
      const first = await source.search(paginationQuery, {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 100,
        sourceSystems: ['CORPUS'],
      });
      const pages = [first];
      for (const page of [2, 3, 4]) {
        pages.push(
          await source.search(paginationQuery, {
            visibility: 'INTERNAL',
            dialect: 'modern',
            publicationPolicy: 'published-active-only',
            page,
            pageSize: 100,
            sourceSystems: ['CORPUS'],
          }),
        );
      }
      const outOfRange = await source.search(paginationQuery, {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 5,
        pageSize: 100,
        sourceSystems: ['CORPUS'],
      });
      const pageIds = pages.flatMap((page) =>
        page.results.map((row) => row.sourceId),
      );
      const expectedPaginationIds = [...paginationIds].sort();
      const pagination = {
        datasetHits: paginationIds.length,
        pageSize: 100,
        pages: pages.map((page) => ({
          page: page.page,
          total: page.total,
          totalExact: page.totalExact ?? null,
          returned: page.results.length,
          firstId: page.results[0]?.sourceId ?? null,
          lastId: page.results.at(-1)?.sourceId ?? null,
        })),
        expectedIds: expectedPaginationIds,
        returnedUnion: pageIds,
        duplicates: pageIds.length - new Set(pageIds).size,
        missing: expectedPaginationIds.filter((id) => !pageIds.includes(id)),
        stableOrdering:
          JSON.stringify(pageIds) === JSON.stringify(expectedPaginationIds),
        outOfRange: {
          page: outOfRange.page,
          returned: outOfRange.results.length,
          total: outOfRange.total,
          totalExact: outOfRange.totalExact ?? null,
        },
      };
      await writeFile(
        path.join(artifactRoot, 'pagination.json'),
        `${JSON.stringify(pagination, null, 2)}\n`,
        'utf8',
      );
      expect(pageIds).toEqual(expectedPaginationIds);
      expect(pagination.duplicates).toBe(0);
      expect(pagination.missing).toEqual([]);
      expect(
        pages.map((page) => [page.total, page.totalExact, page.hasMore]),
      ).toEqual([
        [101, false, true],
        [201, false, true],
        [301, false, true],
        [325, true, false],
      ]);
      expect(outOfRange.results).toEqual([]);
      expect(outOfRange.total).toBe(325);
      expect(outOfRange.totalExact).toBe(true);
    },
  );
});

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)
  ];
}
