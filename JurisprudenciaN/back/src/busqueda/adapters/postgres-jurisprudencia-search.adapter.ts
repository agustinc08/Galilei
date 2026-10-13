import { Pool } from 'pg';
import { performance } from 'node:perf_hooks';
import type {
  SearchContext,
  SearchResult,
  SearchResultPage,
  SearchSourceAdapter,
} from './search-source.adapter';
import type { SearchFieldName, SearchLiteralNode, SearchNode, SearchQueryAst } from '../utils/search-ast';
import { visitSearchLiterals } from '../utils/search-ast';
import { normalizeSearchText } from '../utils/search-normalizer';

type SqlValue = string | number | boolean | Date | null;
type Row = {
  id: number;
  legacyId: string | null;
  numeroSumario: string | null;
  tema: string | null;
  texto: string;
  resumenBusqueda: string | null;
  textoBusquedaNormalizado: string | null;
  fecha: Date | null;
  numeroSentencia: string | null;
  sumarioPublicado: boolean;
  sentenciaPublicado: boolean;
  sumarioActivo: boolean;
  sentenciaActivo: boolean;
  tipoFallo: string | null;
  sala: string | null;
  expediente: string | null;
  tribunalOrigen: string | null;
  actor: string | null;
  demandado: string | null;
  objeto: string | null;
  magistrados: string | null;
  caratula: string | null;
  sentenciaSearchText: string | null;
  score: number | string;
  identifierExact: number;
  phraseExact: number;
  fieldExact: number;
  fullText: number;
  trigram: number | string;
};

const NORMALIZED_FIELDS: Readonly<Record<SearchFieldName, string>> = {
  tema: 's."tema"',
  sala: 't."sala"',
  tipoFallo: 't."tipoFallo"',
  tribunalOrigen: 't."tribunalOrigen"',
  expediente: 't."expediente"',
  caratula: 't."caratula"',
  actor: 't."actor"',
  demandado: 't."demandado"',
  objeto: 't."objeto"',
  magistrados: 't."magistrados"',
  numeroSentencia: 't."numeroSentencia"',
  numeroSumario: 's."numeroSumario"',
};

const LEGACY_IDENTIFIER_FIELDS = new Set<SearchFieldName>([
  'expediente', 'numeroSentencia', 'numeroSumario',
]);

function normalizeSql(expression: string) {
  return `regexp_replace(translate(lower(coalesce(${expression},'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g')`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, '\\$&');
}

function normalizeLegacyValue(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('es')
    .replace(/[áÁ]/gu, 'a')
    .replace(/[éÉ]/gu, 'e')
    .replace(/[íÍ]/gu, 'i')
    .replace(/[óÓ]/gu, 'o')
    .replace(/[úÚ]/gu, 'u')
    .replace(/[ñÑ]/gu, 'ñ');
}

function literalValue(node: SearchLiteralNode, dialect: SearchContext['dialect']) {
  return dialect === 'legacy-reference'
    ? normalizeLegacyValue(node.type === 'phrase' ? node.value : (node.field ? node.sourceText : node.value))
    : normalizeSearchText(node.value);
}

function patternFor(node: SearchLiteralNode, context: SearchContext) {
  const value = escapeLike(literalValue(node, context.dialect));
  if (node.type === 'phrase') return `% ${value} %`;
  if (node.matchMode === 'prefix') return `% ${value}%`;
  if (node.matchMode === 'suffix') return `%${value} %`;
  return context.dialect === 'legacy-reference' ? `% ${value} %` : `%${value}%`;
}

function fieldExpression(field: SearchFieldName | undefined, context: SearchContext) {
  if (context.dialect === 'legacy-reference') {
    return `lower(coalesce(s."resumenBusqueda",''))`;
  }
  return field ? normalizeSql(NORMALIZED_FIELDS[field]) : 'concat_ws(\' \', s."textoBusquedaNormalizado", t."textoBusquedaNormalizado")';
}

function compileLiteral(node: SearchLiteralNode, context: SearchContext, values: SqlValue[]) {
  const placeholder = `$${values.length + 1}`;
  values.push(patternFor(node, context));
  if (context.dialect === 'modern' && !node.field) {
    return `(s."textoBusquedaNormalizado" LIKE ${placeholder} ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE ${placeholder} ESCAPE E'\\\\')`;
  }
  const expression = fieldExpression(node.field, context);
  return `${expression} LIKE ${placeholder} ESCAPE E'\\\\'`;
}

function compileNode(node: SearchNode | null, context: SearchContext, values: SqlValue[]): string {
  if (!node) return 'TRUE';
  switch (node.type) {
    case 'term':
    case 'phrase':
      return `(${compileLiteral(node, context, values)})`;
    case 'not':
      return `(NOT ${compileNode(node.operand, context, values)})`;
    case 'and':
      return `(${node.operands.map((item) => compileNode(item, context, values)).join(' AND ')})`;
    case 'or':
      return `(${node.operands.map((item) => compileNode(item, context, values)).join(' OR ')})`;
  }
}

/**
 * Build a candidate ID set per AST leaf, then combine IDs with SQL set
 * operations. The old predicate compiler remains available to the
 * legacy-reference dialect for parity diagnostics.
 */
function buildBooleanCandidateCte(
  query: SearchQueryAst,
  context: SearchContext,
  values: SqlValue[],
) {
  if (context.dialect !== 'modern') return null;

  const ctes: string[] = [];
  let nextId = 0;
  const nextName = () => `"candidateNode${nextId++}"`;
  const visibleConditions = (sumarioAlias: string, sentenciaAlias: string) => {
    const predicates = [`${sumarioAlias}."activo" = TRUE`, `${sentenciaAlias}."activo" = TRUE`];
    if (context.publicationPolicy === 'published-active-only') {
      predicates.push(`${sumarioAlias}."publicado" = TRUE`, `${sentenciaAlias}."publicado" = TRUE`);
    }
    return predicates.join(' AND ');
  };

  const addLiteral = (node: SearchLiteralNode) => {
    const name = nextName();
    const candidatePattern = patternFor(node, context);
    if (node.field) {
      const expression = fieldExpression(node.field, context);
      values.push(candidatePattern);
      ctes.push(`${name} AS MATERIALIZED (
        SELECT s."id" FROM "Sumario" s
        INNER JOIN "Sentencia" t ON t."id" = s."sentenciaId"
        WHERE ${visibleConditions('s', 't')} AND ${expression} LIKE $${values.length} ESCAPE E'\\\\'
      )`);
      return name;
    }

    values.push(candidatePattern, candidatePattern);
    const first = `$${values.length - 1}`;
    const second = `$${values.length}`;
    ctes.push(`${name} AS MATERIALIZED (
      SELECT s."id" FROM "Sumario" s
      WHERE s."activo" = TRUE AND s."textoBusquedaNormalizado" LIKE ${first} ESCAPE E'\\\\'
        ${context.publicationPolicy === 'published-active-only' ? 'AND s."publicado" = TRUE' : ''}
      UNION
      SELECT s."id" FROM "Sentencia" t
      INNER JOIN "Sumario" s ON s."sentenciaId" = t."id"
      WHERE ${visibleConditions('s', 't')} AND t."textoBusquedaNormalizado" LIKE ${second} ESCAPE E'\\\\'
    )`);
    return name;
  };

  const addNode = (node: SearchNode | null): string => {
    if (!node) {
      const name = nextName();
      ctes.push(`${name} AS MATERIALIZED (
        SELECT s."id" FROM "Sumario" s
        INNER JOIN "Sentencia" t ON t."id" = s."sentenciaId"
        WHERE ${visibleConditions('s', 't')}
      )`);
      return name;
    }
    switch (node.type) {
      case 'term':
      case 'phrase':
        return addLiteral(node);
      case 'not': {
        const child = addNode(node.operand);
        const name = nextName();
        const universe = addNode(null);
        ctes.push(`${name} AS MATERIALIZED (SELECT "id" FROM ${universe} EXCEPT SELECT "id" FROM ${child})`);
        return name;
      }
      case 'and':
      case 'or': {
        const children = node.operands.map(addNode);
        if (children.length === 0) return addNode(null);
        const name = nextName();
        const operator = node.type === 'and' ? 'INTERSECT' : 'UNION';
        ctes.push(`${name} AS MATERIALIZED (${children.map((child) => `SELECT "id" FROM ${child}`).join(` ${operator} `)})`);
        return name;
      }
    }
  };

  const rootName = addNode(query.root);
  ctes.push(`"searchCandidates" AS MATERIALIZED (SELECT "id" FROM ${rootName})`);
  return `WITH ${ctes.join(',\n')}`;
}

function guaranteesMatch(root: SearchNode | null, target: SearchNode): boolean {
  if (!root) return false;
  if (root === target) return root.type === 'term' || root.type === 'phrase';
  switch (root.type) {
    case 'term':
    case 'phrase':
      return false;
    case 'not':
      return false;
    case 'and':
      return root.operands.some((operand) => guaranteesMatch(operand, target));
    case 'or':
      return root.operands.length > 0 && root.operands.every((operand) => guaranteesMatch(operand, target));
  }
}

function guaranteesPositiveLiteral(root: SearchNode | null): boolean {
  if (!root) return false;
  switch (root.type) {
    case 'term':
    case 'phrase':
      return true;
    case 'not':
      return false;
    case 'and':
      return root.operands.some(guaranteesPositiveLiteral);
    case 'or':
      return root.operands.length > 0 && root.operands.every(guaranteesPositiveLiteral);
  }
}

function buildWhere(query: SearchQueryAst, context: SearchContext, values: SqlValue[], searchAlreadyApplied = false) {
  const predicates = ['s."activo" = TRUE', 't."activo" = TRUE'];
  if (context.publicationPolicy === 'published-active-only') {
    predicates.push('s."publicado" = TRUE', 't."publicado" = TRUE');
  }
  if (context.filters?.sala) {
    values.push(context.filters.sala);
    predicates.push(`t."sala" = $${values.length}`);
  }
  if (context.filters?.fechaDesde) {
    values.push(context.filters.fechaDesde);
    predicates.push(`t."fecha" >= $${values.length}::date`);
  }
  if (context.filters?.fechaHastaExclusive) {
    values.push(context.filters.fechaHastaExclusive);
    predicates.push(`t."fecha" < $${values.length}::date`);
  }
  const exactFilters: Array<[keyof NonNullable<SearchContext['filters']>, string]> = [
    ['expediente', 't."expediente"'], ['numeroSentencia', 't."numeroSentencia"'],
    ['caratula', 't."caratula"'], ['tribunalOrigen', 't."tribunalOrigen"'], ['tipoFallo', 't."tipoFallo"'],
  ];
  for (const [key, column] of exactFilters) {
    const value = context.filters?.[key];
    if (value) { values.push(`%${escapeLike(normalizeSearchText(value))}%`); predicates.push(`${normalizeSql(column)} LIKE $${values.length} ESCAPE E'\\\\'`); }
  }
  if (!searchAlreadyApplied) predicates.push(compileNode(query.root, context, values));
  return predicates.join(' AND ');
}

function buildTrigramCandidateCte(query: SearchQueryAst, context: SearchContext, values: SqlValue[]) {
  const node = query.root;
  if (context.dialect !== 'modern' || node?.type !== 'term' || node.field ||
      node.matchMode !== 'suffix' || node.value.length < 3) return null;
  values.push(patternFor(node, context));
  const pattern = `$${values.length}`;
  return `WITH "searchCandidates" AS (
    SELECT s2."id" AS "sumarioId"
      FROM "Sumario" s2
     WHERE s2."activo" = TRUE AND s2."textoBusquedaNormalizado" LIKE ${pattern} ESCAPE E'\\\\'
    UNION
    SELECT s2."id" AS "sumarioId"
      FROM "Sentencia" t2 INNER JOIN "Sumario" s2 ON s2."sentenciaId" = t2."id"
     WHERE s2."activo" = TRUE AND t2."activo" = TRUE
       AND t2."textoBusquedaNormalizado" LIKE ${pattern} ESCAPE E'\\\\'
  )`;
}

function buildRanking(query: SearchQueryAst, context: SearchContext, values: SqlValue[]) {
  if (context.dialect === 'legacy-reference') {
    const zero = '0::numeric';
    return { score: zero, identifier: zero, phrase: zero, field: zero, text: zero, trigram: zero };
  }
  const literals: Array<{ node: SearchLiteralNode; value: string }> = [];
  visitSearchLiterals(query.root, (node, negated) => {
    if (!negated) literals.push({ node, value: literalValue(node, context.dialect) });
  });
  const identifierScores: string[] = [];
  const phraseScores: string[] = [];
  const fieldScores: string[] = [];
  const textScores: string[] = [];
  const trigramScores: string[] = [];
  const wholeText = 'concat_ws(\' \', s."textoBusquedaNormalizado", t."textoBusquedaNormalizado")';
  const textIsGuaranteed = literals.length > 0 && guaranteesPositiveLiteral(query.root);

  for (const { node, value } of literals) {
    const exactExpression = node.field ? normalizeSql(NORMALIZED_FIELDS[node.field]) : wholeText;
    const exactParam = node.field ? `$${values.length + 1}` : undefined;
    if (node.field) values.push(normalizeSearchText(node.value));
    if (node.field && exactParam && LEGACY_IDENTIFIER_FIELDS.has(node.field)) {
      identifierScores.push(`CASE WHEN ${exactExpression} = ${exactParam} THEN 1 ELSE 0 END`);
    }
    if (node.type === 'phrase') {
      if (guaranteesMatch(query.root, node)) {
        phraseScores.push('1::numeric');
      } else {
        const phraseParam = `$${values.length + 1}`;
        values.push(`% ${escapeLike(value)} %`);
        phraseScores.push(`CASE WHEN ${wholeText} LIKE ${phraseParam} ESCAPE E'\\\\' THEN 1 ELSE 0 END`);
      }
    }
    if (node.field && exactParam) fieldScores.push(`CASE WHEN ${exactExpression} = ${exactParam} THEN 1 ELSE 0 END`);

    if (!textIsGuaranteed) {
      const matchSql = compileLiteral(node, context, values);
      textScores.push(`CASE WHEN ${matchSql} THEN 1 ELSE 0 END`);
    }
    // Trigram work is limited to explicitly selected fields; running similarity
    // across entire document text made the local fixture query CPU-bound.
    if (context.dialect === 'modern' && node.field && value.length >= 3) {
      const trigramParam = `$${values.length + 1}`;
      values.push(value);
      trigramScores.push(`similarity(${exactExpression}, ${trigramParam})`);
    }
  }

  const max = (parts: string[]) => (parts.length ? `GREATEST(${parts.join(',')})` : '0::numeric');
  const identifier = max(identifierScores);
  const phrase = max(phraseScores);
  const field = max(fieldScores);
  // A positive-only match (or an AND with at least one guaranteed positive
  // branch) necessarily has one matching positive literal. Avoid evaluating
  // each matching LIKE again for every row solely to produce the same score.
  const text = textIsGuaranteed ? '1::numeric' : max(textScores);
  const trigram = max(trigramScores);
  const score = `(${identifier} * 1000000 + ${phrase} * 10000 + ${field} * 1000 + ${text} * 100 + ${trigram})`;
  return { score, identifier, phrase, field, text, trigram };
}

function normalizeFieldValue(value: unknown) {
  return typeof value === 'string' ? normalizeSearchText(value) : '';
}

function matchedFields(row: Row, literals: SearchLiteralNode[]) {
  const fields: Array<[SearchFieldName, unknown]> = [
    ['tema', row.tema], ['sala', row.sala], ['tipoFallo', row.tipoFallo],
    ['tribunalOrigen', row.tribunalOrigen], ['expediente', row.expediente],
    ['caratula', row.caratula], ['actor', row.actor], ['demandado', row.demandado],
    ['objeto', row.objeto], ['magistrados', row.magistrados],
    ['numeroSentencia', row.numeroSentencia], ['numeroSumario', row.numeroSumario],
  ];
  const result = fields.filter(([field, value]) => literals.some((literal) => {
    if (literal.field && literal.field !== field) return false;
    const source = normalizeFieldValue(value);
    const needle = normalizeSearchText(literal.value);
    if (!source || !needle) return false;
    if (literal.type === 'phrase') return ` ${source} `.includes(` ${needle} `);
    if (literal.matchMode === 'prefix') return source.split(/\s+/u).some((word) => word.startsWith(needle));
    if (literal.matchMode === 'suffix') return source.split(/\s+/u).some((word) => word.endsWith(needle));
    return source.includes(needle);
  }));
  return result.map(([field]) => field);
}

function scoreMetadata(row: Row) {
  return {
    identifierExact: Number(row.identifierExact),
    phraseExact: Number(row.phraseExact),
    fieldExact: Number(row.fieldExact),
    fullText: Number(row.fullText),
    trigram: Number(row.trigram),
  };
}

export class PostgresJurisprudenciaSearchAdapter implements SearchSourceAdapter {
  private readonly pool: Pool;
  private readonly candidateStrategy: 'predicate-v1' | 'set-algebra-v2';
  private lastSearchProfile: { countMs: number; resultPageMs: number; serializationMs: number; resultRows: number; queryCount: number; candidateStrategy: string } | null = null;

  constructor(databaseUrl = process.env.DATABASE_URL, candidateStrategy: 'predicate-v1' | 'set-algebra-v2' = 'set-algebra-v2') {
    if (!databaseUrl?.trim()) throw new Error('Se requiere DATABASE_URL para PostgreSQL local.');
    const target = new URL(databaseUrl.trim());
    if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' ||
        target.username !== 'bjc_dev') {
      throw new Error('PostgresJurisprudenciaSearchAdapter sólo admite la base DEV local 127.0.0.1:55432.');
    }
    const configuredStatementTimeout = Number(process.env.BJC_SEARCH_STATEMENT_TIMEOUT_MS ?? 4000);
    const statementTimeout = Number.isInteger(configuredStatementTimeout) && configuredStatementTimeout >= 500 && configuredStatementTimeout <= 4500
      ? configuredStatementTimeout
      : 4000;
    this.pool = new Pool({ connectionString: databaseUrl.trim(), max: 4, connectionTimeoutMillis: 5000, statement_timeout: statementTimeout });
    this.candidateStrategy = candidateStrategy;
  }

  getLastSearchProfile() {
    return this.lastSearchProfile;
  }

  async search(query: SearchQueryAst, context: SearchContext): Promise<SearchResultPage> {
    this.lastSearchProfile = null;
    const page = Math.max(1, Math.trunc(context.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.trunc(context.pageSize ?? 25)));
    const whereValues: SqlValue[] = [];
    const booleanCandidateCte = this.candidateStrategy === 'set-algebra-v2'
      ? buildBooleanCandidateCte(query, context, whereValues)
      : null;
    const trigramCandidateCte = booleanCandidateCte
      ? null
      : buildTrigramCandidateCte(query, context, whereValues);
    const candidateCte = booleanCandidateCte ?? trigramCandidateCte;
    const where = buildWhere(query, context, whereValues, Boolean(candidateCte));
    const from = candidateCte
      ? `FROM "searchCandidates" c INNER JOIN "Sumario" s ON s."id" = c."${booleanCandidateCte ? 'id' : 'sumarioId'}" INNER JOIN "Sentencia" t ON t."id" = s."sentenciaId"`
      : 'FROM "Sumario" s INNER JOIN "Sentencia" t ON t."id" = s."sentenciaId"';
    const withCte = candidateCte ? `${candidateCte} ` : '';
    const countStart = performance.now();
    const countResult = await this.pool.query<{ total: string }>(
      `${withCte}SELECT COUNT(*)::text AS total ${from} WHERE ${where}`,
      whereValues,
    );
    const countMs = performance.now() - countStart;

    const rowValues = [...whereValues];
    const ranking = buildRanking(query, context, rowValues);
    rowValues.push(pageSize, (page - 1) * pageSize);
    const limit = `$${rowValues.length - 1}`;
    const offset = `$${rowValues.length}`;
    const resultPageStart = performance.now();
    const rows = await this.pool.query<Row>(
      `${withCte}SELECT s."id", s."legacyId", s."numeroSumario", s."tema", s."texto", s."resumenBusqueda",
              s."publicado" AS "sumarioPublicado", t."publicado" AS "sentenciaPublicado",
              s."activo" AS "sumarioActivo", t."activo" AS "sentenciaActivo",
              s."textoBusquedaNormalizado", t."fecha", t."numeroSentencia", t."tipoFallo", t."sala",
              t."expediente", t."tribunalOrigen", t."actor", t."demandado", t."objeto", t."magistrados",
              t."caratula", t."textoBusquedaNormalizado" AS "sentenciaSearchText",
              ${ranking.score} AS "score", ${ranking.identifier} AS "identifierExact",
              ${ranking.phrase} AS "phraseExact", ${ranking.field} AS "fieldExact",
              ${ranking.text} AS "fullText", ${ranking.trigram} AS "trigram"
         ${from}
        WHERE ${where}
        ORDER BY "score" DESC, t."fecha" DESC NULLS LAST, s."id" DESC
        LIMIT ${limit} OFFSET ${offset}`,
      rowValues,
    );
    const resultPageMs = performance.now() - resultPageStart;

    const serializationStart = performance.now();
    const literals: SearchLiteralNode[] = [];
    visitSearchLiterals(query.root, (literal, negated) => { if (!negated) literals.push(literal); });
    const result = {
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      pageSize,
      results: rows.rows.map((row): SearchResult => {
        const title = row.tema?.trim() || (row.numeroSumario ? `Sumario ${row.numeroSumario}` : null);
        const scoreComponents = scoreMetadata(row);
        return {
          id: `JURISPRUDENCIA:SUMARIO:${row.id}`,
          sourceSystem: 'JURISPRUDENCIA',
          sourceType: 'SUMARIO',
          sourceId: String(row.id),
          title,
          subtitle: row.numeroSumario ? `Sumario ${row.numeroSumario}` : null,
          date: row.fecha?.toISOString() ?? null,
          snippet: (row.resumenBusqueda || row.texto || '').replace(/\s+/gu, ' ').trim().slice(0, 280) || null,
          matchedFields: matchedFields(row, literals),
          score: Number(row.score),
          scoreComponents,
          metadata: {
            sentenciaId: row.legacyId ? Number(row.legacyId.split('/').pop()) : null,
            legacyId: row.legacyId,
            legacySource: 'jurisp_6/db/jurisprudencia_db.sqlite',
            legacyTable: 'tb_sumarios',
            caratula: row.caratula,
            numeroSentencia: row.numeroSentencia,
            numeroSumario: row.numeroSumario,
            publicado: row.sumarioPublicado && row.sentenciaPublicado,
            activo: row.sumarioActivo && row.sentenciaActivo,
            sala: row.sala,
            expediente: row.expediente,
            tipoFallo: row.tipoFallo,
            tribunalOrigen: row.tribunalOrigen,
            actor: row.actor,
            demandado: row.demandado,
            objeto: row.objeto,
            magistrados: row.magistrados,
            tema: row.tema,
          },
          visibility: context.visibility,
          document: null,
        };
      }),
    };
    this.lastSearchProfile = {
      countMs,
      resultPageMs,
      serializationMs: performance.now() - serializationStart,
      resultRows: rows.rowCount ?? rows.rows.length,
      queryCount: 2,
      candidateStrategy: this.candidateStrategy,
    };
    return result;
  }

  /** Returns the complete legacy result-ID universe for parity/benchmark tooling. */
  async searchIds(query: SearchQueryAst, context: SearchContext): Promise<string[]> {
    const values: SqlValue[] = [];
    const booleanCandidateCte = this.candidateStrategy === 'set-algebra-v2'
      ? buildBooleanCandidateCte(query, context, values)
      : null;
    const trigramCandidateCte = booleanCandidateCte
      ? null
      : buildTrigramCandidateCte(query, context, values);
    const candidateCte = booleanCandidateCte ?? trigramCandidateCte;
    const where = buildWhere(query, context, values, Boolean(candidateCte));
    const from = candidateCte
      ? `FROM "searchCandidates" c INNER JOIN "Sumario" s ON s."id" = c."${booleanCandidateCte ? 'id' : 'sumarioId'}" INNER JOIN "Sentencia" t ON t."id" = s."sentenciaId"`
      : 'FROM "Sumario" s INNER JOIN "Sentencia" t ON t."id" = s."sentenciaId"';
    const result = await this.pool.query<{ id: number }>(
      `${candidateCte ? `${candidateCte} ` : ''}SELECT s."id" AS id
         ${from}
        WHERE ${where}`,
      values,
    );
    return result.rows.map((row) => String(row.id));
  }

  async close() {
    await this.pool.end();
  }
}
