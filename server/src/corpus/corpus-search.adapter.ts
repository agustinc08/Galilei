/* eslint prettier/prettier: off -- Keep unrelated Search SQL formatting out of this workspace change. */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import {
  resolveSearchDatabasePoolConfig,
  type ApprovedRuntimePgConfig,
} from '../config/runtime-database-config';
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
import {
  mimeTypesForCorpusTypes,
  validateCorpusTypes,
  validateSearchDateRange,
} from '../busqueda/utils/search-filters';

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
  snippetSource?: string;
  searchText?: string;
  snippetText?: string | null;
  fileId: string | null;
  fileMimeType: string | null;
  checksum: string | null;
  filename: string | null;
  sourceCode: string | null;
  externalId: string | null;
  sourceReference: string | null;
  matchedPage: number | null;
  matchedPageText?: string | null;
  matchedPageTextKind?: string | null;
  matchedPageProcessingStatus?: string | null;
  matchedPageCount?: number | null;
  activeExtractionStatus?: string | null;
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

function pageMatchSource(row: SearchRow): 'PDF_TEXT' | 'OCR_APPROVED' | null {
  if (
    !Number.isInteger(row.matchedPage) ||
    (row.matchedPage ?? 0) < 1 ||
    !row.matchedPageText
  )
    return null;
  if (row.matchedPageTextKind === 'NATIVE') return 'PDF_TEXT';
  if (
    row.matchedPageTextKind === 'OCR' &&
    row.activeExtractionStatus === 'OCR_HUMAN_APPROVED' &&
    row.matchedPageProcessingStatus === 'OCR_HUMAN_APPROVED'
  )
    return 'OCR_APPROVED';
  return null;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, '\\$&');
}
function pattern(literal: SearchLiteralNode) {
  const value = escapeLike(normalizeSearchText(literal.value));
  if (literal.type === 'phrase') return `%${value}%`;
  if (literal.matchMode === 'prefix') return `% ${value}%`;
  if (literal.matchMode === 'suffix') return `%${value} %`;
  return `%${value}%`;
}

function patternColumn(expression: string, literal: SearchLiteralNode) {
  if (
    literal.type === 'term' &&
    (literal.matchMode === 'prefix' || literal.matchMode === 'suffix')
  ) {
    return `(' ' || COALESCE(${expression}, '') || ' ')`;
  }
  return expression;
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
    return `${patternColumn(normalizedColumn, node)} ILIKE $${values.length} ESCAPE E'\\\\'`;
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
  const eligible = `d."visibility" = ANY($1::text[]) AND d."status" IN ('INDEXED', 'OCR_REQUIRED') AND ${scopePredicate}`;
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
      const tokens = [
        ...new Set(normalizedValue.split(/\s+/u).filter(Boolean)),
      ];
      if (node.type === 'phrase' && tokens.length > 0) {
        // Intersect every indexable phrase token. A single common-word anchor
        // can leave most of the corpus to verify; retaining substring
        // predicates keeps this candidate set a superset of ILIKE phrase
        // matches (the complete phrase predicate below remains authoritative).
        const selectiveTokenIndexes = tokens
          .map((value, index) => ({ value, index }))
          .filter(({ value }) => [...value].length >= 3)
          .map(({ index }) => index);
        const tokenIndexes =
          selectiveTokenIndexes.length > 0
            ? selectiveTokenIndexes
            : [
                tokens.reduce(
                  (best, value, index, candidates) =>
                    [...value].length > [...candidates[best]].length
                      ? index
                      : best,
                  0,
                ),
              ];
        const tokenCandidates = tokenIndexes.map((tokenIndex) => {
          const value = tokens[tokenIndex];
          const name = nextName();
          values.push(`%${escapeLike(value)}%`);
          ctes.push(`${name} AS MATERIALIZED (
            SELECT token."documentId" AS "id"
              FROM "CorpusSearchToken" token
             WHERE token."token" ILIKE $${values.length} ESCAPE E'\\\\'
          )`);
          return name;
        });
        const candidateName = nextName();
        ctes.push(`${candidateName} AS MATERIALIZED (
          SELECT DISTINCT "id" FROM (
            ${tokenCandidates.map((candidate) => `SELECT "id" FROM ${candidate}`).join(' INTERSECT ')}
          ) uniquePhraseCandidates
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
      if (
        tokens.length === 1 &&
        node.type === 'term' &&
        node.matchMode === 'prefix'
      ) {
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
      if (
        tokens.length === 1 &&
        node.type === 'term' &&
        node.matchMode === 'suffix'
      ) {
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
        if (
          node.type === 'term' &&
          node.matchMode === 'contains' &&
          tokens[0].length >= 3
        )
          return name;
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
    const matchingColumn = patternColumn(expression, node);
    ctes.push(`${name} AS MATERIALIZED (
      SELECT d."id" FROM "CorpusDocument" d
      WHERE ${eligible} AND ${matchingColumn} ILIKE $${values.length} ESCAPE E'\\\\'
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
        ctes.push(
          `${name} AS MATERIALIZED (SELECT "id" FROM ${universe} EXCEPT SELECT "id" FROM ${child})`,
        );
        return name;
      }
      case 'and':
      case 'or': {
        const children = node.operands.map(addNode);
        if (!children.length) return addUniverse();
        const name = nextName();
        const operator = node.type === 'and' ? 'INTERSECT' : 'UNION';
        ctes.push(
          `${name} AS MATERIALIZED (${children.map((child) => `SELECT "id" FROM ${child}`).join(` ${operator} `)})`,
        );
        return name;
      }
    }
  };
  const root = addNode(query.root);
  ctes.push(
    `"corpusSearchCandidates" AS MATERIALIZED (SELECT "id" FROM ${root})`,
  );
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
  if (literals.length === 1 && literals[0].type === 'phrase') {
    const rawLiteral = literals[0].value;
    const normalizedLiteral = normalizeSearchText(rawLiteral);
    if (
      /^[\x20-\x7e]+$/u.test(rawLiteral) &&
      rawLiteral.toLowerCase() === normalizedLiteral
    ) {
      const escaped = normalizedLiteral.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const directMatch = new RegExp(escaped, 'iu').exec(compact);
      if (directMatch?.index !== undefined) {
        const start = Math.max(0, directMatch.index - 90);
        const end = Math.min(compact.length, directMatch.index + 190);
        return `${start ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
      }
    }
  }
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
  private lastSearchProfile: {
    countMs: number;
    pageQueryMs: number;
    resultPageMs: number;
    combinedCandidatePageMs?: number;
    candidateStrategy?: string;
    candidateCount?: number;
    candidateGenerationCount?: number;
    windowExpansions?: number;
    windowSizes?: number[];
    exactHitsByWindow?: number[];
    stageTimings?: Record<string, number | number[]>;
    resultRows: number;
    failedQuery?: 'COUNT' | 'PAGE';
    errorCode?: string;
    errorMessage?: string;
    queryCount: number;
    queryFingerprints: string[];
  } | null = null;
  constructor(
    databaseConfig?: string | ApprovedRuntimePgConfig,
    candidateStrategy: 'predicate-v1' | 'set-algebra-v2' = 'set-algebra-v2',
  ) {
    this.pool = new Pool({
      ...resolveSearchDatabasePoolConfig(databaseConfig),
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
      ? {
          ...this.lastSearchProfile,
          resultRows: this.lastSearchProfile.resultRows,
        }
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
    candidateDocumentIds?: string[],
  ): Promise<SearchResultPage> {
    const page = Math.max(1, Math.trunc(context.page ?? 1));
    const pageSize = Math.min(
      500,
      Math.max(1, Math.trunc(context.pageSize ?? 25)),
    );
    if (context.sourceSystems && !context.sourceSystems.includes('CORPUS'))
      return { total: 0, page, pageSize, results: [] };
    if (candidateDocumentIds && candidateDocumentIds.length === 0) {
      return {
        total: 0,
        totalExact: true,
        hasMore: false,
        page,
        pageSize,
        results: [],
      };
    }
    this.lastSearchProfile = null;
    const resultPageStartedAt = performance.now();
    let useTokenProjection = false;
    let readinessQueryCount = 0;
    let readinessMs = 0;
    if (this.candidateStrategy === 'set-algebra-v2' && !candidateDocumentIds) {
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
    const documentScope =
      typeof documentScopeValue === 'object' && documentScopeValue !== null
        ? (documentScopeValue as {
            kind?: unknown;
            workspaceId?: unknown;
            userId?: unknown;
            folderId?: unknown;
            sourceId?: unknown;
            sourceFolder?: unknown;
          })
        : undefined;
    const isWorkspaceScope = documentScope?.kind === 'WORKSPACE';
    const isPersonalScope = documentScope?.kind === 'PERSONAL';
    const workspaceId =
      isWorkspaceScope && typeof documentScope.workspaceId === 'string'
        ? documentScope.workspaceId
        : null;
    const userId =
      (isWorkspaceScope || isPersonalScope) &&
      Number.isSafeInteger(documentScope?.userId) &&
      Number(documentScope?.userId) > 0
        ? Number(documentScope?.userId)
        : null;
    const folderId = isWorkspaceScope ? documentScope.folderId : undefined;
    const scopedFolderId = isPersonalScope ? documentScope.folderId : folderId;
    const workspaceFolderId =
      typeof scopedFolderId === 'string' || scopedFolderId === null
        ? scopedFolderId
        : undefined;
    const hasWorkspaceFolderScope = Boolean(
      (isWorkspaceScope || isPersonalScope) &&
      documentScope &&
      Object.prototype.hasOwnProperty.call(documentScope, 'folderId') &&
      (typeof workspaceFolderId === 'string' || workspaceFolderId === null),
    );
    const values: SqlValue[] = [allowedVisibility(context.visibility)];
    if (workspaceId) values.push(workspaceId);
    const workspaceFolderIdIndex =
      typeof workspaceFolderId === 'string'
        ? values.push(workspaceFolderId)
        : null;
    const userIdIndex = userId !== null ? values.push(userId) : null;
    const workspaceScope = workspaceId !== null;
    const personalScope = isPersonalScope && userId !== null;
    const sourceId =
      isWorkspaceScope && typeof documentScope?.sourceId === 'string'
        ? documentScope.sourceId
        : null;
    const sourceFolder =
      isWorkspaceScope && typeof documentScope?.sourceFolder === 'string'
        ? documentScope.sourceFolder
        : null;
    const sourceIdIndex =
      sourceId && sourceId !== '__manual_upload__'
        ? values.push(sourceId)
        : null;
    const sourceFolderIndex = sourceFolder ? values.push(sourceFolder) : null;
    const sourcePredicate =
      sourceId === '__manual_upload__'
        ? ' AND NOT EXISTS (SELECT 1 FROM "SourceFile" sourceFile JOIN "DocumentSource" source ON source."id" = sourceFile."sourceId" WHERE sourceFile."documentId" = d."id" AND source."workspaceId" = $2)'
        : sourceIdIndex
          ? ` AND EXISTS (SELECT 1 FROM "SourceFile" sourceFile JOIN "DocumentSource" source ON source."id" = sourceFile."sourceId" WHERE sourceFile."documentId" = d."id" AND sourceFile."sourceId" = $${sourceIdIndex} AND source."workspaceId" = $2${sourceFolderIndex ? ` AND (sourceFile."normalizedPath" = $${sourceFolderIndex} OR (left(sourceFile."normalizedPath", char_length($${sourceFolderIndex})) = $${sourceFolderIndex} AND substring(sourceFile."normalizedPath" from char_length($${sourceFolderIndex}) + 1 for 1) = E'\\\\'))` : ''})`
          : '';
    const workspaceMembershipAcl = userIdIndex
      ? `EXISTS (
          SELECT 1 FROM "WorkspaceMembership" membership
          JOIN "DocumentWorkspace" activeWorkspace ON activeWorkspace."id" = membership."workspaceId"
          WHERE membership."workspaceId" = $2
            AND membership."userId" = $${userIdIndex}
            AND membership."active" = TRUE AND activeWorkspace."active" = TRUE
        )`
      : 'FALSE';
    const workspaceFolderAcl = userIdIndex
      ? `
        AND (
          workspaceDocument."folderId" IS NULL
          OR workspaceDocument."folderId" IN (
            WITH RECURSIVE folder_chain AS (
              SELECT folder."id" AS "targetId", folder."id" AS "ancestorId",
                     folder."parentId", folder."workspaceId", folder."ownerUserId",
                     folder."visibilityScope", folder."createdById"
                FROM "WorkspaceFolder" folder
               WHERE folder."workspaceId" = $2 AND folder."ownerUserId" IS NULL
              UNION ALL
              SELECT chain."targetId", parent."id", parent."parentId",
                     parent."workspaceId", parent."ownerUserId",
                     parent."visibilityScope", parent."createdById"
                FROM folder_chain chain
                JOIN "WorkspaceFolder" parent ON parent."id" = chain."parentId"
               WHERE parent."workspaceId" = chain."workspaceId"
                 AND parent."ownerUserId" IS NULL
            )
            SELECT chain."targetId"
              FROM folder_chain chain
             GROUP BY chain."targetId"
            HAVING bool_and(
              CASE chain."visibilityScope"::text
                WHEN 'PERSONAL' THEN chain."ownerUserId" = $${userIdIndex}
                WHEN 'RESTRICTED' THEN EXISTS (
                  SELECT 1 FROM "WorkspaceMembership" grant_membership
                   WHERE grant_membership."workspaceId" = chain."workspaceId"
                     AND grant_membership."userId" = $${userIdIndex}
                     AND grant_membership."active" = TRUE
                     AND (
                       grant_membership."role" = 'ADMIN'
                       OR chain."createdById" = grant_membership."userId"
                       OR EXISTS (
                         SELECT 1 FROM "WorkspaceFolderGrant" grant_row
                          WHERE grant_row."folderId" = chain."ancestorId"
                            AND grant_row."membershipId" = grant_membership."id"
                       )
                     )
                )
                ELSE TRUE
              END
            )
          )
        )`
      : ' AND FALSE';
    const personalFolderAcl = userIdIndex
      ? `
        AND NOT EXISTS (
          WITH RECURSIVE folder_chain AS (
            SELECT folder."id" AS "ancestorId", folder."parentId", folder."workspaceId",
                   folder."ownerUserId", folder."visibilityScope"
              FROM "WorkspaceFolder" folder WHERE folder."id" = workspaceDocument."folderId"
            UNION ALL
            SELECT parent."id", parent."parentId", parent."workspaceId",
                   parent."ownerUserId", parent."visibilityScope"
              FROM folder_chain chain JOIN "WorkspaceFolder" parent ON parent."id" = chain."parentId"
             WHERE parent."workspaceId" IS NULL AND parent."ownerUserId" = $${userIdIndex}
          )
          SELECT 1 FROM folder_chain chain
           WHERE chain."ownerUserId" <> $${userIdIndex}
              OR chain."visibilityScope" = 'RESTRICTED'
        )`
      : ' AND FALSE';
    const scopePredicate =
      workspaceId && userIdIndex
        ? `d."documentScope" = 'PRIVATE_WORKSPACE' AND ${workspaceMembershipAcl} AND EXISTS (SELECT 1 FROM "WorkspaceDocument" workspaceDocument WHERE workspaceDocument."documentId" = d."id" AND workspaceDocument."workspaceId" = $2 AND workspaceDocument."ownerUserId" IS NULL${hasWorkspaceFolderScope ? (workspaceFolderId === null ? ' AND workspaceDocument."folderId" IS NULL' : ` AND workspaceDocument."folderId" = $${workspaceFolderIdIndex}`) : ''}${workspaceFolderAcl})${sourcePredicate}`
        : isPersonalScope && userIdIndex
          ? `d."documentScope" = 'PRIVATE_WORKSPACE' AND EXISTS (SELECT 1 FROM "WorkspaceDocument" workspaceDocument WHERE workspaceDocument."documentId" = d."id" AND workspaceDocument."workspaceId" IS NULL AND workspaceDocument."ownerUserId" = $${userIdIndex}${hasWorkspaceFolderScope ? (workspaceFolderId === null ? ' AND workspaceDocument."folderId" IS NULL' : ` AND workspaceDocument."folderId" = $${workspaceFolderIdIndex}`) : ''}${personalFolderAcl})`
          : isWorkspaceScope || isPersonalScope
            ? `FALSE`
            : `d."documentScope" = 'GENERAL'`;
    const dateRange = validateSearchDateRange(
      context.filters?.dateFrom,
      context.filters?.dateTo,
    );
    const types = validateCorpusTypes(context.filters?.types);
    const filterPredicates: string[] = [];
    if (dateRange.dateFrom) {
      values.push(dateRange.dateFrom);
      filterPredicates.push(`d."decisionDate" >= $${values.length}::date`);
    }
    if (dateRange.dateTo) {
      values.push(dateRange.dateTo);
      filterPredicates.push(
        `d."decisionDate" < ($${values.length}::date + INTERVAL '1 day')`,
      );
    }
    if (types) {
      values.push(mimeTypesForCorpusTypes(types));
      filterPredicates.push(`EXISTS (
        SELECT 1 FROM "CorpusDocumentFile" currentFile
         WHERE currentFile."documentId" = d."id"
           AND currentFile."version" = (
             SELECT max(latestFile."version") FROM "CorpusDocumentFile" latestFile
              WHERE latestFile."documentId" = d."id"
           )
           AND lower(btrim(split_part(currentFile."mimeType", ';', 1))) = ANY($${values.length}::text[])
      )`);
    }
    const filterPredicate = filterPredicates.join(' AND ');
    const candidateScopePredicate = filterPredicate
      ? `(${scopePredicate}) AND (${filterPredicate})`
      : scopePredicate;
    const shortTermWindow =
      !candidateDocumentIds &&
      useTokenProjection &&
      query.root?.type === 'term' &&
      !query.root.field &&
      query.root.matchMode === 'contains' &&
      [...normalizeSearchText(query.root.value)].length < 3;
    const deferredSinglePhrase =
      !candidateDocumentIds &&
      useTokenProjection &&
      query.root?.type === 'phrase';
    const candidateValuesStart = values.length + 1;
    const candidateBuildStartedAt = performance.now();
    const candidateCte =
      !candidateDocumentIds &&
      this.candidateStrategy === 'set-algebra-v2' &&
      !shortTermWindow
        ? buildBooleanCandidateCte(
            query,
            values,
            useTokenProjection,
            deferredSinglePhrase,
            candidateScopePredicate,
          )
        : null;
    const candidateValuesEnd = candidateCte ? values.length : values.length - 1;
    const candidateBuildMs = performance.now() - candidateBuildStartedAt;
    const activeCandidateStrategy =
      this.candidateStrategy === 'predicate-v1'
        ? 'predicate-v1'
        : useTokenProjection
          ? shortTermWindow
            ? 'token-projection-short-window-v2'
            : deferredSinglePhrase
              ? 'token-projection-phrase-setwise-exact-v9'
              : 'token-projection-v2'
          : 'document-text-fallback-v2';
    const boundedCandidatePage = this.candidateStrategy === 'set-algebra-v2';
    const predicates = [
      `d."visibility" = ANY($1::text[])`,
      `d."status" IN ('INDEXED', 'OCR_REQUIRED')`,
      scopePredicate,
      ...(filterPredicate ? [filterPredicate] : []),
    ];
    if (candidateDocumentIds) {
      values.push(candidateDocumentIds);
      predicates.push(`d."id" = ANY($${values.length}::text[])`);
    }
    if (shortTermWindow && query.root?.type === 'term') {
      values.push(pattern(query.root));
      predicates.push(
        `EXISTS (SELECT 1 FROM "CorpusSearchToken" token WHERE token."documentId" = d."id" AND token."token" ILIKE $${values.length} ESCAPE E'\\\\')`,
      );
    } else if (!candidateCte && !candidateDocumentIds)
      predicates.push(`(${compileNode(query.root, values)})`);
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
      [
        Exclude<
          keyof NonNullable<SearchContext['filters']>,
          'dateFrom' | 'dateTo' | 'types'
        >,
        string,
      ]
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
      if (typeof value === 'string' && value) {
        values.push(`%${escapeLike(normalizeSearchText(value))}%`);
        predicates.push(
          `translate(lower(coalesce(${column},'')), 'áéíóúü', 'aeiouu') ILIKE $${values.length} ESCAPE E'\\\\'`,
        );
      }
    }
    if (context.filters?.digestoCollectionId) {
      values.push(context.filters.digestoCollectionId);
      predicates.push(
        `EXISTS (SELECT 1 FROM "DigestoCollectionMembership" m WHERE m."documentId" = d."id" AND m."collectionId" = $${values.length})`,
      );
    }
    if (context.filters?.digestoTopicId) {
      values.push(context.filters.digestoTopicId);
      predicates.push(
        `EXISTS (SELECT 1 FROM "CorpusDocumentTopic" dt JOIN "DigestoTopic" t ON t."id" = dt."topicId" WHERE dt."documentId" = d."id" AND dt."topicId" = $${values.length} AND t."active" = true)`,
      );
    }
    if (context.filters?.digestoTagId) {
      values.push(context.filters.digestoTagId);
      predicates.push(
        `EXISTS (SELECT 1 FROM "CorpusDocumentTag" dt WHERE dt."documentId" = d."id" AND dt."tagId" = $${values.length})`,
      );
    }
    const exactPhraseVerification = deferredSinglePhrase
      ? compileNode(query.root, values)
      : null;
    const phraseSnippetParam =
      deferredSinglePhrase && query.root?.type === 'phrase'
        ? `$${values.push(normalizeSearchText(query.root.value))}`
        : null;
    const phraseSnippetSource = `COALESCE(NULLIF(pageMatch."text", ''), NULLIF(d."searchText", ''), '')`;
    const phraseSnippetNormalized = `translate(lower(${phraseSnippetSource}), 'áéíóúü', 'aeiouu')`;
    const phraseSnippetPosition = phraseSnippetParam
      ? `strpos(${phraseSnippetNormalized}, ${phraseSnippetParam})`
      : null;
    const phraseSnippetStart = phraseSnippetPosition
      ? `GREATEST(1, COALESCE(NULLIF(${phraseSnippetPosition}, 0), 1) - 90)`
      : null;
    const phraseSnippetProjection =
      phraseSnippetStart && phraseSnippetPosition
        ? `CASE WHEN ${phraseSnippetSource} = '' THEN NULL ELSE
           (CASE WHEN ${phraseSnippetPosition} > 90 THEN '…' ELSE '' END) ||
           substring(${phraseSnippetSource} FROM ${phraseSnippetStart} FOR 280) ||
           (CASE WHEN ${phraseSnippetStart} + 279 < char_length(${phraseSnippetSource}) THEN '…' ELSE '' END)
         END`
        : null;
    const where = predicates.join(' AND ');
    const queryFingerprints = [
      queryFingerprint(
        `${candidateCte ? 'CANDIDATE_SET_V2' : 'COUNT_V1'}|${where}`,
      ),
      queryFingerprint(
        `${candidateCte ? 'COMBINED_PAGE_V2' : 'PAGE_V1'}|${where}|pagePatterns|pageSize|offset|snippet|digesto|provenance`,
      ),
    ];
    let countMs = 0;
    let pageQueryMs = 0;
    let failedQuery: 'COUNT' | 'PAGE' | undefined;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    const literals: SearchLiteralNode[] = [];
    visitSearchLiterals(query.root, (literal, negated) => {
      if (!negated) literals.push(literal);
    });
    // Only positive, unfielded literals describe a page-text hit. Fielded
    // metadata terms and negated terms must never select an arbitrary page.
    const pagePatterns = literals
      .filter((literal) => !literal.field)
      .map(pattern);
    const offsetValue = (page - 1) * pageSize;
    const rowValues = [...values, pagePatterns, pageSize, offsetValue];
    const limit = `$${rowValues.length - 1}`;
    const offset = `$${rowValues.length}`;
    let rows: QueryResult<SearchRow>;
    let total = 0;
    let queryCount = readinessQueryCount + 1;
    let workspaceTermTotalExact = false;
    let outOfRangeTotalExact = false;
    let phraseCandidateCount: number | undefined;
    let pageSnippetHydrationMs = 0;
    let responseMappingMs = 0;
    const windowSizes: number[] = [];
    const exactHitsByWindow: number[] = [];
    try {
      if (boundedCandidatePage) {
        while (true) {
          const pageQueryStartedAt = performance.now();
          const pagePatternsParam = `$${values.length + 1}`;
          const candidateWindowCtes = deferredSinglePhrase
            ? `"phraseCandidateStats" AS MATERIALIZED (
                 SELECT count(*)::integer AS "candidateCount"
                   FROM "corpusSearchCandidates" c
                   JOIN "CorpusDocument" d ON d."id" = c."id"
                  WHERE ${where}
               ),
               "verifiedCandidates" AS MATERIALIZED (
                 SELECT d."id", d."decisionDate", d."updatedAt"
                   FROM "corpusSearchCandidates" c
                   JOIN "CorpusDocument" d ON d."id" = c."id"
                  WHERE ${where} AND ${exactPhraseVerification}
               ),
               "pageStats" AS MATERIALIZED (
                 SELECT (matches.total > ${offset}::integer + ${limit}::integer) AS "hasMore",
                        matches.total::text AS "total",
                        true AS "totalExact",
                        stats."candidateCount"::text AS "candidateCount", stats."candidateCount" AS "probeCount",
                        ARRAY[stats."candidateCount"] AS "candidateWindowSizes", ARRAY[matches.total] AS "exactHitsByWindow"
                   FROM (SELECT count(*)::integer AS total FROM "verifiedCandidates") matches
                   CROSS JOIN "phraseCandidateStats" stats
               ),
               "pagedCandidates" AS (
                 SELECT selected."id", selected."decisionDate", selected."updatedAt", selected."ordinal"
                   FROM (
                     SELECT verified."id", verified."decisionDate", verified."updatedAt",
                            row_number() OVER (ORDER BY verified."decisionDate" DESC NULLS LAST, verified."updatedAt" DESC, verified."id") AS "ordinal"
                       FROM "verifiedCandidates" verified
                   ) selected
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
          const phraseValues: SqlValue[] = rowValues;
          try {
            const phraseSqlStartedAt = performance.now();
            rows = await this.pool.query<SearchRow>(
              `${candidateCte ? `${deferredSinglePhrase ? candidateCte.replace(/^WITH\s+/u, 'WITH RECURSIVE ') : candidateCte},` : 'WITH'} ${candidateWindowCtes}
               SELECT d."id", d."title", d."subtitle", d."decisionDate", d."documentType", d."jurisdiction",
                      d."court", d."chamber", d."instance", d."caseNumber", d."visibility",
                      ${deferredSinglePhrase && phraseSnippetProjection ? `${phraseSnippetProjection} AS "snippetText"` : `COALESCE(NULLIF(pageMatch."text", ''), NULLIF(d."searchText", ''), '') AS "snippetSource"`} ,
                      stats."total", stats."hasMore", stats."totalExact", stats."candidateCount", stats."probeCount",
                      ${deferredSinglePhrase ? 'stats."candidateWindowSizes", stats."exactHitsByWindow",' : ''}
                      f."id" AS "fileId", f."mimeType" AS "fileMimeType",
                      f."sha256" AS "checksum", f."originalFilename" AS "filename", src."code" AS "sourceCode",
                      ing."externalId", ing."sourceReference",
                      ARRAY(SELECT link."targetId" FROM "CorpusDocumentLink" link WHERE link."documentId"=d."id" AND link."targetDomain"='JURISPRUDENCIA') AS "linkedResultIds",
                      (SELECT string_agg(c."name", ' · ' ORDER BY c."name") FROM "DigestoCollectionMembership" m JOIN "DigestoCollection" c ON c."id"=m."collectionId" WHERE m."documentId"=d."id" AND c."status"='ACTIVE') AS "digestoCollections",
                      (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTopic" dt JOIN "DigestoTopic" t ON t."id"=dt."topicId" WHERE dt."documentId"=d."id" AND t."active"=true) AS "digestoTopics",
                      (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTag" dt JOIN "DigestoTag" t ON t."id"=dt."tagId" WHERE dt."documentId"=d."id") AS "digestoTags",
                      e."status" AS "activeExtractionStatus",
                      pageMatch."pageNumber" AS "matchedPage", pageMatch."text" AS "matchedPageText",
                      pageMatch."textKind" AS "matchedPageTextKind", pageMatch."processingStatus" AS "matchedPageProcessingStatus",
                      pageMatch."matchedPageCount" AS "matchedPageCount"
                 FROM ${deferredSinglePhrase ? '"pageStats" stats LEFT JOIN "pagedCandidates" selected ON TRUE LEFT JOIN "CorpusDocument" d ON d."id"=selected."id"' : '"pagedCandidates" selected CROSS JOIN "pageStats" stats JOIN "CorpusDocument" d ON d."id"=selected."id"'}
                 LEFT JOIN "CorpusExtraction" e ON e."id"=d."latestExtractionId"
                 LEFT JOIN LATERAL (
                   SELECT p."pageNumber", p."text", p."textKind", p."processingStatus",
                          (SELECT count(*)::integer
                             FROM "CorpusDocumentPage" counted
                            WHERE counted."extractionId"=e."id"
                              AND cardinality(${pagePatternsParam}::text[])>0
                              AND (' ' || COALESCE(translate(lower(counted."text"), 'áéíóúü', 'aeiouu'), '') || ' ') ILIKE ANY(${pagePatternsParam}::text[])
                              AND (counted."textKind"='NATIVE' OR (e."status"='OCR_HUMAN_APPROVED' AND counted."textKind"='OCR' AND counted."processingStatus"='OCR_HUMAN_APPROVED'))
                          ) AS "matchedPageCount"
                     FROM "CorpusDocumentPage" p
                    WHERE p."extractionId"=e."id"
                      AND cardinality(${pagePatternsParam}::text[])>0
                      AND (' ' || COALESCE(translate(lower(p."text"), 'áéíóúü', 'aeiouu'), '') || ' ') ILIKE ANY(${pagePatternsParam}::text[])
                      AND (p."textKind"='NATIVE' OR (e."status"='OCR_HUMAN_APPROVED' AND p."textKind"='OCR' AND p."processingStatus"='OCR_HUMAN_APPROVED'))
                    ORDER BY p."pageNumber"
                    LIMIT 1
                 ) pageMatch ON TRUE
                 LEFT JOIN LATERAL (SELECT cf.* FROM "CorpusDocumentFile" cf WHERE cf."documentId"=d."id" ORDER BY cf."version" DESC LIMIT 1) f ON TRUE
                 LEFT JOIN LATERAL (SELECT ci.* FROM "CorpusIngestionRecord" ci WHERE ci."documentId"=d."id" ORDER BY ci."ingestedAt" DESC LIMIT 1) ing ON TRUE
                 LEFT JOIN "CorpusSourceSystem" src ON src."id"=ing."sourceSystemId"
                ORDER BY selected."decisionDate" DESC NULLS LAST, selected."updatedAt" DESC, selected."id"`,
              phraseValues,
            );
            pageQueryMs += performance.now() - pageQueryStartedAt;
            if (deferredSinglePhrase)
              pageSnippetHydrationMs = performance.now() - phraseSqlStartedAt;
          } catch (error) {
            pageQueryMs += performance.now() - pageQueryStartedAt;
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
        const countPromise = this.pool
          .query<{ total: string }>(
            `SELECT COUNT(*)::text AS total FROM "CorpusDocument" d WHERE ${where}`,
            values,
          )
          .then((result) => {
            countMs = performance.now() - countStartedAt;
            return result;
          })
          .catch((error: unknown) => {
            countMs = performance.now() - countStartedAt;
            failedQuery = 'COUNT';
            errorCode = (error as { code?: string })?.code;
            errorMessage = (error as { message?: string })?.message;
            throw error;
          });
        const legacyPageStartedAt = performance.now();
        const legacyRows = this.pool
          .query<SearchRow>(
            `WITH "pageDocs" AS (
             SELECT d."id", d."decisionDate", d."updatedAt"
               FROM "CorpusDocument" d WHERE ${where}
              ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id"
              LIMIT ${limit} OFFSET ${offset}
           )
           SELECT d."id", d."title", d."subtitle", d."decisionDate", d."documentType", d."jurisdiction",
                  d."court", d."chamber", d."instance", d."caseNumber", d."visibility",
                  COALESCE(NULLIF(pageMatch."text", ''), NULLIF(d."searchText", ''), '') AS "snippetSource",
                  ''::text AS "total", false AS "hasMore", f."id" AS "fileId", f."mimeType" AS "fileMimeType",
                  f."sha256" AS "checksum", f."originalFilename" AS "filename", src."code" AS "sourceCode",
                  ing."externalId", ing."sourceReference",
                  ARRAY(SELECT link."targetId" FROM "CorpusDocumentLink" link WHERE link."documentId" = d."id" AND link."targetDomain" = 'JURISPRUDENCIA') AS "linkedResultIds",
                  (SELECT string_agg(c."name", ' · ' ORDER BY c."name") FROM "DigestoCollectionMembership" m JOIN "DigestoCollection" c ON c."id" = m."collectionId" WHERE m."documentId" = d."id" AND c."status" = 'ACTIVE') AS "digestoCollections",
                  (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTopic" dt JOIN "DigestoTopic" t ON t."id" = dt."topicId" WHERE dt."documentId" = d."id" AND t."active" = true) AS "digestoTopics",
                  (SELECT string_agg(t."name", ' · ' ORDER BY t."name") FROM "CorpusDocumentTag" dt JOIN "DigestoTag" t ON t."id" = dt."tagId" WHERE dt."documentId" = d."id") AS "digestoTags",
                  e."status" AS "activeExtractionStatus",
                  pageMatch."pageNumber" AS "matchedPage", pageMatch."text" AS "matchedPageText",
                  pageMatch."textKind" AS "matchedPageTextKind", pageMatch."processingStatus" AS "matchedPageProcessingStatus",
                  pageMatch."matchedPageCount" AS "matchedPageCount"
             FROM "pageDocs" selected JOIN "CorpusDocument" d ON d."id" = selected."id"
             LEFT JOIN "CorpusExtraction" e ON e."id" = d."latestExtractionId"
             LEFT JOIN LATERAL (
               SELECT p."pageNumber", p."text", p."textKind", p."processingStatus",
                      (SELECT count(*)::integer
                         FROM "CorpusDocumentPage" counted
                        WHERE counted."extractionId"=e."id"
                          AND cardinality($${values.length + 1}::text[])>0
                          AND (' ' || COALESCE(translate(lower(counted."text"), 'áéíóúü', 'aeiouu'), '') || ' ') ILIKE ANY($${values.length + 1}::text[])
                          AND (counted."textKind"='NATIVE' OR (e."status"='OCR_HUMAN_APPROVED' AND counted."textKind"='OCR' AND counted."processingStatus"='OCR_HUMAN_APPROVED'))
                      ) AS "matchedPageCount"
                 FROM "CorpusDocumentPage" p
                WHERE p."extractionId"=e."id"
                  AND cardinality($${values.length + 1}::text[])>0
                  AND (' ' || COALESCE(translate(lower(p."text"), 'áéíóúü', 'aeiouu'), '') || ' ') ILIKE ANY($${values.length + 1}::text[])
                  AND (p."textKind"='NATIVE' OR (e."status"='OCR_HUMAN_APPROVED' AND p."textKind"='OCR' AND p."processingStatus"='OCR_HUMAN_APPROVED'))
                ORDER BY p."pageNumber"
                LIMIT 1
             ) pageMatch ON TRUE
             LEFT JOIN LATERAL (SELECT cf.* FROM "CorpusDocumentFile" cf WHERE cf."documentId" = d."id" ORDER BY cf."version" DESC LIMIT 1) f ON TRUE
             LEFT JOIN LATERAL (SELECT ci.* FROM "CorpusIngestionRecord" ci WHERE ci."documentId" = d."id" ORDER BY ci."ingestedAt" DESC LIMIT 1) ing ON TRUE
             LEFT JOIN "CorpusSourceSystem" src ON src."id" = ing."sourceSystemId"
            ORDER BY selected."decisionDate" DESC NULLS LAST, selected."updatedAt" DESC, selected."id"`,
            rowValues,
          )
          .then((result) => {
            pageQueryMs = performance.now() - legacyPageStartedAt;
            return result;
          })
          .catch((error: unknown) => {
            pageQueryMs = performance.now() - legacyPageStartedAt;
            failedQuery = failedQuery ?? 'PAGE';
            errorCode = errorCode ?? (error as { code?: string })?.code;
            errorMessage =
              errorMessage ?? (error as { message?: string })?.message;
            throw error;
          });
        const [count, oldRows] = await Promise.all([countPromise, legacyRows]);
        rows = oldRows;
        total = Number(count.rows[0]?.total ?? 0);
        queryCount = 2;
      }
      if (
        !candidateDocumentIds &&
        workspaceScope &&
        query.root?.type === 'term' &&
        boundedCandidatePage
      ) {
        const exactValues = [...values];
        const exactQueryPredicate = compileNode(query.root, exactValues);
        const candidateParameterTypeChecks = Array.from(
          {
            length: Math.max(0, candidateValuesEnd - candidateValuesStart + 1),
          },
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
      const pageHasResults = rows.rows.some((row) => row.id !== null);
      if (boundedCandidatePage && page > 1 && !pageHasResults) {
        const exactCountStartedAt = performance.now();
        const exactCountSql = candidateCte
          ? `${candidateCte} SELECT COUNT(*)::text AS total FROM "corpusSearchCandidates" candidates JOIN "CorpusDocument" d ON d."id" = candidates."id" WHERE ${where}`
          : `SELECT COUNT(*)::text AS total FROM "CorpusDocument" d WHERE ${where}`;
        try {
          const exactCount = await this.pool.query<{ total: string }>(
            exactCountSql,
            values,
          );
          total = Number(exactCount.rows[0]?.total ?? 0);
          outOfRangeTotalExact = true;
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
        pageQueryMs: Math.round(pageQueryMs * 100) / 100,
        resultPageMs:
          Math.round((performance.now() - resultPageStartedAt) * 100) / 100,
        candidateStrategy: activeCandidateStrategy,
        resultRows: 0,
        failedQuery,
        errorCode,
        errorMessage,
        queryCount,
        queryFingerprints,
        ...(deferredSinglePhrase
          ? {
              candidateCount: phraseCandidateCount,
              candidateGenerationCount: 1,
              windowExpansions: Math.max(0, windowSizes.length - 1),
              windowSizes,
              exactHitsByWindow,
            }
          : {}),
        stageTimings: {
          readinessMs,
          candidateBuildMs,
          candidateGenerationIntersectionsEligibilityExactCountPageAndSnippetSqlMs:
            pageSnippetHydrationMs,
          responseMappingMs,
          totalAdapterMs: performance.now() - resultPageStartedAt,
        },
      };
      throw error;
    }
    const resultPageMs = performance.now() - resultPageStartedAt;
    const hydratedRows = rows.rows.filter(
      (row): row is SearchRow & { id: string } => row.id !== null,
    );
    const hasMore = boundedCandidatePage
      ? Boolean(rows.rows[0]?.hasMore)
      : false;
    const totalExact =
      workspaceTermTotalExact ||
      outOfRangeTotalExact ||
      (boundedCandidatePage
        ? deferredSinglePhrase
          ? Boolean(rows.rows[0]?.totalExact)
          : rows.rows.length === 0
            ? page === 1
            : !hasMore
        : true);
    const mappingStartedAt = performance.now();
    const snippetGenerationMsByRow: number[] = [];
    const snippetSourceCharsByRow: number[] = [];
    const mappedResults = hydratedRows.map((row): SearchResult => {
      const matchSource = pageMatchSource(row);
      const snippetSource =
        (matchSource ? row.matchedPageText : null) ??
        row.snippetSource ??
        row.searchText ??
        '';
      const snippetStartedAt = performance.now();
      const resultSnippet = row.snippetText ?? snippet(snippetSource, literals);
      snippetGenerationMsByRow.push(performance.now() - snippetStartedAt);
      snippetSourceCharsByRow.push(snippetSource.length);
      return {
        id: `CORPUS:DOCUMENT:${row.id}`,
        sourceSystem: 'CORPUS',
        sourceType: 'DOCUMENTO',
        sourceId: row.id,
        title: row.title,
        subtitle: row.subtitle,
        date: row.decisionDate?.toISOString() ?? null,
        snippet: resultSnippet,
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
          pageNumber: matchSource ? row.matchedPage : null,
          matchSource,
          matchedPageCount: matchSource
            ? Math.max(0, Number(row.matchedPageCount ?? 0))
            : 0,
          pageTextSha256: matchSource
            ? createHash('sha256')
                .update(row.matchedPageText!, 'utf8')
                .digest('hex')
            : null,
          digestoCollections: row.digestoCollections,
          digestoTopics: row.digestoTopics,
          digestoTags: row.digestoTags,
        },
        linkedResultIds: row.linkedResultIds ?? [],
        visibility: row.visibility as SearchResult['visibility'],
        document: {
          href: workspaceScope
            ? `/api/workspaces/${workspaceId}/documents/${row.id}/file`
            : personalScope
              ? `/api/personal/documents/${row.id}/file`
              : row.visibility === 'PUBLIC'
                ? `/api/public/corpus/documents/${row.id}/file`
                : `/api/corpus/documents/${row.id}/file`,
          mimeType: row.fileMimeType,
        },
      };
    });
    responseMappingMs = performance.now() - mappingStartedAt;
    this.lastSearchProfile = {
      countMs,
      pageQueryMs: Math.round(pageQueryMs * 100) / 100,
      resultPageMs,
      ...(candidateCte ? { combinedCandidatePageMs: resultPageMs } : {}),
      candidateStrategy: activeCandidateStrategy,
      resultRows: hydratedRows.length,
      queryCount,
      queryFingerprints,
      ...(deferredSinglePhrase
        ? {
            candidateCount: phraseCandidateCount,
            candidateGenerationCount: 1,
            windowExpansions: Math.max(0, windowSizes.length - 1),
            windowSizes,
            exactHitsByWindow,
          }
        : {}),
      stageTimings: {
        readinessMs,
        candidateBuildMs,
        candidateGenerationIntersectionsEligibilityExactCountPageAndSnippetSqlMs:
          pageSnippetHydrationMs,
        responseMappingMs,
        snippetGenerationMs: snippetGenerationMsByRow.reduce(
          (sum, value) => sum + value,
          0,
        ),
        snippetGenerationMsByRow,
        snippetSourceCharsByRow,
        snippetSourceCharsTotal: snippetSourceCharsByRow.reduce(
          (sum, value) => sum + value,
          0,
        ),
        snippetSourceCharsMax: Math.max(...snippetSourceCharsByRow, 0),
        totalAdapterMs: performance.now() - resultPageStartedAt,
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
  return createHash('sha256')
    .update(template.replace(/\s+/gu, ' ').trim())
    .digest('hex')
    .slice(0, 16);
}

function searchStatementTimeoutMs() {
  const configured = Number(
    process.env.BJC_SEARCH_STATEMENT_TIMEOUT_MS ?? 4000,
  );
  return Number.isInteger(configured) && configured >= 500 && configured <= 4500
    ? configured
    : 4000;
}
