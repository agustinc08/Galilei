import type { SearchContext } from '../adapters/search-source.adapter';
import type {
  SearchFieldName,
  SearchNode,
  SearchQueryAst,
} from '../utils/search-ast';
import { normalizeSearchText } from '../utils/search-normalizer';
import { phraseBigramSequence, phraseSequence } from './opensearch-mapping';

const fieldPaths: Record<SearchFieldName, string> = {
  tema: 'tema',
  sala: 'sala',
  tipoFallo: 'tipoFallo',
  tribunalOrigen: 'tribunalOrigen',
  expediente: 'expediente',
  caratula: 'caratula',
  actor: 'actor',
  demandado: 'demandado',
  objeto: 'objeto',
  magistrados: 'magistrados',
  numeroSentencia: 'numeroSentencia',
  numeroSumario: 'numeroSumario',
};

type Clause = Record<string, unknown>;
type FilterOptions = {
  source: 'CORPUS' | 'JURISPRUDENCIA';
  /** Private Corpus ACL/folder access is checked live by PostgreSQL per candidate batch. */
  livePrivateAcl?: boolean;
};

export function translateSearchNode(
  node: SearchNode | null,
  publicMode = false,
  searchScopes?: string[],
): Clause {
  if (!node) return { match_all: {} };
  if (node.type === 'not')
    return {
      bool: {
        must: [{ match_all: {} }],
        must_not: [translateSearchNode(node.operand, publicMode, searchScopes)],
      },
    };
  if (node.type === 'and')
    return {
      bool: {
        must: node.operands.map((operand) =>
          translateSearchNode(operand, publicMode, searchScopes),
        ),
      },
    };
  if (node.type === 'or')
    return {
      bool: {
        should: node.operands.map((operand) =>
          translateSearchNode(operand, publicMode, searchScopes),
        ),
        minimum_should_match: 1,
      },
    };

  if (!node.field && searchScopes) {
    if (!searchScopes.length) return { match_none: {} };
    return {
      bool: {
        should: searchScopes.map((scope) =>
          translateLiteralNode(node, publicMode, scope),
        ),
        minimum_should_match: 1,
      },
    };
  }
  return translateLiteralNode(node, publicMode);
}

function translateLiteralNode(
  node: Exclude<SearchNode, { type: 'and' | 'or' | 'not' }>,
  publicMode: boolean,
  scope?: string,
): Clause {
  const fieldPrefix = publicMode ? 'publicFields' : 'fields';
  const field = node.field ? `${fieldPrefix}.${fieldPaths[node.field]}` : null;
  const scopeField = scope
    ? `${publicMode ? 'publicSearchScopeFields' : 'searchScopeFields'}.${scope}`
    : null;
  const rootPhraseField = publicMode
    ? 'publicPhraseSequence'
    : 'phraseSequence';
  const rootBigramField = publicMode ? 'publicPhraseBigrams' : 'phraseBigrams';
  const rootTokenField = publicMode ? 'publicLexicalTokens' : 'lexicalTokens';
  const tokenField = field
    ? `${field}Tokens`
    : scopeField
      ? `${scopeField}.tokens`
      : rootTokenField;
  if (node.type === 'phrase') {
    if (/^[\p{L}\p{N}]+$/u.test(node.normalizedValue)) {
      return {
        term: {
          [tokenField]: node.normalizedValue,
        },
      };
    }
    return exactPhraseClause(
      node.normalizedValue,
      field
        ? `${field}PhraseBigrams`
        : scopeField
          ? `${scopeField}.phraseBigrams`
          : rootBigramField,
      field
        ? `${field}Phrase`
        : scopeField
          ? `${scopeField}.phraseSequence`
          : rootPhraseField,
      tokenField,
    );
  }

  const hasExplicitWildcard = node.sourceText.includes('%');
  if (
    node.matchMode === 'prefix' ||
    (!hasExplicitWildcard && node.matchMode === 'contains')
  ) {
    return {
      prefix: {
        [tokenField]: { value: node.normalizedValue, case_insensitive: false },
      },
    };
  }
  if (node.matchMode === 'suffix') {
    return {
      wildcard: {
        [tokenField]: {
          value: `*${escapeWildcard(node.normalizedValue)}`,
          case_insensitive: false,
        },
      },
    };
  }
  if (node.matchMode === 'contains' && hasExplicitWildcard) {
    return {
      wildcard: {
        [tokenField]: {
          value: `*${escapeWildcard(node.normalizedValue)}*`,
          case_insensitive: false,
        },
      },
    };
  }
  throw new Error('SEARCH_TERM_MODE_UNSUPPORTED');
}

export function buildSearchQueryDsl(
  query: SearchQueryAst,
  context: SearchContext,
  options: FilterOptions,
): Clause {
  const filters: Clause[] = [
    { term: { sourceSystem: options.source } },
    { term: { active: context.filters?.activo ?? true } },
  ];
  if (options.source === 'CORPUS') {
    filters.push({ terms: { status: ['INDEXED', 'OCR_REQUIRED'] } });
    appendVisibilityFilter(filters, context);
    appendDocumentScopeFilter(filters, context, options);
    appendCorpusFilters(filters, context);
  } else {
    if (context.documentKinds?.length)
      filters.push({ terms: { sourceType: context.documentKinds } });
    if (context.publicationPolicy === 'published-active-only')
      filters.push({ term: { publicationStatus: 'PUBLISHED' } });
    if (context.filters?.publicado !== undefined)
      filters.push({
        term: {
          publicationStatus: context.filters.publicado
            ? 'PUBLISHED'
            : 'UNPUBLISHED',
        },
      });
    appendJurisprudenceFilters(filters, context);
  }
  const publicMode = context.visibility === 'PUBLIC';
  const searchScopes =
    options.source === 'JURISPRUDENCIA'
      ? resolveSearchScopes(context.filters?.buscarEn)
      : undefined;
  const must: Clause[] = [
    translateSearchNode(query.root, publicMode, searchScopes),
  ];
  const exactPhrase = normalizeSearchText(context.filters?.exactPhrase ?? '');
  if (exactPhrase) {
    if (searchScopes) {
      const scopePrefix = publicMode
        ? 'publicSearchScopeFields'
        : 'searchScopeFields';
      const clauses = searchScopes.map((scope) =>
        exactPhraseClause(
          exactPhrase,
          `${scopePrefix}.${scope}.phraseBigrams`,
          `${scopePrefix}.${scope}.phraseSequence`,
          `${scopePrefix}.${scope}.tokens`,
        ),
      );
      must.push(
        clauses.length
          ? { bool: { should: clauses, minimum_should_match: 1 } }
          : { match_none: {} },
      );
    } else {
      must.push(
        exactPhraseClause(
          exactPhrase,
          publicMode ? 'publicPhraseBigrams' : 'phraseBigrams',
          publicMode ? 'publicPhraseSequence' : 'phraseSequence',
          publicMode ? 'publicLexicalTokens' : 'lexicalTokens',
        ),
      );
    }
  }
  const mustNot: Clause[] = [];
  for (const excluded of context.filters?.excludeTerms ?? []) {
    const normalized = normalizeSearchText(excluded);
    if (normalized && searchScopes === undefined)
      mustNot.push({
        wildcard: {
          [publicMode ? 'publicSearchText' : 'canonicalSearchText']: {
            value: `*${escapeWildcard(normalized)}*`,
            case_insensitive: false,
          },
        },
      });
    else if (normalized && searchScopes !== undefined && searchScopes.length) {
      const scopePrefix = publicMode
        ? 'publicSearchScopeFields'
        : 'searchScopeFields';
      mustNot.push({
        bool: {
          should: searchScopes.map((scope) => ({
            wildcard: {
              [`${scopePrefix}.${scope}.text`]: {
                value: `*${escapeWildcard(normalized)}*`,
                case_insensitive: false,
              },
            },
          })),
          minimum_should_match: 1,
        },
      });
    }
  }
  return {
    bool: {
      filter: filters,
      must,
      ...(mustNot.length ? { must_not: mustNot } : {}),
    },
  };
}

function appendVisibilityFilter(filters: Clause[], context: SearchContext) {
  const allowed =
    context.visibility === 'PUBLIC'
      ? ['PUBLIC']
      : context.visibility === 'INTERNAL'
        ? ['PUBLIC', 'INTERNAL']
        : context.visibility === 'ADMIN'
          ? ['PUBLIC', 'INTERNAL', 'RESTRICTED']
          : [];
  filters.push(
    allowed.length ? { terms: { visibility: allowed } } : { match_none: {} },
  );
}

function appendDocumentScopeFilter(
  filters: Clause[],
  context: SearchContext,
  options: FilterOptions,
) {
  const scope = context.documentScope ?? { kind: 'GENERAL' as const };
  if (scope.kind === 'GENERAL') {
    filters.push({ term: { documentScope: 'GENERAL' } });
    return;
  }
  filters.push({ term: { documentScope: 'PRIVATE_WORKSPACE' } });
  if (scope.kind === 'PERSONAL') {
    filters.push({ term: { ownerUserId: String(scope.userId) } });
    filters.push({
      bool: { must_not: [{ exists: { field: 'workspaceId' } }] },
    });
    if (
      !options.livePrivateAcl &&
      Object.prototype.hasOwnProperty.call(scope, 'folderId')
    ) {
      filters.push(
        scope.folderId
          ? { term: { folderId: scope.folderId } }
          : { bool: { must_not: [{ exists: { field: 'folderId' } }] } },
      );
    }
    return;
  }
  filters.push({ term: { workspaceId: scope.workspaceId } });
  if (!options.livePrivateAcl)
    filters.push({ term: { aclPrincipalIds: String(scope.userId) } });
  if (
    !options.livePrivateAcl &&
    Object.prototype.hasOwnProperty.call(scope, 'folderId')
  ) {
    filters.push(
      scope.folderId
        ? { term: { folderId: scope.folderId } }
        : { bool: { must_not: [{ exists: { field: 'folderId' } }] } },
    );
  }
  if (scope.sourceId === '__manual_upload__') {
    filters.push({
      bool: { must_not: [{ term: { sourceWorkspaceIds: scope.workspaceId } }] },
    });
  } else if (scope.sourceId) {
    const sourceFilters: Clause[] = [
      { term: { 'sourceFileScopes.sourceId': scope.sourceId } },
      { term: { 'sourceFileScopes.workspaceId': scope.workspaceId } },
    ];
    if (scope.sourceFolder)
      sourceFilters.push(sourceFolderScopeFilter(scope.sourceFolder));
    filters.push({
      nested: {
        path: 'sourceFileScopes',
        query: { bool: { filter: sourceFilters } },
      },
    });
  } else if (scope.sourceFolder) {
    filters.push({ match_none: {} });
  }
}

function sourceFolderScopeFilter(sourceFolder: string): Clause {
  const folder = sourceFolder.replace(/\\+$/u, '');
  return {
    bool: {
      should: [
        { term: { 'sourceFileScopes.normalizedPath': sourceFolder } },
        {
          prefix: {
            'sourceFileScopes.normalizedPath': `${folder}\\`,
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

function appendCorpusFilters(filters: Clause[], context: SearchContext) {
  const input = context.filters;
  const after = input?.dateFrom ?? input?.fechaDesde;
  const before =
    input?.fechaHastaExclusive ??
    (input?.dateTo ? exclusiveDayAfter(input.dateTo) : undefined);
  if (after || before)
    filters.push({
      range: {
        decisionDate: {
          ...(after ? { gte: after } : {}),
          ...(before ? { lt: before } : {}),
        },
      },
    });
  if (input?.types?.length)
    filters.push({ terms: { mimeType: mimeTypes(input.types) } });
  if (input?.sala) filters.push({ term: { chamber: input.sala } });
  appendTextFilter(
    filters,
    'filterFields.caseNumber',
    input?.expediente ?? input?.numeroSentencia,
  );
  appendTextFilter(filters, 'filterFields.title', input?.caratula);
  appendTextFilter(filters, 'filterFields.court', input?.tribunalOrigen);
  appendTextFilter(filters, 'filterFields.documentType', input?.tipoFallo);
  appendTextFilter(filters, 'filterFields.instance', input?.instance);
  if (input?.digestoCollectionId)
    filters.push({ term: { digestoCollectionIds: input.digestoCollectionId } });
  if (input?.digestoTopicId)
    filters.push({ term: { digestoTopicIds: input.digestoTopicId } });
  if (input?.digestoTagId)
    filters.push({ term: { digestoTagIds: input.digestoTagId } });
}

function appendJurisprudenceFilters(filters: Clause[], context: SearchContext) {
  const input = context.filters;
  const fields =
    context.visibility === 'PUBLIC' ? 'publicFilterFields' : 'filterFields';
  const searchFields =
    context.visibility === 'PUBLIC' ? 'publicFields' : 'fields';
  if (input?.sala) filters.push({ term: { chamber: input.sala } });
  const after = input?.dateFrom ?? input?.fechaDesde;
  const before =
    input?.fechaHastaExclusive ??
    (input?.dateTo ? exclusiveDayAfter(input.dateTo) : undefined);
  if (after || before)
    filters.push({
      range: {
        decisionDate: {
          ...(after ? { gte: after } : {}),
          ...(before ? { lt: before } : {}),
        },
      },
    });
  appendTextFilter(filters, `${fields}.caseNumber`, input?.expediente);
  appendTextFilter(
    filters,
    `${searchFields}.numeroSentencia`,
    input?.numeroSentencia,
  );
  appendTextFilter(filters, `${fields}.title`, input?.caratula);
  appendTextFilter(filters, `${fields}.court`, input?.tribunalOrigen);
  appendTextFilter(filters, `${fields}.documentType`, input?.tipoFallo);
  for (const [field, value] of [
    ['actor', input?.actor],
    ['demandado', input?.demandado],
    ['objeto', input?.objeto],
    ['magistrados', input?.magistrados],
    ['tema', input?.tema],
    ['numeroSumario', input?.numeroSumario],
  ] as const)
    appendTextFilter(filters, `${searchFields}.${field}`, value);
  if (input?.anio !== undefined)
    filters.push({
      range: {
        decisionDate: {
          gte: `${input.anio}-01-01`,
          lt: `${input.anio + 1}-01-01`,
        },
      },
    });
  const pdfMode =
    input?.pdf === 'conPdf' ||
    input?.soloConPdf === true ||
    input?.tienePdf === true
      ? true
      : input?.pdf === 'sinPdf' || input?.tienePdf === false
        ? false
        : undefined;
  if (pdfMode !== undefined) filters.push({ term: { hasPdf: pdfMode } });
  if (input?.soloConResumen) filters.push({ term: { hasSummary: true } });
  if (input?.destacada !== undefined)
    filters.push({ term: { featured: input.destacada } });
}

function appendTextFilter(filters: Clause[], field: string, value?: string) {
  const normalized = value ? normalizeSearchText(value) : '';
  if (normalized)
    filters.push({
      wildcard: {
        [field]: {
          value: `*${escapeWildcard(normalized)}*`,
          case_insensitive: false,
        },
      },
    });
}

function exclusiveDayAfter(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function mimeTypes(types: NonNullable<SearchContext['filters']>['types']) {
  const output = new Set<string>();
  for (const type of types ?? []) {
    if (type === 'PDF') output.add('application/pdf');
    if (type === 'TXT') output.add('text/plain');
    if (type === 'RTF') output.add('application/rtf');
    if (type === 'DOC') output.add('application/msword');
    if (type === 'DOCX')
      output.add(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    if (type === 'ODT') output.add('application/vnd.oasis.opendocument.text');
  }
  return [...output];
}

function exactPhraseClause(
  value: string,
  bigramField: string,
  referenceField: string,
  tokenField: string,
): Clause {
  if (/^[\p{L}\p{N}]+$/u.test(value)) return { term: { [tokenField]: value } };
  const query = phraseBigramSequence(value);
  const sequence = phraseSequence(value);
  const atoms = sequence.split(' ').filter(Boolean);
  if (
    query &&
    atoms[0]?.startsWith('w') &&
    atoms[atoms.length - 1]?.startsWith('w')
  ) {
    return {
      match_phrase: {
        [bigramField]: { query, slop: 0 },
      },
    };
  }
  // Retain all punctuation and leading/trailing separators for these rare
  // queries; the lexical bigram path cannot encode a missing word boundary.
  return { match_phrase: { [referenceField]: { query: sequence, slop: 0 } } };
}

function resolveSearchScopes(values?: string[]) {
  const aliases: Record<string, string> = {
    sentencia: 'sentencia',
    sumario: 'sumario',
    referencias: 'referencias',
    resumen: 'resumen',
    resena: 'resena',
    reseña: 'resena',
  };
  if (!values?.length || values.includes('todo'))
    return ['sentencia', 'sumario', 'referencias', 'resumen', 'resena'];
  return [...new Set(values.flatMap((value) => aliases[value] ?? []))];
}

function escapeWildcard(value: string) {
  return value.replace(/[\\*?]/gu, '\\$&');
}
