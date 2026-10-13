/* eslint prettier/prettier: off -- Keep unrelated Search SQL formatting out of this workspace change. */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { QueryResult } from 'pg';
import type {
  SearchContext,
  SearchResult,
  SearchResultPage,
  SearchSourceAdapter,
} from '../busqueda/adapters/search-source.adapter';
import type {
  SearchLiteralNode,
  SearchNode,
  SearchQueryAst,
} from '../busqueda/utils/search-ast';
import { visitSearchLiterals } from '../busqueda/utils/search-ast';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';

type SqlValue = string | string[] | number | boolean | Date | null;
type SearchRow = {
  id: string | null;
  title: string;
  subtitle: string | null;
  decisionDate: Date | null;
  documentType: string;
  jurisdiction: string;
  court: string | null;
  chamber: string | null;
  instance: string | null;
  caseNumber: string | null;
  visibility: string;
  searchText: string;
  extractedText: string;
  fileId: string | null;
  fileMimeType: string | null;
  checksum: string | null;
  filename: string | null;
  sourceCode: string | null;
  externalId: string | null;
  sourceReference: string | null;
  matchedPage: number | null;
  total: string;
  hasMore: boolean;
  totalExact?: boolean;
  candidateCount?: string;
  probeCount?: number;
  candidateWindowSizes?: number[];
  exactHitsByWindow?: number[];
  linkedResultIds: string[];
  digestoCollections: string | null;
  digestoTopics: string | null;
  digestoTags: string | null;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, '\\$&');
}
function pattern(literal: SearchLiteralNode) {
  const value = escapeLike(normalizeSearchText(literal.value));
  if (literal.type === 'phrase') return `%${value}%`;
  if (literal.matchMode === 'prefix') return `${value}%`;
  if (literal.matchMode === 'suffix') return `%${value}`;
  return `%${value}%`;
}

function compileNode(node: SearchNode | null, values: SqlValue[]): string {
  if (!node) return 'TRUE';
  if (node.type === 'term' || node.type === 'phrase') {
    values.push(pattern(node));
    const columns: Record<string, string> = {
      tema: 'd."subtitle"',
      sala: 'd."chamber"',
      tipoFallo: 'd."documentType"',
      tribunalOrigen: 'd."court"',
      expediente: 'd."caseNumber"',
      caratula: 'd."title"',
      actor: `COALESCE(d."metadata"->>'actor', d."metadata"->>'actorPublico', '')`,
      demandado: `COALESCE(d."metadata"->>'demandado', d."metadata"->>'demandadoPublico', '')`,
      objeto: `COALESCE(d."metadata"->>'objeto', '')`,
      magistrados: `COALESCE(d."metadata"->>'magistrados', '')`,
      numeroSentencia: 'd."caseNumber"',
      numeroSumario: 'd."searchText"',
    };
    const rawColumn = node.field ? columns[node.field] : 'd."searchText"';
    // The full-text projection is normalized at write time. Keeping the bare
    // column expression lets PostgreSQL use its GIN trigram index at corpus scale.
    const normalizedColumn = node.field
      ? `translate(lower(coalesce(${rawColumn},'')), 'áéíóúü', 'aeiouu')`
      : rawColumn;
    return `${normalizedColumn} ILIKE $${values.length} ESCAPE E'\\\\'`;
  }
  if (node.type === 'not') return `(NOT ${compileNode(node.operand, values)})`;
  const operator = node.type === 'and' ? ' AND ' : ' OR ';
  return `(${node.operands.map((part) => compileNode(part, values)).join(operator)})`;
}

function buildBooleanCandidateCte(
  query: SearchQueryAst,
  values: SqlValue[],
  useTokenProjection: boolean,
  deferPhraseVerification = false,
  scopePredicate = 'd."documentScope" = \'GENERAL\'',
) {
  const ctes: string[] = [];
  let nextId = 0;
  const nextName = () => `"corpusCandidateNode${nextId++}"`;
  const eligible = `d."visibility" = ANY($1::text[]) AND d."status" = 'INDEXED' AND ${scopePredicate}`;
  const fields: Record<string, string> = {
    tema: 'd."subtitle"',
    sala: 'd."chamber"',
    tipoFallo: 'd."documentType"',
    tribunalOrigen: 'd."court"',
    expediente: 'd."caseNumber"',
    caratula: 'd."title"',
    actor: `COALESCE(d."metadata"->>'actor', d."metadata"->>'actorPublico', '')`,
    demandado: `COALESCE(d."metadata"->>'demandado', d."metadata"->>'demandadoPublico', '')`,
    objeto: `COALESCE(d."metadata"->>'objeto', '')`,
    magistrados: `COALESCE(d."metadata"->>'magistrados', '')`,
    numeroSentencia: 'd."caseNumber"',
    numeroSumario: 'd."searchText"',
  };
  const addLiteral = (node: SearchLiteralNode) => {
    if (useTokenProjection && !node.field) {
      const normalizedValue = normalizeSearchText(node.value);
      const tokens = [...new Set(normalizedValue.split(/\s+/u).filter(Boolean))];
      if (node.type === 'phrase' && tokens.length > 0) {
        const tokenCandidates = tokens.map((value, tokenIndex) => {
          const name = nextName();
          // The projection keeps punctuation accepted by searchText (for
          // example "753987."). Admit those token variants here; exact phrase
          // verification below rejects candidates that are not true matches.
          // Anchoring the first/last token to the phrase boundary remains a
          // superset of substring matches while avoiding unrelated infixes.
          const tokenPattern = tokens.length > 1 && tokenIndex === 0
            ? `%${escapeLike(value)}`
            : tokens.length > 1 && tokenIndex === tokens.length - 1
              ? `${escapeLike(value)}%`
              : `%${escapeLike(value)}%`;
          values.push(tokenPattern);
          const tokenPredicate = tokens.length > 1 && tokenIndex === tokens.length - 1
            ? `lower(token."token") LIKE $${values.length}`
            : `token."token" ILIKE $${values.length}`;
          ctes.push(`${name} AS MATERIALIZED (
            SELECT token."documentId" AS "id"
              FROM "CorpusSearchToken" token
             WHERE ${tokenPredicate} ESCAPE E'\\\\'
          )`);
          return name;
        });
        const candidateName = nextName();
        ctes.push(`${candidateName} AS MATERIALIZED (
          ${tokenCandidates.map((candidate) => `SELECT "id" FROM ${candidate}`).join(' INTERSECT ')}
        )`);
        const eligibleCandidates = nextName();
        ctes.push(`${eligibleCandidates} AS MATERIALIZED (
          SELECT candidates."id" FROM ${candidateName} candidates
          JOIN "CorpusDocument" d ON d."id" = candidates."id"
          WHERE ${eligible}
        )`);
        if (deferPhraseVerification) return eligibleCandidates;
        const candidateDocuments = nextName();
        ctes.push(`${candidateDocuments} AS MATERIALIZED (
          SELECT d."id", d."searchText" FROM ${eligibleCandidates} candidates
          JOIN "CorpusDocument" d ON d."id" = candidates."id"
        )`);
        const verifiedName = nextName();
        values.push(pattern(node));
        ctes.push(`${verifiedName} AS MATERIALIZED (
          SELECT candidates."id" FROM ${candidateDocuments} candidates
          WHERE candidates."searchText" ILIKE $${values.length} ESCAPE E'\\\\'
        )`);
        return verifiedName;
      }
      if (tokens.length === 1 && node.type === 'term' && node.matchMode === 'prefix') {
        const name = nextName();
        values.push(`${escapeLike(tokens[0])}%`);
        ctes.push(`${name} AS MATERIALIZED (
          SELECT DISTINCT token."documentId" AS "id"
            FROM "CorpusSearchToken" token
            JOIN "CorpusDocument" d ON d."id" = token."documentId"
           WHERE ${eligible} AND token."token" LIKE $${values.length} ESCAPE E'\\\\'
        )`);
        return name;
      }
      if (tokens.length === 1 && node.type === 'term' && node.matchMode === 'suffix') {
        const name = nextName();
        const reversed = [...tokens[0]].reverse().join('');
        values.push(`${escapeLike(reversed)}%`);
        ctes.push(`${name} AS MATERIALIZED (
          SELECT DISTINCT token."documentId" AS "id"
            FROM "CorpusSearchToken" token
            JOIN "CorpusDocument" d ON d."id" = token."documentId"
           WHERE ${eligible} AND reverse(token."token") LIKE $${values.length} ESCAPE E'\\\\'
        )`);
        return name;
      }
      if (tokens.length === 1) {
        const name = nextName();
        values.push(pattern(node));
        ctes.push(`${name} AS MATERIALIZED (
          SELECT DISTINCT token."documentId" AS "id"
            FROM "CorpusSearchToken" token
            JOIN "CorpusDocument" d ON d."id" = token."documentId"
           WHERE ${eligible} AND token."token" ILIKE $${values.length} ESCAPE E'\\\\'
        )`);
        if (node.type === 'term' && node.matchMode === 'contains' && tokens[0].length >= 3) return name;
        const candidateDocuments = nextName();
        ctes.push(`${candidateDocuments} AS MATERIALIZED (
          SELECT d."id", d."searchText" FROM ${name} candidates
          JOIN "CorpusDocument" d ON d."id" = candidates."id"
          WHERE ${eligible}
        )`);
        const verifiedName = nextName();
        values.push(pattern(node));
        ctes.push(`${verifiedName} AS MATERIALIZED (
          SELECT candidates."id" FROM ${candidateDocuments} candidates
          WHERE candidates."searchText" ILIKE $${values.length} ESCAPE E'\\\\'
        )`);
        return verifiedName;
      }
    }
    const name = nextName();
    values.push(pattern(node));
    const expression = node.field
      ? `translate(lower(coalesce(${fields[node.field]},'')), 'áéíóúü', 'aeiouu')`
      : 'd."searchText"';
    ctes.push(`${name} AS MATERIALIZED (
      SELECT d."id" FROM "CorpusDocument" d
      WHERE ${eligible} AND ${expression} ILIKE $${values.length} ESCAPE E'\\\\'
    )`);
    return name;
  };
  const addUniverse = () => {
    const name = nextName();
    ctes.push(`${name} AS MATERIALIZED (
      SELECT d."id" FROM "CorpusDocument" d WHERE ${eligible}
    )`);
    return name;
  };
  const addNode = (node: SearchNode | null): string => {
    if (!node) return addUniverse();
    switch (node.type) {
      case 'term':
      case 'phrase':
        return addLiteral(node);
      case 'not': {
        const child = addNode(node.operand);
        const universe = addUniverse();
        const name = nextName();
        ctes.push(`${name} AS MATERIALIZED (SELECT "id" FROM ${universe} EXCEPT SELECT "id" FROM ${child})`);
        return name;
      }
      case 'and':
      case 'or': {
        const children = node.operands.map(addNode);
        if (!children.length) return addUniverse();
        const name = nextName();
        const operator = node.type === 'and' ? 'INTERSECT' : 'UNION';
        ctes.push(`${name} AS MATERIALIZED (${children.map((child) => `SELECT "id" FROM ${child}`).join(` ${operator} `)})`);
        return name;
      }
    }
  };
  const root = addNode(query.root);
  ctes.push(`"corpusSearchCandidates" AS MATERIALIZED (SELECT "id" FROM ${root})`);
  return `WITH ${ctes.join(',\n')}`;
}

function allowedVisibility(visibility: SearchContext['visibility']) {
  if (visibility === 'PUBLIC') return ['PUBLIC'];
  if (visibility === 'INTERNAL') return ['PUBLIC', 'INTERNAL'];
  if (visibility === 'ADMIN') return ['PUBLIC', 'INTERNAL', 'RESTRICTED'];
  return [];
}

function snippet(text: string, literals: SearchLiteralNode[]) {
  const compact = (text ?? '').replace(/\s+/gu, ' ').trim();
  if (!compact) return null;
  const normalized = normalizeSearchText(compact);
  let position = -1;
  for (const literal of literals) {
    const found = normalized.indexOf(normalizeSearchText(literal.value));
    if (found >= 0 && (position < 0 || found < position)) position = found;
  }
  if (position < 0) return compact.slice(0, 280);
  // Normalization can contract accents; the small offset difference is harmless for a preview.
  const start = Math.max(0, position - 90);
  const end = Math.min(compact.length, position + 190);
  return `${start ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

export class CorpusSearchSourceAdapter implements SearchSourceAdapter {
  private readonly pool: Pool;
  private readonly candidateStrategy: 'predicate-v1' | 'set-algebra-v2';
  private lastSearchProfile: { countMs: number; resultPageMs: number; combinedCandidatePageMs?: number; candidateStrategy?: string; candidateCount?: number; candidateGenerationCount?: number; windowExpansions?: number; windowSizes?: number[]; exactHitsByWindow?: number[]; stageTimings?: Record<string, number | number[]>; resultRows: number; failedQuery?: 'COUNT' | 'PAGE'; errorCode?: string; errorMessage?: string; queryCount: number; queryFingerprints: string[] } | null = null;
  constructor(databaseUrl = process.env.DATABASE_URL, candidateStrategy: 'predicate-v1' | 'set-algebra-v2' = 'set-algebra-v2') {
    if (!databaseUrl?.trim())
      throw new Error('Se requiere DATABASE_URL para PostgreSQL local.');
    const target = new URL(databaseUrl.trim());
    const migrationFixtureDatabase =
      process.env.BJC_SPRINT121_TEMP_DB_TEST === '1' &&
      target.pathname === '/buscador_juridico_civil_migration_test';
    if (
      target.protocol !== 'postgresql:' ||
      target.hostname !== '127.0.0.1' ||
      target.port !== '55432' ||
      (target.pathname !== '/buscador_juridico_civil_dev' && !migrationFixtureDatabase) ||
      target.username !== 'bjc_dev'
    ) {
      throw new Error(
        'CorpusSearchSourceAdapter sólo admite PostgreSQL DEV loopback.',
      );
    }
    this.pool = new Pool({
      connectionString: databaseUrl.trim(),
      // Corpus is the high-volume source in federated search. A small pool
      // serialized otherwise independent requests under moderate load; keep
      // it bounded below PostgreSQL's default connection budget while
      // allowing the 10-user preproduction gate to run without a queue.
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: searchStatementTimeoutMs(),
    });
    this.candidateStrategy = candidateStrategy;
  }

  getLastSearchProfile() {
    return this.lastSearchProfile
      ? { ...this.lastSearchProfile, resultRows: this.lastSearchProfile.resultRows }
      : null;
  }

  getPoolDiagnostics() {
    const total = this.pool.totalCount;
    const idle = Math.min(this.pool.idleCount, total);
    return {
      total,
      active: Math.max(0, total - idle),
      idle,
      waiting: this.pool.waitingCount,
      max: this.pool.options.max,
    };
  }

  async search(
    query: SearchQueryAst,
    context: SearchContext,
  ): Promise<SearchResultPage> {
    const page = Math.max(1, Math.trunc(context.page ?? 1));
    const pageSize = Math.min(
      500,
      Math.max(1, Math.trunc(context.pageSize ?? 25)),
    );
    if (context.sourceSystems && !context.sourceSystems.includes('CORPUS'))
      return { total: 0, page, pageSize, results: [] };
    this.lastSearchProfile = null;
    const resultPageStartedAt = performance.now();
    let useTokenProjection = false;
    let readinessQueryCount = 0;
    let readinessMs = 0;
    if (this.candidateStrategy === 'set-algebra-v2') {
      readinessQueryCount = 1;
      const readinessStartedAt = performance.now();
      try {
        const readiness = await this.pool.query<{ isReady: boolean }>(
          `SELECT "isReady" FROM "CorpusSearchTokenProjectionControl" WHERE "singleton" = TRUE`,
        );
        useTokenProjection = readiness.rows[0]?.isReady === true;
      } catch (error) {
        if ((error as { code?: string })?.code !== '42P01') throw error;
      } finally {
        readinessMs = performance.now() - readinessStartedAt;
      }
    }
    const documentScopeValue: unknown = context.documentScope;
    const documentScope = typeof documentScopeValue === 'object' && documentScopeValue !== null
      ? documentScopeValue as { kind?: unknown; workspaceId?: unknown; folderId?: unknown }
      : undefined;
    const isWorkspaceScope = documentScope?.kind === 'WORKSPACE';
    const workspaceId = isWorkspaceScope && typeof documentScope.workspaceId === 'string'
      ? documentScope.workspaceId
      : null;
    const folderId = isWorkspaceScope ? documentScope.folderId : undefined;
    const workspaceFolderId = typeof folderId === 'string' || folderId === null ? folderId : undefined;
    const hasWorkspaceFolderScope = Boolean(isWorkspaceScope && documentScope && Object.prototype.hasOwnProperty.call(documentScope, 'folderId') && (typeof workspaceFolderId === 'string' || workspaceFolderId === null));
    const workspaceScope = workspaceId !== null;
    const values: SqlValue[] = [allowedVisibility(context.visibility)];
    if (workspaceId) values.push(workspaceId);
    if (typeof workspaceFolderId === 'string') values.push(workspaceFolderId);
    const scopePredicate = workspaceId
      ? `d."documentScope" = 'PRIVATE_WORKSPACE' AND EXISTS (SELECT 1 FROM "WorkspaceDocument" workspaceDocument WHERE workspaceDocument."documentId" = d."id" AND workspaceDocument."workspaceId" = $2${hasWorkspaceFolderScope ? (workspaceFolderId === null ? ' AND workspaceDocument."folderId" IS NULL' : ' AND workspaceDocument."folderId" = $3') : ''})`
      : `d."documentScope" = 'GENERAL'`;
    const shortTermWindow = useTokenProjection && query.root?.type === 'term' && !query.root.field &&
      query.root.matchMode === 'contains' && [...normalizeSearchText(query.root.value)].length < 3;
    const deferredSinglePhrase = useTokenProjection && query.root?.type === 'phrase';
    const candidateValuesStart = values.length + 1;
    const candidateBuildStartedAt = performance.now();
    const candidateCte = this.candidateStrategy === 'set-algebra-v2' && !shortTermWindow
      ? buildBooleanCandidateCte(query, values, useTokenProjection, deferredSinglePhrase, scopePredicate)
      : null;
    const candidateValuesEnd = candidateCte ? values.length : values.length - 1;
    const candidateBuildMs = performance.now() - candidateBuildStartedAt;
    const activeCandidateStrategy = this.candidateStrategy === 'predicate-v1'
      ? 'predicate-v1'
      : useTokenProjection ? (shortTermWindow ? 'token-projection-short-window-v2' : deferredSinglePhrase ? 'token-projection-phrase-boundary-materialized-v5' : 'token-projection-v2') : 'document-text-fallback-v2';
    const boundedCandidatePage = this.candidateStrategy === 'set-algebra-v2';
    const predicates = [
      `d."visibility" = ANY($1::text[])`,
      `d."status" = 'INDEXED'`,
      scopePredicate,
    ];
    if (shortTermWindow && query.root?.type === 'term') {
      values.push(pattern(query.root));
      predicates.push(`EXISTS (SELECT 1 FROM "CorpusSearchToken" token WHERE token."documentId" = d."id" AND token."token" ILIKE $${values.length} ESCAPE E'\\\\')`);
    } else if (!candidateCte) predicates.push(`(${compileNode(query.root, values)})`);
    if (context.filters?.sala) {
      values.push(context.filters.sala);
      predicates.push(`d."chamber" = $${values.length}`);
    }
    if (context.filters?.fechaDesde) {
      values.push(context.filters.fechaDesde);
      predicates.push(`d."decisionDate" >= $${values.length}::date`);
    }
    if (context.filters?.fechaHastaExclusive) {
      values.push(context.filters.fechaHastaExclusive);
      predicates.push(`d."decisionDate" < $${values.length}::date`);
    }
    const structured: Array<
      [keyof NonNullable<SearchContext['filters']>, string]
    > = [
      ['expediente', 'd."caseNumber"'],
      ['numeroSentencia', 'd."caseNumber"'],
      ['caratula', 'd."title"'],
      ['tribunalOrigen', 'd."court"'],
      ['tipoFallo', 'd."documentType"'],
      ['instance', 'd."instance"'],
    ];
    for (const [key, column] of structured) {
      const value = context.filters?.[key];
      if (value) {
        values.push(`%${escapeLike(normalizeSearchText(value))}%`);
        predicates.push(
          `translate(lower(coalesce(${column},'')), 'áéíóúü', 'aeiouu') ILIKE $${values.length} ESCAPE E'\\\\'`,
        );
      }
    }
    if (context.filters?.digestoCollectionId) {
      values.push(context.filters.digestoCollectionId);
      predicates.push(`EXISTS (SELECT 1 FROM "DigestoCollectionMembership" m WHERE m."documentId" = d."id" AND m."collectionId" = $${values.length})`);
    }
    if (context.filters?.digestoTopicId) {
      values.push(context.filters.digestoTopicId);
      predicates.push(`EXISTS (SELECT 1 FROM "CorpusDocumentTopic" dt JOIN "DigestoTopic" t ON t."id" = dt."topicId" WHERE dt."documentId" = d."id" AND dt."topicId" = $${values.length} AND t."active" = true)`);
    }
    if (context.filters?.digestoTagId) {
      values.push(context.filters.digestoTagId);
      predicates.push(`EXISTS (SELECT 1 FROM "CorpusDocumentTag" dt WHERE dt."documentId" = d."id" AND dt."tagId" = $${values.length})`);
    }
    const exactPhraseVerification = deferredSinglePhrase ? compileNode(query.root, values) : null;
    const where = predicates.join(' AND ');
    const queryFingerprints = [
      queryFingerprint(`${candidateCte ? 'CANDIDATE_SET_V2' : 'COUNT_V1'}|${where}`),
      queryFingerprint(`${candidateCte ? 'COMBINED_PAGE_V2' : 'PAGE_V1'}|${where}|pagePatterns|pageSize|offset|snippet|digesto|provenance`),
    ];
    let countMs = 0;
    let failedQuery: 'COUNT' | 'PAGE' | undefined;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    const literals: SearchLiteralNode[] = [];
    visitSearchLiterals(query.root, (literal, negated) => {
      if (!negated) literals.push(literal);
    });
    const pagePatterns = literals.map(pattern);
    const offsetValue = (page - 1) * pageSize;
    const rowValues = [
      ...values,
      pagePatterns,
      pageSize,
      offsetValue,
    ];
    const limit = `$${rowValues.length - 1}`;
    const offset = `$${rowValues.length}`;
    let rows: QueryResult<SearchRow>;
    let total = 0;
    let queryCount = readinessQueryCount + 1;
    let workspaceTermTotalExact = false;
    let phraseCandidateCount: number | undefined;
    let pageSnippetHydrationMs = 0;
    let responseMappingMs = 0;
    const windowSizes: number[] = [];
    const exactHitsByWindow: number[] = [];
    try {
      if (boundedCandidatePage) {
        while (true) {
          const initialProbeLimit = Math.max(100, (offsetValue + pageSize + 1) * 4);
          const initialProbe = `$${rowValues.length + 1}`;
          const pagePatternsParam = `$${values.length + 1}`;
          const candidateWindowCtes = deferredSinglePhrase
            ? `"phraseCandidateStats" AS MATERIALIZED (
                 SELECT count(*)::integer AS "candidateCount",
                        COALESCE(array_agg(d."id" ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id"), ARRAY[]::text[]) AS "candidateIds"
                   FROM "corpusSearchCandidates" c JOIN "CorpusDocument" d ON d."id"=c."id"
                  WHERE ${where}
               ),
               "phraseWindowScan"("examined", "verifiedCount", "matchedIds", "windowSizes", "exactHitsByWindow") AS (
                 SELECT LEAST(stats."candidateCount", ${initialProbe}::integer),
                        batch."hitCount", batch."matchedIds",
                        ARRAY[LEAST(stats."candidateCount", ${initialProbe}::integer)], ARRAY[batch."hitCount"]
                   FROM "phraseCandidateStats" stats
                   CROSS JOIN LATERAL (
                     SELECT count(*)::integer AS "hitCount",
                            COALESCE(array_agg(candidate."id" ORDER BY candidate."ordinal"), ARRAY[]::text[]) AS "matchedIds"
                       FROM unnest(stats."candidateIds"[1:${initialProbe}::integer]) WITH ORDINALITY candidate("id", "ordinal")
                       JOIN "CorpusDocument" d ON d."id"=candidate."id"
                      WHERE ${exactPhraseVerification}
                   ) batch
                 UNION ALL
                 SELECT LEAST(stats."candidateCount", scan."examined" * 2),
                        scan."verifiedCount" + batch."hitCount",
                        scan."matchedIds" || batch."matchedIds",
                        scan."windowSizes" || LEAST(stats."candidateCount", scan."examined" * 2),
                        scan."exactHitsByWindow" || (scan."verifiedCount" + batch."hitCount")
                   FROM "phraseWindowScan" scan
                   CROSS JOIN "phraseCandidateStats" stats
                   CROSS JOIN LATERAL (
                     SELECT count(*)::integer AS "hitCount",
                            COALESCE(array_agg(candidate."id" ORDER BY candidate."ordinal"), ARRAY[]::text[]) AS "matchedIds"
                       FROM unnest(stats."candidateIds"[scan."examined" + 1:LEAST(stats."candidateCount", scan."examined" * 2)]) WITH ORDINALITY candidate("id", "ordinal")
                       JOIN "CorpusDocument" d ON d."id"=candidate."id"
                        AND ${exactPhraseVerification}
                   ) batch
                  WHERE scan."verifiedCount" <= ${offset}::integer + ${limit}::integer
                    AND scan."examined" < stats."candidateCount"
               ),
               "phraseFinal" AS MATERIALIZED (
                 SELECT * FROM "phraseWindowScan" ORDER BY "examined" DESC LIMIT 1
               ),
               "candidateWindow" AS MATERIALIZED (
                 SELECT d."id", d."decisionDate", d."updatedAt", matched."matchOrdinal" AS "ordinal"
                   FROM "phraseFinal" final
                   CROSS JOIN LATERAL unnest(final."matchedIds") WITH ORDINALITY matched("id", "matchOrdinal")
                   JOIN "CorpusDocument" d ON d."id"=matched."id"
                  ORDER BY matched."matchOrdinal"
               ),
               "verifiedCandidates" AS MATERIALIZED (
                 SELECT selected."id", selected."decisionDate", selected."updatedAt", selected."ordinal"
                   FROM "candidateWindow" selected
               ),
               "pageStats" AS MATERIALIZED (
                 SELECT (final."verifiedCount" > ${offset}::integer + ${limit}::integer) AS "hasMore",
                        final."verifiedCount"::text AS "total",
                        (final."examined" >= stats."candidateCount") AS "totalExact",
                        stats."candidateCount"::text AS "candidateCount", final."examined" AS "probeCount",
                        final."windowSizes" AS "candidateWindowSizes", final."exactHitsByWindow"
                   FROM "phraseFinal" final CROSS JOIN "phraseCandidateStats" stats
               ),
               "pagedCandidates" AS (
                 SELECT selected."id", selected."decisionDate", selected."updatedAt", selected."ordinal"
                   FROM "verifiedCandidates" selected
                  ORDER BY selected."ordinal"
                  LIMIT (${limit} + 1) OFFSET ${offset}
               )`
            : `"candidateWindow" AS MATERIALIZED (
                 SELECT d."id", d."decisionDate", d."updatedAt"
                   FROM ${candidateCte ? '"corpusSearchCandidates" c JOIN "CorpusDocument" d ON d."id" = c."id"' : '"CorpusDocument" d'}
                  WHERE ${where}
                  ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id"
                  LIMIT (${limit} + 1) OFFSET ${offset}
               ),
               "pageStats" AS (
                 SELECT (count(*) > ${limit}) AS "hasMore", (count(*) + ${offset})::text AS "total",
                        true AS "totalExact", NULL::text AS "candidateCount", 0::integer AS "probeCount"
                   FROM "candidateWindow"
               ),
               "pagedCandidates" AS (
                 SELECT matches."id", matches."decisionDate", matches."updatedAt"
                   FROM "candidateWindow" matches
                  ORDER BY matches."decisionDate" DESC NULLS LAST, matches."updatedAt" DESC, matches."id"
                  LIMIT ${limit}
               )`;
          const phraseValues: SqlValue[] = deferredSinglePhrase
            ? [...rowValues, initialProbeLimit]
            : rowValues;
          try {
            const phraseSqlStartedAt = performance.now();
            rows = await this.pool.query<SearchRow>(
              `${candidateCte ? `${deferredSinglePhrase ? candidateCte.replace(/^WITH\s+/u, 'WITH RECURSIVE ') : candidateCte},` : 'WITH'} ${candidateWindowCtes}
               SELECT d."id", d."title", d."subtitle", d."decisionDate", d."documentType", d."jurisdiction",
                      d."court", d."chamber", d."instance", d."caseNumber", d."visibility", d."searchText",
                      stats."total", stats."hasMore", stats."totalExact", stats."candidateCount", stats."probeCount",
                      ${deferredSinglePhrase ? 'stats."candidateWindowSizes", stats."exactHitsByWindow",' : ''}
                      COALESCE(e."text", '') AS "extractedText", f."id" AS "fileId", f."mimeType" AS "fileMimeType",
                      f."sha256" AS "checksum", f."originalFilename" AS "filename", src."code" AS "sourceCode",
                      ing."externalId", ing."sourceReference",
                      ARRAY(SELECT link."targetId" FROM "CorpusDocumentLink" link WHERE link."documentId"=d."id" AND link."targetDomain"='JURISPRUDENCIA') AS "linkedResultIds",
                      (SELECT string_agg(c."name", ' · ' ORDER BY c."name") FROM "DigestoCollectionMembership" m JOIN "DigestoCollection" c ON c."id"=m."collectionId" WHERE m."documentId"=d."id" AND c."status"='ACTIVE') AS "digestoCollections",
                      (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTopic" dt JOIN "DigestoTopic" t ON t."id"=dt."topicId" WHERE dt."documentId"=d."id" AND t."active"=true) AS "digestoTopics",
                      (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTag" dt JOIN "DigestoTag" t ON t."id"=dt."tagId" WHERE dt."documentId"=d."id") AS "digestoTags",
                      (SELECT p."pageNumber" FROM "CorpusDocumentPage" p WHERE p."extractionId"=e."id" AND cardinality(${pagePatternsParam}::text[])>0 AND translate(lower(p."text"), 'áéíóúü', 'aeiouu') ILIKE ANY(${pagePatternsParam}::text[]) ORDER BY p."pageNumber" LIMIT 1) AS "matchedPage"
                 FROM ${deferredSinglePhrase ? '"pageStats" stats LEFT JOIN "pagedCandidates" selected ON TRUE LEFT JOIN "CorpusDocument" d ON d."id"=selected."id"' : '"pagedCandidates" selected CROSS JOIN "pageStats" stats JOIN "CorpusDocument" d ON d."id"=selected."id"'}
                 LEFT JOIN "CorpusExtraction" e ON e."id"=d."latestExtractionId"
                 LEFT JOIN LATERAL (SELECT cf.* FROM "CorpusDocumentFile" cf WHERE cf."documentId"=d."id" ORDER BY cf."version" DESC LIMIT 1) f ON TRUE
                 LEFT JOIN LATERAL (SELECT ci.* FROM "CorpusIngestionRecord" ci WHERE ci."documentId"=d."id" ORDER BY ci."ingestedAt" DESC LIMIT 1) ing ON TRUE
                 LEFT JOIN "CorpusSourceSystem" src ON src."id"=ing."sourceSystemId"
                ORDER BY selected."decisionDate" DESC NULLS LAST, selected."updatedAt" DESC, selected."id"`,
              phraseValues,
            );
            if (deferredSinglePhrase) pageSnippetHydrationMs = performance.now() - phraseSqlStartedAt;
          } catch (error) {
          failedQuery = 'PAGE';
          errorCode = (error as { code?: string })?.code;
          errorMessage = (error as { message?: string })?.message;
          throw error;
          }
          if (!deferredSinglePhrase) break;
          phraseCandidateCount = Number(rows.rows[0]?.candidateCount ?? 0);
          windowSizes.push(...(rows.rows[0]?.candidateWindowSizes ?? []));
          exactHitsByWindow.push(...(rows.rows[0]?.exactHitsByWindow ?? []));
          break;
        }
        total = Number(rows.rows[0]?.total ?? (page - 1) * pageSize);
      } else {
        const countStartedAt = performance.now();
        const countPromise = this.pool.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM "CorpusDocument" d WHERE ${where}`,
          values,
        ).then((result) => {
          countMs = performance.now() - countStartedAt;
          return result;
        }).catch((error: unknown) => {
          countMs = performance.now() - countStartedAt;
          failedQuery = 'COUNT';
          errorCode = (error as { code?: string })?.code;
          errorMessage = (error as { message?: string })?.message;
          throw error;
        });
        const legacyRows = this.pool.query<SearchRow>(
          `WITH "pageDocs" AS (
             SELECT d."id", d."decisionDate", d."updatedAt"
               FROM "CorpusDocument" d WHERE ${where}
              ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id"
              LIMIT ${limit} OFFSET ${offset}
           )
           SELECT d."id", d."title", d."subtitle", d."decisionDate", d."documentType", d."jurisdiction",
                  d."court", d."chamber", d."instance", d."caseNumber", d."visibility", d."searchText",
                  ''::text AS "total", false AS "hasMore", COALESCE(e."text", '') AS "extractedText", f."id" AS "fileId", f."mimeType" AS "fileMimeType",
                  f."sha256" AS "checksum", f."originalFilename" AS "filename", src."code" AS "sourceCode",
                  ing."externalId", ing."sourceReference",
                  ARRAY(SELECT link."targetId" FROM "CorpusDocumentLink" link WHERE link."documentId" = d."id" AND link."targetDomain" = 'JURISPRUDENCIA') AS "linkedResultIds",
                  (SELECT string_agg(c."name", ' · ' ORDER BY c."name") FROM "DigestoCollectionMembership" m JOIN "DigestoCollection" c ON c."id" = m."collectionId" WHERE m."documentId" = d."id" AND c."status" = 'ACTIVE') AS "digestoCollections",
                  (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTopic" dt JOIN "DigestoTopic" t ON t."id" = dt."topicId" WHERE dt."documentId" = d."id" AND t."active" = true) AS "digestoTopics",
                  (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTag" dt JOIN "DigestoTag" t ON t."id" = dt."tagId" WHERE dt."documentId" = d."id") AS "digestoTags",
                  (SELECT p."pageNumber" FROM "CorpusDocumentPage" p WHERE p."extractionId" = e."id" AND cardinality($${values.length + 1}::text[]) > 0 AND translate(lower(p."text"), 'áéíóúü', 'aeiouu') ILIKE ANY($${values.length + 1}::text[]) ORDER BY p."pageNumber" LIMIT 1) AS "matchedPage"
             FROM "pageDocs" selected JOIN "CorpusDocument" d ON d."id" = selected."id"
             LEFT JOIN "CorpusExtraction" e ON e."id" = d."latestExtractionId"
             LEFT JOIN LATERAL (SELECT cf.* FROM "CorpusDocumentFile" cf WHERE cf."documentId" = d."id" ORDER BY cf."version" DESC LIMIT 1) f ON TRUE
             LEFT JOIN LATERAL (SELECT ci.* FROM "CorpusIngestionRecord" ci WHERE ci."documentId" = d."id" ORDER BY ci."ingestedAt" DESC LIMIT 1) ing ON TRUE
             LEFT JOIN "CorpusSourceSystem" src ON src."id" = ing."sourceSystemId"
            ORDER BY selected."decisionDate" DESC NULLS LAST, selected."updatedAt" DESC, selected."id"`,
          rowValues,
        ).catch((error: unknown) => {
          failedQuery = failedQuery ?? 'PAGE';
          errorCode = errorCode ?? (error as { code?: string })?.code;
          errorMessage = errorMessage ?? (error as { message?: string })?.message;
          throw error;
        });
        const [count, oldRows] = await Promise.all([countPromise, legacyRows]);
        rows = oldRows;
        total = Number(count.rows[0]?.total ?? 0);
        queryCount = 2;
      }
      if (workspaceScope && query.root?.type === 'term' && boundedCandidatePage) {
        const exactValues = [...values];
        const exactQueryPredicate = compileNode(query.root, exactValues);
        const candidateParameterTypeChecks = Array.from(
          { length: Math.max(0, candidateValuesEnd - candidateValuesStart + 1) },
          (_, index) => `$${candidateValuesStart + index}::text IS NOT NULL`,
        ).join(' AND ');
        const exactCountStartedAt = performance.now();
        try {
          const exactCount = await this.pool.query<{ total: string }>(
            `SELECT COUNT(*)::text AS total FROM "CorpusDocument" d WHERE ${where} AND (${exactQueryPredicate})${candidateParameterTypeChecks ? ` AND ${candidateParameterTypeChecks}` : ''}`,
            exactValues,
          );
          total = Number(exactCount.rows[0]?.total ?? 0);
          workspaceTermTotalExact = true;
          countMs += performance.now() - exactCountStartedAt;
          queryCount += 1;
        } catch (error) {
          countMs += performance.now() - exactCountStartedAt;
          failedQuery = 'COUNT';
          errorCode = (error as { code?: string })?.code;
          errorMessage = (error as { message?: string })?.message;
          throw error;
        }
      }
    } catch (error) {
      failedQuery = failedQuery ?? 'PAGE';
      errorCode = errorCode ?? (error as { code?: string })?.code;
      errorMessage = errorMessage ?? (error as { message?: string })?.message;
        this.lastSearchProfile = {
        countMs: Math.round(countMs * 100) / 100,
        resultPageMs: Math.round((performance.now() - resultPageStartedAt) * 100) / 100,
        candidateStrategy: activeCandidateStrategy,
        resultRows: 0,
        failedQuery,
        errorCode,
        errorMessage,
          queryCount,
          queryFingerprints,
          ...(deferredSinglePhrase ? { candidateCount: phraseCandidateCount, candidateGenerationCount: 1, windowExpansions: Math.max(0, windowSizes.length - 1), windowSizes, exactHitsByWindow } : {}),
          stageTimings: {
            readinessMs, candidateBuildMs,
            candidateGenerationIntersectionsEligibilityExactCountPageAndSnippetSqlMs: pageSnippetHydrationMs,
            responseMappingMs, totalAdapterMs: performance.now() - resultPageStartedAt,
          },
      };
      throw error;
    }
    const resultPageMs = performance.now() - resultPageStartedAt;
    const hydratedRows = rows.rows.filter((row): row is SearchRow & { id: string } => row.id !== null);
    const hasMore = boundedCandidatePage
      ? Boolean(rows.rows[0]?.hasMore)
      : false;
    const totalExact = workspaceTermTotalExact || (boundedCandidatePage
        ? (deferredSinglePhrase ? Boolean(rows.rows[0]?.totalExact) : (rows.rows.length === 0 ? page === 1 : !hasMore))
        : true);
    const mappingStartedAt = performance.now();
    const mappedResults = hydratedRows.map(
      (row): SearchResult => ({
        id: `CORPUS:DOCUMENT:${row.id}`,
        sourceSystem: 'CORPUS',
        sourceType: 'DOCUMENTO',
        sourceId: row.id,
        title: row.title,
        subtitle: row.subtitle,
        date: row.decisionDate?.toISOString() ?? null,
        snippet: snippet(row.extractedText || row.searchText, literals),
        matchedFields: ['documentText'],
        score: 1,
        metadata: {
          documentType: row.documentType,
          jurisdiction: row.jurisdiction,
          court: row.court,
          chamber: row.chamber,
          instance: row.instance,
          caseNumber: row.caseNumber,
          sourceCode: row.sourceCode,
          externalId: row.externalId,
          sourceReference: row.sourceReference,
          checksum: row.checksum,
          filename: row.filename,
          fileId: row.fileId,
          pageNumber: row.matchedPage,
          digestoCollections: row.digestoCollections,
          digestoTopics: row.digestoTopics,
          digestoTags: row.digestoTags,
        },
        linkedResultIds: row.linkedResultIds ?? [],
        visibility: row.visibility as SearchResult['visibility'],
        document: {
          href: workspaceScope
            ? `/api/workspaces/${workspaceId}/documents/${row.id}/file`
            : row.visibility === 'PUBLIC'
            ? `/api/public/corpus/documents/${row.id}/file`
            : `/api/corpus/documents/${row.id}/file`,
          mimeType: row.fileMimeType,
        },
      }),
    );
    responseMappingMs = performance.now() - mappingStartedAt;
    this.lastSearchProfile = {
      countMs, resultPageMs, ...(candidateCte ? { combinedCandidatePageMs: resultPageMs } : {}),
      candidateStrategy: activeCandidateStrategy, resultRows: hydratedRows.length, queryCount, queryFingerprints,
      ...(deferredSinglePhrase ? { candidateCount: phraseCandidateCount, candidateGenerationCount: 1, windowExpansions: Math.max(0, windowSizes.length - 1), windowSizes, exactHitsByWindow } : {}),
      stageTimings: {
        readinessMs, candidateBuildMs,
        candidateGenerationIntersectionsEligibilityExactCountPageAndSnippetSqlMs: pageSnippetHydrationMs,
        responseMappingMs, totalAdapterMs: performance.now() - resultPageStartedAt,
      },
    };
    return {
      total,
      totalExact,
      hasMore,
      page,
      pageSize,
      results: mappedResults,
    };
  }

  async close() {
    await this.pool.end();
  }
}

function queryFingerprint(template: string) {
  return createHash('sha256').update(template.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16);
}

function searchStatementTimeoutMs() {
  const configured = Number(process.env.BJC_SEARCH_STATEMENT_TIMEOUT_MS ?? 4000);
  return Number.isInteger(configured) && configured >= 500 && configured <= 4500
    ? configured
    : 4000;
}
