import type { Sumario } from './sumario';

export type BusquedaHighlight = {
  campo: string;
  texto: string;
};

export type BusquedaMatchInfo = {
  exactPhraseMatches: number;
  termMatches: number;
  matchedFields: string[];
  directMatches: number;
  synonymMatches: number;
};

export type SearchSuggestion = {
  value: string;
  tipo:
    | 'tema'
    | 'magistrado'
    | 'sala'
    | 'tipoFallo'
    | 'expediente'
    | 'caratula'
    | 'libre';
  total: number;
};

export type FederatedSearchResult = {
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
  metadata: Record<string, string | number | boolean | null>;
  visibility: string;
  document: { href: string | null; mimeType: string | null } | null;
};

export type FederatedSearchPage = {
  total: number;
  totalExact?: boolean;
  hasMore?: boolean;
  partial?: boolean;
  page: number;
  pageSize: number;
  results: FederatedSearchResult[];
};

export type BusquedaResultado = {
  sentencia: {
    id: number;
    slugPublico?: string | null;
    caratula?: string | null;
    numeroSentencia?: string | null;
    tipoFallo?: string | null;
    sala?: string | null;
    fecha?: string | null;
    expediente?: string | null;
    actor?: string | null;
    demandado?: string | null;
    objeto?: string | null;
    magistrados?: string | null;
    publicado: boolean;
    activo: boolean;
    destacada: boolean;
    tienePdf: boolean;
    pdfDisponible?: boolean;
    archivoPdfId?: number | null;
    resumenPublicado?: boolean;
  };
  cantidadSumarios: number;
  cantidadPdfs: number;
  resumenBreve?: string | null;
  relevancia: number;
  score: number;
  criterioPrincipal?: string | null;
  fragmentos: string[];
  highlights: BusquedaHighlight[];
  matchInfo: BusquedaMatchInfo;
  matchedFields: string[];
  sumariosRelevantes: Sumario[];
};

export type PublicBusquedaResultado = BusquedaResultado;

export type ConsultaPublicaResultado = {
  id: number;
  sentenciaId?: number;
  slugPublico?: string | null;
  numeroSumario?: string | null;
  numeroSentencia?: string | null;
  fecha?: string | null;
  sala?: string | null;
  magistrados?: string | null;
  tipoFallo?: string | null;
  expediente?: string | null;
  tribunalOrigen?: string | null;
  caratula?: string | null;
  actor?: string | null;
  demandado?: string | null;
  tema?: string | null;
  textoSumario: string;
  extractoFallo?: string | null;
  esFalloCorpus?: boolean;
  highlights: BusquedaHighlight[];
  tienePdf: boolean;
  pdfDisponible?: boolean;
  archivoPdfId?: number | null;
  pdfUrl?: string | null;
  score: number;
  criterioPrincipal?: string | null;
  matchInfo: BusquedaMatchInfo;
  matchedFields: string[];
};

export type InstitutoJuridico = {
  id: number;
  nombre: string;
  descripcion?: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
  sinonimos?: SinonimoJuridico[];
};

export type SinonimoJuridico = {
  id: number;
  institutoId: number;
  termino: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NormaArticulo = {
  id: number;
  codigo: string;
  numeroNorma?: string | null;
  articulo: string;
  titulo?: string | null;
  texto?: string | null;
  url?: string | null;
  vigente: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EquivalenciaNormativa = {
  id: number;
  articuloOrigenId: number;
  articuloDestinoId: number;
  tipoRelacion: string;
  observacion?: string | null;
  createdAt: string;
  articuloOrigen?: NormaArticulo;
  articuloDestino?: NormaArticulo;
};

export type BusquedaAvanzadaFilters = {
  q?: string;
  digestoCollectionId?: string;
  digestoTopicId?: string;
  digestoTagId?: string;
  fraseExacta?: string;
  excluir?: string;
  operador?: 'AND' | 'OR' | '';
  numeroSentencia?: string;
  numeroSumario?: string;
  expediente?: string;
  caratula?: string;
  actor?: string;
  demandado?: string;
  objeto?: string;
  magistrados?: string;
  sala?: string;
  tipoFallo?: string;
  tribunalOrigen?: string;
  tema?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  anio?: string;
  publicado?: string;
  activo?: string;
  soloConPdf?: string;
  pdf?: 'todos' | 'conPdf' | 'sinPdf' | '';
  tienePdf?: string;
  soloConResumen?: string;
  destacada?: string;
  buscarEn?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
};

export type ConsultaPublicaFilters = {
  q?: string;
  fraseExacta?: string;
  excluir?: string;
  operador?: 'AND' | 'OR' | '';
  tema?: string;
  sala?: string;
  /** Exact indexed values represented by one normalized public Sala facet. */
  salas?: string[];
  fechaDesde?: string;
  fechaHasta?: string;
  tipoFallo?: string;
  tribunalOrigen?: string;
  numeroSumario?: string;
  numeroSentencia?: string;
  magistrados?: string;
  caratula?: string;
  expediente?: string;
  actor?: string;
  demandado?: string;
  objeto?: string;
  anio?: string;
  soloConPdf?: string;
  pdf?: 'todos' | 'conPdf' | 'sinPdf' | '';
  tienePdf?: string;
  buscarEn?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
};

export type TemaOption = string;
export type SalaOption = string;
export type TipoFalloOption = string;
