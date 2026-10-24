export const SEARCH_INDEX_SCHEMA_VERSION = 3 as const;
export const SEARCH_INDEX_SCHEMA_VERSION_V4 = 4 as const;
export type SearchIndexSchemaVersion =
  typeof SEARCH_INDEX_SCHEMA_VERSION | typeof SEARCH_INDEX_SCHEMA_VERSION_V4;

export const SEARCH_V4_COLLATION_PIPELINE_ID =
  'galilei-search-v004-collation-v1';

export const SEARCH_V4_COLLATION_PIPELINE = {
  description:
    'GALILEI collation v1: materialize raw numeroSentencia or empty string without normalization',
  processors: [
    {
      script: {
        lang: 'painless',
        source:
          "if (ctx.sortFields == null) { ctx.sortFields = [:]; } def value = ctx.sortFields.get('numeroSentencia'); ctx.sortFields.put('numeroSentenciaCollation', value == null ? '' : value);",
      },
    },
  ],
} as const;

export const SEARCH_FIELD_NAMES = [
  'tema',
  'sala',
  'tipoFallo',
  'tribunalOrigen',
  'expediente',
  'caratula',
  'actor',
  'demandado',
  'objeto',
  'magistrados',
  'numeroSentencia',
  'numeroSumario',
] as const;

export const SEARCH_SCOPE_NAMES = [
  'sentencia',
  'sumario',
  'resumen',
  'resena',
  'referencias',
] as const;

const searchScopeProperties = Object.fromEntries(
  SEARCH_SCOPE_NAMES.map((name) => [
    name,
    {
      type: 'object',
      dynamic: 'strict',
      properties: {
        text: { type: 'wildcard' },
        tokens: { type: 'keyword', ignore_above: 32766 },
        phraseSequence: {
          type: 'text',
          analyzer: 'galilei_sequence',
          search_analyzer: 'galilei_sequence',
          index_options: 'positions',
        },
        phraseBigrams: {
          type: 'text',
          analyzer: 'galilei_sequence',
          search_analyzer: 'galilei_sequence',
          index_options: 'positions',
          norms: false,
        },
      },
    },
  ]),
);

const fieldProperties = Object.fromEntries(
  SEARCH_FIELD_NAMES.flatMap((name) => [
    [name, { type: 'wildcard' }],
    [`${name}Tokens`, { type: 'keyword', ignore_above: 32766 }],
    [
      `${name}Phrase`,
      {
        type: 'text',
        analyzer: 'galilei_sequence',
        search_analyzer: 'galilei_sequence',
        index_options: 'positions',
      },
    ],
    [
      `${name}PhraseBigrams`,
      {
        type: 'text',
        analyzer: 'galilei_sequence',
        search_analyzer: 'galilei_sequence',
        index_options: 'positions',
        norms: false,
      },
    ],
  ]),
) as Record<string, Record<string, unknown>>;

export const SEARCH_INDEX_DEFINITION = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    refresh_interval: '1s',
    max_result_window: 30000,
    analysis: {
      analyzer: {
        galilei_sequence: {
          type: 'custom',
          tokenizer: 'whitespace',
          filter: [],
        },
      },
    },
  },
  mappings: {
    dynamic: 'strict',
    _meta: {
      galileiSearchSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      openSearchCompatibility: '2.19.6',
    },
    properties: {
      id: { type: 'keyword' },
      sourceSystem: { type: 'keyword' },
      sourceType: { type: 'keyword' },
      documentType: { type: 'keyword' },
      title: { type: 'keyword', ignore_above: 8191 },
      subtitle: { type: 'keyword', ignore_above: 8191 },
      jurisdiction: { type: 'keyword' },
      court: { type: 'keyword', ignore_above: 8191 },
      chamber: { type: 'keyword', ignore_above: 8191 },
      instance: { type: 'keyword' },
      caseNumber: { type: 'keyword', ignore_above: 8191 },
      docket: { type: 'keyword', ignore_above: 8191 },
      decisionDate: {
        type: 'date',
        format: 'strict_date_optional_time||epoch_millis',
      },
      visibility: { type: 'keyword' },
      documentScope: { type: 'keyword' },
      status: { type: 'keyword' },
      active: { type: 'boolean' },
      updatedAt: { type: 'date' },
      logicalNumericId: { type: 'long' },
      hasPdf: { type: 'boolean' },
      hasSummary: { type: 'boolean' },
      featured: { type: 'boolean' },
      workspaceNameFields: {
        type: 'object',
        dynamic: 'strict',
        properties: {
          title: { type: 'wildcard' },
          filename: { type: 'wildcard' },
        },
      },
      workspaceLinkedAt: { type: 'date' },
      sortFields: {
        type: 'object',
        dynamic: 'strict',
        properties: {
          sala: { type: 'keyword', ignore_above: 8191 },
          numeroSentencia: { type: 'keyword', ignore_above: 8191 },
        },
      },
      searchScopeFields: {
        type: 'object',
        dynamic: 'strict',
        properties: searchScopeProperties,
      },
      publicSearchScopeFields: {
        type: 'object',
        dynamic: 'strict',
        properties: searchScopeProperties,
      },
      canonicalSearchText: { type: 'wildcard' },
      publicSearchText: { type: 'wildcard' },
      lexicalTokens: { type: 'keyword', ignore_above: 32766 },
      publicLexicalTokens: { type: 'keyword', ignore_above: 32766 },
      phraseSequence: {
        type: 'text',
        analyzer: 'galilei_sequence',
        search_analyzer: 'galilei_sequence',
        index_options: 'positions',
      },
      phraseBigrams: {
        type: 'text',
        analyzer: 'galilei_sequence',
        search_analyzer: 'galilei_sequence',
        index_options: 'positions',
        norms: false,
      },
      publicPhraseSequence: {
        type: 'text',
        analyzer: 'galilei_sequence',
        search_analyzer: 'galilei_sequence',
        index_options: 'positions',
      },
      publicPhraseBigrams: {
        type: 'text',
        analyzer: 'galilei_sequence',
        search_analyzer: 'galilei_sequence',
        index_options: 'positions',
        norms: false,
      },
      fields: {
        type: 'object',
        dynamic: 'strict',
        properties: fieldProperties,
      },
      publicFields: {
        type: 'object',
        dynamic: 'strict',
        properties: fieldProperties,
      },
      filterFields: {
        type: 'object',
        dynamic: 'strict',
        properties: {
          caseNumber: { type: 'wildcard' },
          title: { type: 'wildcard' },
          court: { type: 'wildcard' },
          documentType: { type: 'wildcard' },
          instance: { type: 'wildcard' },
        },
      },
      publicFilterFields: {
        type: 'object',
        dynamic: 'strict',
        properties: {
          caseNumber: { type: 'wildcard' },
          title: { type: 'wildcard' },
          court: { type: 'wildcard' },
          documentType: { type: 'wildcard' },
          instance: { type: 'wildcard' },
        },
      },
      mimeType: { type: 'keyword' },
      digestoCollectionIds: { type: 'keyword' },
      digestoTopicIds: { type: 'keyword' },
      digestoTagIds: { type: 'keyword' },
      sourceIds: { type: 'keyword' },
      sourcePaths: { type: 'wildcard' },
      sourceWorkspaceIds: { type: 'keyword' },
      sourceFileScopes: {
        type: 'nested',
        properties: {
          sourceId: { type: 'keyword' },
          workspaceId: { type: 'keyword' },
          normalizedPath: { type: 'keyword', ignore_above: 4096 },
        },
      },
      linkedResultIds: { type: 'keyword' },
      aclPrincipalIds: { type: 'keyword' },
      ownerUserId: { type: 'keyword' },
      workspaceId: { type: 'keyword' },
      folderId: { type: 'keyword' },
      visibilityScope: { type: 'keyword' },
      publicationStatus: { type: 'keyword' },
      indexSchemaVersion: { type: 'integer' },
    },
  },
} as const;

type MutableSearchIndexDefinition = {
  settings: Record<string, unknown>;
  mappings: {
    _meta: Record<string, unknown>;
    properties: Record<string, unknown>;
  };
};

function createSearchIndexDefinitionV4(): MutableSearchIndexDefinition {
  const definition = JSON.parse(
    JSON.stringify(SEARCH_INDEX_DEFINITION),
  ) as MutableSearchIndexDefinition;
  definition.mappings._meta.galileiSearchSchemaVersion =
    SEARCH_INDEX_SCHEMA_VERSION_V4;
  definition.settings.final_pipeline = SEARCH_V4_COLLATION_PIPELINE_ID;

  const icuCollationField = {
    type: 'icu_collation_keyword',
    language: 'es',
    country: 'AR',
    variant: '@collation=standard',
    strength: 'tertiary',
    decomposition: 'no',
    alternate: 'non-ignorable',
    case_level: false,
    numeric: false,
    index: false,
    doc_values: true,
  };
  const id = definition.mappings.properties.id as Record<string, unknown>;
  id.fields = { collation: { ...icuCollationField } };
  const sortFields = definition.mappings.properties.sortFields as {
    properties: Record<string, unknown>;
  };
  sortFields.properties.numeroSentenciaCollation = {
    ...icuCollationField,
  };
  return definition;
}

export const SEARCH_INDEX_DEFINITION_V4 =
  createSearchIndexDefinitionV4() as Readonly<MutableSearchIndexDefinition>;

export const SEARCH_INDEX_DEFINITIONS: Record<
  SearchIndexSchemaVersion,
  Readonly<MutableSearchIndexDefinition>
> = {
  [SEARCH_INDEX_SCHEMA_VERSION]: SEARCH_INDEX_DEFINITION,
  [SEARCH_INDEX_SCHEMA_VERSION_V4]: SEARCH_INDEX_DEFINITION_V4,
};

export type SearchIndexDocument = {
  id: string;
  sourceSystem: 'CORPUS' | 'JURISPRUDENCIA';
  sourceType: 'DOCUMENTO' | 'SUMARIO' | 'SENTENCIA';
  documentType: string;
  title: string | null;
  subtitle: string | null;
  jurisdiction: string | null;
  court: string | null;
  chamber: string | null;
  instance: string | null;
  caseNumber: string | null;
  docket: string | null;
  decisionDate: string | null;
  visibility: string;
  documentScope: string;
  status: string;
  active: boolean;
  updatedAt: string;
  logicalNumericId?: number | null;
  hasPdf?: boolean;
  hasSummary?: boolean;
  featured?: boolean;
  workspaceNameFields?: { title: string | null; filename: string | null };
  workspaceLinkedAt?: string | null;
  sortFields?: {
    sala: string | null;
    numeroSentencia: string | null;
    numeroSentenciaCollation?: string;
  };
  canonicalSearchText: string;
  publicSearchText: string;
  lexicalTokens: string[];
  publicLexicalTokens: string[];
  phraseSequence: string;
  publicPhraseSequence: string;
  phraseBigrams: string;
  publicPhraseBigrams: string;
  searchScopeFields: Record<
    (typeof SEARCH_SCOPE_NAMES)[number],
    SearchScopeField
  >;
  publicSearchScopeFields: Record<
    (typeof SEARCH_SCOPE_NAMES)[number],
    SearchScopeField
  >;
  fields: Record<string, string | string[] | null>;
  publicFields: Record<string, string | string[] | null>;
  filterFields: Record<string, string | null>;
  publicFilterFields: Record<string, string | null>;
  mimeType: string | null;
  digestoCollectionIds: string[];
  digestoTopicIds: string[];
  digestoTagIds: string[];
  aclPrincipalIds: string[];
  sourceIds: string[];
  sourcePaths: string[];
  sourceWorkspaceIds: string[];
  sourceFileScopes?: Array<{
    sourceId: string;
    workspaceId: string | null;
    normalizedPath: string | null;
  }>;
  linkedResultIds: string[];
  ownerUserId: string | null;
  workspaceId: string | null;
  folderId: string | null;
  visibilityScope: string | null;
  publicationStatus: string;
  indexSchemaVersion: SearchIndexSchemaVersion;
};

export type SearchScopeField = {
  text: string;
  tokens: string[];
  phraseSequence: string;
  phraseBigrams: string;
};

export function lexicalTokens(normalized: string): string[] {
  return [...normalized.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0]);
}

/** EVAL-2 exact phrase encoding: lexical runs and each normalized separator remain positional tokens. */
export function phraseSequence(normalized: string): string {
  const output: string[] = [];
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+|[^\p{L}\p{N}]/gu)) {
    const part = match[0];
    output.push(
      /^[\p{L}\p{N}]+$/u.test(part)
        ? `w${part}`
        : `s${part.codePointAt(0)!.toString(16)}`,
    );
  }
  return output.join(' ');
}

/**
 * Encodes adjacent pairs from the exact Galilei phrase atom stream. The
 * separator marker is retained as an atom, so punctuation, whitespace, and
 * boundaries remain identical to phraseSequence. `~` cannot occur in an atom
 * (`w` + Unicode L/N run, or `s` + code-point hex), and whitespace analysis
 * therefore emits one reversible positional term for every adjacent pair.
 */
export function phraseBigramSequenceFromPhraseSequence(
  sequence: string,
): string {
  const atoms = sequence ? sequence.split(' ') : [];
  const wordOffsets = atoms.flatMap((atom, index) =>
    atom.startsWith('w') ? [index] : [],
  );
  if (wordOffsets.length < 2) return '';
  const shingles: string[] = [];
  for (let index = 1; index < wordOffsets.length; index += 1) {
    const start = wordOffsets[index - 1];
    const end = wordOffsets[index];
    // Keep every normalized punctuation/space atom inside the lexical shingle.
    // The result is one positional term per adjacent pair of words.
    shingles.push(atoms.slice(start, end + 1).join('~'));
  }
  return shingles.join(' ');
}

export function phraseBigramSequence(normalized: string): string {
  return phraseBigramSequenceFromPhraseSequence(phraseSequence(normalized));
}
