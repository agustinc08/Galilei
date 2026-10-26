import type { SearchQueryAst } from '../utils/search-ast';
import type { CorpusFileType } from '../utils/search-filters';

export type SearchVisibility = 'PUBLIC' | 'INTERNAL' | 'ADMIN' | 'RESTRICTED';
export type SearchDialect = 'modern' | 'legacy-reference';
export type SearchPublicationPolicy =
  'published-active-only' | 'legacy-active-only';

export type SearchContext = {
  visibility: SearchVisibility;
  dialect: SearchDialect;
  publicationPolicy: SearchPublicationPolicy;
  page?: number;
  pageSize?: number;
  filters?: {
    sala?: string;
    /** Exact indexed chamber values represented by one normalized public facet. */
    salas?: string[];
    fechaDesde?: string;
    fechaHastaExclusive?: string;
    /** ISO calendar dates; both endpoints are inclusive and use CorpusDocument.decisionDate. */
    dateFrom?: string;
    dateTo?: string;
    /** File type derived from the latest CorpusDocumentFile MIME type. */
    types?: CorpusFileType[];
    expediente?: string;
    numeroSentencia?: string;
    numeroSumario?: string;
    caratula?: string;
    actor?: string;
    demandado?: string;
    objeto?: string;
    magistrados?: string;
    tema?: string;
    tribunalOrigen?: string;
    tipoFallo?: string;
    anio?: number;
    publicado?: boolean;
    activo?: boolean;
    exactPhrase?: string;
    excludeTerms?: string[];
    instance?: string;
    digestoCollectionId?: string;
    digestoTopicId?: string;
    digestoTagId?: string;
    soloConPdf?: boolean;
    pdf?: 'todos' | 'conPdf' | 'sinPdf';
    tienePdf?: boolean;
    soloConResumen?: boolean;
    destacada?: boolean;
    buscarEn?: string[];
    /** Internal candidate restriction used by saved-search novelty evaluation. */
    sentenceIds?: number[];
  };
  sourceSystems?: Array<'JURISPRUDENCIA' | 'DIGESTO' | 'CORPUS'>;
  /** Restricts the logical document types after the engine has selected a source. */
  documentKinds?: Array<'DOCUMENTO' | 'SUMARIO' | 'SENTENCIA'>;
  sort?: {
    field: 'relevancia' | 'fecha' | 'sala' | 'numeroSentencia';
    order: 'asc' | 'desc';
  };
  /** Set only by an authenticated workspace service after membership authorization. */
  documentScope?:
    | { kind: 'GENERAL' }
    | {
        kind: 'WORKSPACE';
        workspaceId: string;
        userId: number;
        folderId?: string | null;
        sourceId?: string;
        sourceFolder?: string;
      }
    | { kind: 'PERSONAL'; userId: number; folderId?: string | null };
};

export type SearchResult = {
  id: string;
  sourceSystem: 'JURISPRUDENCIA' | 'DIGESTO' | 'CORPUS';
  sourceType: 'SUMARIO' | 'SENTENCIA' | 'DOCUMENTO';
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
  /** Exact public jurisprudence facets computed with the same Search query. */
  facets?: SearchResultFacets;
};

export type SearchResultFacets = {
  salas: Array<{ value: string; count: number; filterValues: string[] }>;
  years: Array<{ value: number; count: number }>;
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
  close?(): Promise<void>;
}
