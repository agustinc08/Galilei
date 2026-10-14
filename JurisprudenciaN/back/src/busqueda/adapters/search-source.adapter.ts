import type { SearchQueryAst } from '../utils/search-ast';

export type SearchVisibility = 'PUBLIC' | 'INTERNAL' | 'ADMIN' | 'RESTRICTED';
export type SearchDialect = 'modern' | 'legacy-reference';
export type SearchPublicationPolicy =
  | 'published-active-only'
  | 'legacy-active-only';

export type SearchContext = {
  visibility: SearchVisibility;
  dialect: SearchDialect;
  publicationPolicy: SearchPublicationPolicy;
  page?: number;
  pageSize?: number;
  filters?: {
    sala?: string;
    fechaDesde?: string;
    fechaHastaExclusive?: string;
    expediente?: string;
    numeroSentencia?: string;
    caratula?: string;
    tribunalOrigen?: string;
    tipoFallo?: string;
    instance?: string;
    digestoCollectionId?: string;
    digestoTopicId?: string;
    digestoTagId?: string;
  };
  sourceSystems?: Array<'JURISPRUDENCIA' | 'DIGESTO' | 'CORPUS'>;
  /** Set only by an authenticated workspace service after membership authorization. */
  documentScope?:
    | { kind: 'GENERAL' }
    | {
        kind: 'WORKSPACE';
        workspaceId: string;
        folderId?: string | null;
        sourceId?: string;
        sourceFolder?: string;
      };
};

export type SearchResult = {
  id: string;
  sourceSystem: 'JURISPRUDENCIA' | 'DIGESTO' | 'CORPUS';
  sourceType: 'SUMARIO' | 'DOCUMENTO';
  sourceId: string;
  title: string | null;
  subtitle: string | null;
  date: string | null;
  snippet: string | null;
  matchedFields: string[];
  score: number;
  scoreComponents?: Record<string, number>;
  metadata: Record<string, string | number | boolean | null>;
  linkedResultIds?: string[];
  visibility: SearchVisibility;
  document: { href: string | null; mimeType: string | null } | null;
};

export type SearchResultPage = {
  total: number;
  totalExact?: boolean;
  hasMore?: boolean;
  page: number;
  pageSize: number;
  results: SearchResult[];
};

export interface SearchSourceAdapter {
  search(
    query: SearchQueryAst,
    context: SearchContext,
  ): Promise<SearchResultPage>;
  getLastSearchProfile?(): {
    countMs: number;
    resultPageMs: number;
    serializationMs?: number;
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
    queryCount?: number;
    queryFingerprints?: string[];
  } | null;
  getPoolDiagnostics?(): {
    total: number;
    active: number;
    idle: number;
    waiting: number;
    max: number;
  } | null;
}
