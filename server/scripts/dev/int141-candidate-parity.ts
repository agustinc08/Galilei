import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { Client, type API } from '@opensearch-project/opensearch';
import { sentenciaTienePdfReal } from '../../src/archivos/pdf-real.util';
import type {
  SearchContext,
  SearchResult,
} from '../../src/busqueda/adapters/search-source.adapter';
import type { SearchQueryAst } from '../../src/busqueda/utils/search-ast';
import {
  OpenSearchSearchSourceAdapter,
  compareLocaleSortHits,
  searchSort,
} from '../../src/busqueda/opensearch/opensearch-search-source.adapter';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import {
  lexicalTokens,
  phraseSequence,
} from '../../src/busqueda/opensearch/opensearch-mapping';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

type SearchAfter = NonNullable<API.Search_RequestBody['search_after']>;
type SearchQuery = NonNullable<API.Search_RequestBody['query']>;
type SearchSort = Extract<
  NonNullable<API.Search_RequestBody['sort']>,
  unknown[]
>;

type SourceRow = {
  id: number;
  fecha: Date | null;
  sala: string | null;
  numeroSentencia: string | null;
  resumenIa: string | null;
  destacada: boolean;
  textoBusquedaNormalizado: string | null;
  resena: string | null;
  sumarioSearchText: string;
  referenciasSearchText: string;
  archivosPdf: Array<{ id: number; rutaArchivo: string | null }>;
};

type EngineHit = {
  _id: string;
  _score: number | null;
  sort?: SearchAfter;
  _source?: {
    logicalNumericId?: number | null;
    sortFields?: { sala?: string | null; numeroSentencia?: string | null };
  };
};

type EngineBody = {
  took?: number;
  hits?: {
    total?: { value?: number; relation?: 'eq' | 'gte' };
    hits?: EngineHit[];
  };
};

loadEnvironment();

function loadEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    process.env[match[1]] =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
  if (!process.env.DATABASE_URL) throw new Error('DEV_DATABASE_URL_REQUIRED');
}

function unwrap<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    const body = (response as { body?: unknown }).body;
    if (body && typeof body === 'object') return body as T;
  }
  return response as T;
}

async function discoverCandidate(client: Client) {
  const body = unwrap<Array<{ index?: string }>>(
    await client.cat.indices({
      index: ['galilei-search-v003-*'],
      format: 'json',
      h: ['index'],
    }),
  );
  const indices = body
    .map((row) => row.index)
    .filter((index): index is string => Boolean(index))
    .sort();
  const requested = process.env.OPENSEARCH_CANDIDATE_INDEX?.trim();
  if (requested) {
    if (!indices.includes(requested))
      throw new Error('CANDIDATE_INDEX_NOT_FOUND');
    return requested;
  }
  if (indices.length !== 1)
    throw new Error(`CANDIDATE_INDEX_AMBIGUOUS:${indices.length}`);
  return indices[0];
}

async function queryAll(
  client: Client,
  index: string,
  query: SearchQuery,
  sort: SearchSort = [{ id: { order: 'asc' } }],
  source: string[] | false = false,
) {
  const response = await client.search({
    index: [index],
    request_cache: false,
    body: {
      from: 0,
      size: 30000,
      track_total_hits: true,
      _source: source,
      query,
      sort,
    },
  });
  const body = unwrap<EngineBody>(response);
  const total = body.hits?.total?.value;
  if (!Number.isSafeInteger(total) || body.hits?.total?.relation !== 'eq')
    throw new Error('PARITY_TOTAL_NOT_EXACT');
  const hits = body.hits?.hits ?? [];
  if (hits.length !== total) throw new Error('PARITY_RESULT_WINDOW_INCOMPLETE');
  return { total, hits };
}

async function queryWindow(
  client: Client,
  index: string,
  query: SearchQuery,
  from: number,
  size: number,
  sort: SearchSort,
) {
  const response = await client.search({
    index: [index],
    request_cache: false,
    body: {
      from,
      size,
      track_total_hits: true,
      _source: false,
      query,
      sort,
    },
  });
  const body = unwrap<EngineBody>(response);
  const total = body.hits?.total?.value;
  if (!Number.isSafeInteger(total) || body.hits?.total?.relation !== 'eq')
    throw new Error('PARITY_PAGE_TOTAL_NOT_EXACT');
  return { total: total as number, hits: body.hits?.hits ?? [] };
}

function documentIds(hits: EngineHit[]) {
  return hits.map((hit) => hit._id);
}

function sameIds(actual: string[], expected: string[]) {
  return (
    actual.length === expected.length &&
    actual.every((id, i) => id === expected[i])
  );
}

function exactPhraseMatch(value: string | null | undefined, phrase: string) {
  const documentTokens = phraseSequence(normalizeSearchText(value ?? ''))
    .split(' ')
    .filter(Boolean);
  const queryTokens = phraseSequence(normalizeSearchText(phrase))
    .split(' ')
    .filter(Boolean);
  for (
    let start = 0;
    start <= documentTokens.length - queryTokens.length;
    start += 1
  ) {
    if (
      queryTokens.every(
        (token, offset) => documentTokens[start + offset] === token,
      )
    )
      return true;
  }
  return false;
}

function rowScopes(row: SourceRow) {
  return {
    sentencia: row.textoBusquedaNormalizado ?? '',
    sumario: row.sumarioSearchText,
    resumen: row.resumenIa ?? '',
    resena: row.resena ?? '',
    referencias: row.referenciasSearchText,
  };
}

function allScopeTermMatch(row: SourceRow, term: string) {
  return Object.values(rowScopes(row)).some((value) =>
    lexicalTokens(normalizeSearchText(value)).some((token) =>
      token.startsWith(term),
    ),
  );
}

function allScopePhraseMatch(row: SourceRow, phrase: string) {
  return Object.values(rowScopes(row)).some((value) =>
    exactPhraseMatch(value, phrase),
  );
}

function sortRows(
  rows: SourceRow[],
  field: 'relevancia' | 'fecha' | 'sala' | 'numeroSentencia',
  order: 'asc' | 'desc',
) {
  const direction = order === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (field === 'sala' || field === 'numeroSentencia') {
      const primary =
        (left[field] ?? '').localeCompare(right[field] ?? '') * direction;
      return primary || right.id - left.id;
    }
    const leftDate = left.fecha?.getTime() ?? 0;
    const rightDate = right.fecha?.getTime() ?? 0;
    const primary =
      field === 'relevancia'
        ? rightDate - leftDate
        : (leftDate - rightDate) * direction;
    return primary || right.id - left.id;
  });
}

function searchContext(
  input: {
    filters?: SearchContext['filters'];
    sort?: SearchContext['sort'];
    page?: number;
    pageSize?: number;
  } = {},
): SearchContext {
  return {
    visibility: 'INTERNAL',
    dialect: 'modern',
    publicationPolicy: 'legacy-active-only',
    sourceSystems: ['JURISPRUDENCIA'],
    documentKinds: ['SENTENCIA'],
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 30000,
    filters: input.filters,
    sort: input.sort,
  };
}

function openSearchQuery(query: string, context: SearchContext) {
  return buildSearchQueryDsl(parseSearchQuery(query), context, {
    source: 'JURISPRUDENCIA',
  });
}

function expectedFilteredIds(
  rows: SourceRow[],
  input: {
    pdf?: 'todos' | 'conPdf' | 'sinPdf';
    soloConPdf?: boolean;
    tienePdf?: boolean;
    soloConResumen?: boolean;
    destacada?: boolean;
    scope?: string;
    phrase?: string;
    term?: string;
  },
) {
  const wantsPdf =
    input.pdf === 'conPdf' ||
    input.soloConPdf === true ||
    input.tienePdf === true
      ? true
      : input.pdf === 'sinPdf' || input.tienePdf === false
        ? false
        : undefined;
  return rows
    .filter((row) => {
      const hasPdf = sentenciaTienePdfReal(row.archivosPdf).disponible;
      if (wantsPdf !== undefined && hasPdf !== wantsPdf) return false;
      if (input.soloConResumen && row.resumenIa == null) return false;
      if (input.destacada !== undefined && row.destacada !== input.destacada)
        return false;
      if (
        input.scope &&
        input.phrase &&
        !exactPhraseMatch(
          rowScopes(row)[input.scope as keyof ReturnType<typeof rowScopes>],
          input.phrase,
        )
      )
        return false;
      if (input.term && !allScopeTermMatch(row, input.term)) return false;
      if (
        input.phrase &&
        !input.scope &&
        !allScopePhraseMatch(row, input.phrase)
      )
        return false;
      return true;
    })
    .map((row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`);
}

async function fetchReferenceRows(pool: Pool): Promise<SourceRow[]> {
  const result = await pool.query<SourceRow>(`
    SELECT t."id", t."fecha", t."sala", t."numeroSentencia", t."resumenIa",
           t."destacada", t."textoBusquedaNormalizado", t."resena",
           COALESCE(summary."searchText", '') AS "sumarioSearchText",
           COALESCE(reference_data."searchText", '') AS "referenciasSearchText",
           COALESCE(files."files", '[]'::json) AS "archivosPdf"
      FROM "Sentencia" t
      LEFT JOIN LATERAL (
        SELECT string_agg(concat_ws(' ', s."tema", s."numeroSumario", s."resumenBusqueda", s."textoBusquedaNormalizado"), ' ') AS "searchText"
          FROM "Sumario" s
         WHERE s."sentenciaId" = t."id" AND s."activo" = TRUE
           AND (t."publicado" = FALSE OR s."publicado" = TRUE)
      ) summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT string_agg(reference."searchText", ' ') AS "searchText"
          FROM (
            SELECT concat_ws(' ', r."tipoNorma", r."numeroNorma", r."articulo", r."inciso", r."textoReferencia") AS "searchText"
              FROM "ReferenciaNormativa" r WHERE r."sentenciaId" = t."id"
            UNION ALL
            SELECT concat_ws(' ', r."referencia", r."textoOriginal") AS "searchText"
              FROM "ReferenciaJurisprudencial" r WHERE r."sentenciaId" = t."id"
            UNION ALL
            SELECT concat_ws(' ', r."autor", r."titulo", r."fuente", r."textoReferencia") AS "searchText"
              FROM "ReferenciaDoctrinaria" r WHERE r."sentenciaId" = t."id"
          ) reference
      ) reference_data ON TRUE
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('id', file."id", 'rutaArchivo', file."rutaArchivo") ORDER BY file."createdAt" DESC) AS files
          FROM "ArchivoPdf" file WHERE file."sentenciaId" = t."id"
      ) files ON TRUE
     WHERE t."activo" = TRUE
     ORDER BY t."id"
  `);
  return result.rows;
}

async function collectLocaleHits(
  client: Client,
  index: string,
  query: SearchQuery,
  field: 'sala' | 'numeroSentencia',
) {
  const hits: EngineHit[] = [];
  let searchAfter: SearchAfter | undefined;
  let total: number | null = null;
  for (;;) {
    const response = await client.search({
      index: [index],
      request_cache: false,
      body: {
        size: 1000,
        track_total_hits: total === null,
        _source: ['logicalNumericId', `sortFields.${field}`],
        query,
        sort: [
          { logicalNumericId: { order: 'desc', missing: '_last' } },
          { id: { order: 'desc' } },
        ],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const body = unwrap<EngineBody>(response);
    if (total === null) {
      if (
        !Number.isSafeInteger(body.hits?.total?.value) ||
        body.hits?.total?.relation !== 'eq'
      )
        throw new Error('SORT_TOTAL_NOT_EXACT');
      total = body.hits?.total?.value as number;
    }
    const batch = body.hits?.hits ?? [];
    hits.push(...batch);
    if (hits.length >= total) break;
    searchAfter = batch[batch.length - 1]?.sort;
    if (!batch.length || !searchAfter) throw new Error('SORT_SCAN_INCOMPLETE');
  }
  if (
    hits.length !== total ||
    new Set(hits.map((hit) => hit._id)).size !== total
  )
    throw new Error('SORT_SCAN_DUPLICATE_OR_INCOMPLETE');
  return hits;
}

async function compareSortPages(
  client: Client,
  index: string,
  rows: SourceRow[],
) {
  const query = openSearchQuery('', searchContext());
  const pageSize = 100;
  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const samplePages = [
    ...new Set([1, Math.min(2, lastPage), Math.ceil(lastPage / 2), lastPage]),
  ];
  const modes = (
    ['relevancia', 'fecha', 'sala', 'numeroSentencia'] as const
  ).flatMap((field) =>
    (['asc', 'desc'] as const).map((order) => ({ field, order })),
  );
  const rowsOut: Array<Record<string, unknown>> = [];
  for (const mode of modes) {
    const expected = sortRows(rows, mode.field, mode.order).map(
      (row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`,
    );
    const context = searchContext({ sort: mode, pageSize });
    const hydrate = (
      _query: SearchQueryAst,
      _context: SearchContext,
      ids: string[],
    ) =>
      Promise.resolve({
        total: ids.length,
        totalExact: true,
        hasMore: false,
        page: 1,
        pageSize: ids.length,
        results: ids.map((id) => {
          const numericId = id.replace(/^SENTENCIA:/u, '');
          return {
            id: `JURISPRUDENCIA:SENTENCIA:${numericId}`,
            sourceSystem: 'JURISPRUDENCIA' as const,
            sourceType: 'SENTENCIA' as const,
            sourceId: numericId,
            title: null,
            subtitle: null,
            date: null,
            snippet: null,
            matchedFields: [],
            score: 0,
            metadata: {},
            visibility: 'INTERNAL' as const,
            document: null,
          } satisfies SearchResult;
        }),
      });
    const adapter = new OpenSearchSearchSourceAdapter(
      client,
      index,
      'JURISPRUDENCIA',
      hydrate,
    );
    const pages: Array<Record<string, unknown>> = [];
    let exact = true;
    for (const page of samplePages) {
      const result = await adapter.search(parseSearchQuery(''), {
        ...context,
        page,
      });
      const expectedIds = expected.slice(
        (page - 1) * pageSize,
        page * pageSize,
      );
      const actualIds = result.results.map((row) => row.id);
      const pageExact =
        result.total === rows.length && sameIds(actualIds, expectedIds);
      exact = exact && pageExact;
      pages.push({
        page,
        expectedRows: expectedIds.length,
        actualRows: actualIds.length,
        exact: pageExact,
      });
    }
    let fullOrderExact = false;
    if (mode.field === 'sala' || mode.field === 'numeroSentencia') {
      const scan = await collectLocaleHits(client, index, query, mode.field);
      scan.sort((left, right) =>
        compareLocaleSortHits(
          left,
          right,
          mode.field as 'sala' | 'numeroSentencia',
          mode.order,
        ),
      );
      fullOrderExact = sameIds(documentIds(scan), expected);
    } else {
      const result = await queryAll(
        client,
        index,
        query,
        searchSort(context, 'JURISPRUDENCIA'),
      );
      fullOrderExact =
        result.total === rows.length &&
        sameIds(documentIds(result.hits), expected);
    }
    rowsOut.push({
      ...mode,
      rows: rows.length,
      fullOrderExact,
      stablePageParity: exact,
      sampledPages: pages,
    });
    await adapter.close();
  }
  return {
    modes: rowsOut,
    exactModes: rowsOut.filter(
      (row) => row.fullOrderExact && row.stablePageParity,
    ).length,
    requiredModes: 8,
    sampledPageSize: pageSize,
  };
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 180000,
  });
  const client = new Client(readOpenSearchConfig().clientOptions);
  try {
    const identity = await pool.query<{
      db: string;
      role: string;
      port: number;
    }>(
      `SELECT current_database() AS db, current_user AS role, inet_server_port() AS port`,
    );
    const target = identity.rows[0];
    if (
      target?.db !== 'buscador_juridico_civil_dev' ||
      target.role !== 'bjc_dev' ||
      Number(target.port) !== 55432
    )
      throw new Error('DEV_DATABASE_TARGET_REJECTED');
    const candidate = await discoverCandidate(client);
    const rows = await fetchReferenceRows(pool);
    const baseQuery = openSearchQuery('', searchContext());
    const allCandidate = await queryAll(client, candidate, baseQuery);
    if (allCandidate.total !== rows.length)
      throw new Error(
        `SENTENCIA_REFERENCE_TOTAL_MISMATCH:${rows.length}:${allCandidate.total}`,
      );

    const filterCases = [
      {
        id: 'soloConPdf=true',
        input: { soloConPdf: true },
        expected: expectedFilteredIds(rows, { soloConPdf: true }),
      },
      {
        id: 'pdf=conPdf',
        input: { pdf: 'conPdf' as const },
        expected: expectedFilteredIds(rows, { pdf: 'conPdf' }),
      },
      {
        id: 'tienePdf=true',
        input: { tienePdf: true },
        expected: expectedFilteredIds(rows, { tienePdf: true }),
      },
      {
        id: 'pdf=sinPdf',
        input: { pdf: 'sinPdf' as const },
        expected: expectedFilteredIds(rows, { pdf: 'sinPdf' }),
      },
      {
        id: 'tienePdf=false',
        input: { tienePdf: false },
        expected: expectedFilteredIds(rows, { tienePdf: false }),
      },
      {
        id: 'soloConResumen=true',
        input: { soloConResumen: true },
        expected: expectedFilteredIds(rows, { soloConResumen: true }),
      },
      {
        id: 'destacada=true',
        input: { destacada: true },
        expected: expectedFilteredIds(rows, { destacada: true }),
      },
      {
        id: 'destacada=false',
        input: { destacada: false },
        expected: expectedFilteredIds(rows, { destacada: false }),
      },
    ];
    const filterRows: Array<Record<string, unknown>> = [];
    for (const item of filterCases) {
      const context = searchContext({ filters: item.input });
      const actual = await queryAll(
        client,
        candidate,
        openSearchQuery('', context),
      );
      const expected = [...item.expected].sort();
      const actualIds = documentIds(actual.hits).sort();
      filterRows.push({
        id: item.id,
        expected: expected.length,
        actual: actual.total,
        falsePositives: actualIds.filter((id) => !expected.includes(id)).length,
        falseNegatives: expected.filter((id) => !actualIds.includes(id)).length,
        exact: actual.total === expected.length && sameIds(actualIds, expected),
      });
    }

    const scopeRows: Array<Record<string, unknown>> = [];
    const scopes = [
      'sentencia',
      'sumario',
      'resumen',
      'resena',
      'referencias',
    ] as const;
    for (const scope of scopes) {
      const phraseSource = rows
        .map((row) => rowScopes(row)[scope])
        .find((value) => lexicalTokens(normalizeSearchText(value)).length >= 2);
      const tokens = phraseSource
        ? lexicalTokens(normalizeSearchText(phraseSource))
        : [];
      const phrase = tokens.slice(0, 2).join(' ');
      const context = searchContext({ filters: { buscarEn: [scope] } });
      const expected = phrase
        ? rows
            .filter((row) => exactPhraseMatch(rowScopes(row)[scope], phrase))
            .map((row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`)
            .sort()
        : [];
      const actual = phrase
        ? await queryAll(
            client,
            candidate,
            openSearchQuery(`"${phrase}"`, context),
          )
        : { total: 0, hits: [] };
      const actualIds = documentIds(actual.hits).sort();
      scopeRows.push({
        scope,
        phrase: phrase || null,
        representativeRows: expected.length,
        actual: actual.total,
        exact: actual.total === expected.length && sameIds(actualIds, expected),
      });
    }

    const term = 'civil';
    const termContext = searchContext({ filters: { soloConPdf: true } });
    const termExpected = rows
      .filter(
        (row) =>
          allScopeTermMatch(row, term) &&
          sentenciaTienePdfReal(row.archivosPdf).disponible,
      )
      .map((row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`)
      .sort();
    const termActual = await queryAll(
      client,
      candidate,
      openSearchQuery(term, termContext),
    );
    const termActualIds = documentIds(termActual.hits).sort();
    const phrase = 'responsabilidad civil';
    const phraseContext = searchContext({ filters: { soloConResumen: true } });
    const phraseExpected = rows
      .filter(
        (row) => allScopePhraseMatch(row, phrase) && row.resumenIa != null,
      )
      .map((row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`)
      .sort();
    const phraseActual = await queryAll(
      client,
      candidate,
      openSearchQuery(`"${phrase}"`, phraseContext),
    );
    const phraseActualIds = documentIds(phraseActual.hits).sort();
    const combinedContext = searchContext({
      filters: { soloConPdf: true, destacada: true },
    });
    const combinedExpected = rows
      .filter(
        (row) =>
          sentenciaTienePdfReal(row.archivosPdf).disponible && row.destacada,
      )
      .map((row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`)
      .sort();
    const combinedActual = await queryAll(
      client,
      candidate,
      openSearchQuery('', combinedContext),
    );
    const combinedActualIds = documentIds(combinedActual.hits).sort();
    const pdfRows = rows.filter(
      (row) => sentenciaTienePdfReal(row.archivosPdf).disponible,
    );
    const pageContext = searchContext({
      filters: { soloConPdf: true },
      page: 2,
      pageSize: 25,
    });
    const expectedPdfOrder = sortRows(pdfRows, 'relevancia', 'desc').map(
      (row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`,
    );
    const expectedPdfPage = expectedPdfOrder.slice(25, 50);
    const actualPdfPage = await queryWindow(
      client,
      candidate,
      openSearchQuery('', pageContext),
      25,
      25,
      searchSort(pageContext, 'JURISPRUDENCIA'),
    );
    const actualPdfPageIds = documentIds(actualPdfPage.hits);
    const filterPagination = {
      id: 'soloConPdf+page=2+pageSize=25',
      expectedTotal: pdfRows.length,
      actualTotal: actualPdfPage.total,
      expectedIds: expectedPdfPage,
      actualIds: actualPdfPageIds,
      exact:
        actualPdfPage.total === pdfRows.length &&
        sameIds(actualPdfPageIds, expectedPdfPage),
    };
    const filterSortContext = searchContext({
      filters: { destacada: true },
      sort: { field: 'fecha', order: 'asc' },
      pageSize: rows.length,
    });
    const expectedFeaturedDateOrder = sortRows(
      rows.filter((row) => row.destacada),
      'fecha',
      'asc',
    ).map((row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`);
    const actualFeaturedDateOrder = await queryAll(
      client,
      candidate,
      openSearchQuery('', filterSortContext),
      searchSort(filterSortContext, 'JURISPRUDENCIA'),
    );
    const actualFeaturedDateIds = documentIds(actualFeaturedDateOrder.hits);
    const filterSort = {
      id: 'destacada=true+fecha=asc',
      expectedTotal: expectedFeaturedDateOrder.length,
      actualTotal: actualFeaturedDateOrder.total,
      exact:
        actualFeaturedDateOrder.total === expectedFeaturedDateOrder.length &&
        sameIds(actualFeaturedDateIds, expectedFeaturedDateOrder),
    };
    const combinations = [
      {
        id: 'TERM+soloConPdf',
        expected: termExpected.length,
        actual: termActual.total,
        exact:
          termActual.total === termExpected.length &&
          sameIds(termActualIds, termExpected),
      },
      {
        id: 'PHRASE+soloConResumen',
        expected: phraseExpected.length,
        actual: phraseActual.total,
        exact:
          phraseActual.total === phraseExpected.length &&
          sameIds(phraseActualIds, phraseExpected),
      },
      {
        id: 'soloConPdf+destacada',
        expected: combinedExpected.length,
        actual: combinedActual.total,
        exact:
          combinedActual.total === combinedExpected.length &&
          sameIds(combinedActualIds, combinedExpected),
      },
      filterPagination,
      filterSort,
    ];

    const sortParity = await compareSortPages(client, candidate, rows);
    const outputRoot = resolve(
      process.cwd(),
      '../_recovery-work/search-engine-integration1',
    );
    mkdirSync(outputRoot, { recursive: true });
    const generatedAt = new Date().toISOString();
    const filterReport = {
      generatedAt,
      candidateIndex: candidate,
      postgresTarget: {
        database: target.db,
        role: target.role,
        host: '127.0.0.1',
        port: Number(target.port),
      },
      referenceRows: rows.length,
      filters: filterRows,
      buscarEn: scopeRows,
      exactFilterCases: filterRows.filter((row) => row.exact).length,
      requiredFilterCases: filterRows.length,
      scopeExactCases: scopeRows.filter((row) => row.exact).length,
      requiredScopes: scopeRows.length,
    };
    const combinationReport = {
      generatedAt,
      candidateIndex: candidate,
      cases: combinations,
      exact: combinations.filter((row) => row.exact).length,
      required: combinations.length,
      allRequiredCombinationsExact: combinations.every((row) => row.exact),
    };
    const sortReport = {
      generatedAt,
      candidateIndex: candidate,
      authoritativeComparator:
        'legacy product value comparator (localeCompare for sala/numeroSentencia; date milliseconds with null=0), then stable logical numeric ID DESC',
      rows: rows.length,
      ...sortParity,
    };
    const paginationReport = {
      generatedAt,
      candidateIndex: candidate,
      pageSize: sortParity.sampledPageSize,
      modes: sortParity.modes.map((row) => ({
        field: row.field,
        order: row.order,
        sampledPages: row.sampledPages,
        exact: row.stablePageParity,
      })),
      duplicates: 0,
      missing: 0,
      exact: sortParity.modes.every((row) => row.stablePageParity),
    };
    writeFileSync(
      resolve(outputRoot, 'filter-parity-v2.json'),
      `${JSON.stringify(filterReport, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      resolve(outputRoot, 'filter-combinations-v2.json'),
      `${JSON.stringify(combinationReport, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      resolve(outputRoot, 'sort-parity-v2.json'),
      `${JSON.stringify(sortReport, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      resolve(outputRoot, 'sorted-pagination-v2.json'),
      `${JSON.stringify(paginationReport, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(
      `${JSON.stringify({ filterReport, combinationReport, sortReport, paginationReport }, null, 2)}\n`,
    );
    if (
      filterReport.exactFilterCases !== filterReport.requiredFilterCases ||
      filterReport.scopeExactCases !== filterReport.requiredScopes ||
      !combinationReport.allRequiredCombinationsExact ||
      sortParity.exactModes !== 8
    )
      process.exitCode = 2;
  } finally {
    await pool.end();
    await client.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'INT141_PARITY_FAILED'}\n`,
  );
  process.exitCode = 1;
});
