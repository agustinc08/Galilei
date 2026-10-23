import type { ArchivoPdf } from "./archivo";
import type { CatalogoItem } from "./catalogos";
import type { Sumario } from "./sumario";

export type CitaSentencia = {
  citaBreve: string;
  citaCompleta: string;
  citaCopiable: string;
};

export type ReferenciaNormativa = {
  id: number;
  sentenciaId: number;
  normaArticuloId?: number | null;
  tipoNorma: string;
  numeroNorma?: string | null;
  articulo?: string | null;
  inciso?: string | null;
  textoReferencia?: string | null;
  url?: string | null;
  createdAt: string;
};

export type ReferenciaJurisprudencial = {
  id: number;
  sentenciaId: number;
  referencia: string;
  falloRelacionadoId?: number | null;
  textoOriginal?: string | null;
  createdAt: string;
  falloRelacionado?: {
    id: number;
    numeroSentencia?: string | null;
    expediente?: string | null;
    sala?: string | null;
    fecha?: string | null;
    slugPublico?: string | null;
  } | null;
};

export type ReferenciaDoctrinaria = {
  id: number;
  sentenciaId: number;
  autor?: string | null;
  titulo?: string | null;
  fuente?: string | null;
  anio?: number | null;
  textoReferencia?: string | null;
  url?: string | null;
  createdAt: string;
};

export type CitaFallo = {
  id: number;
  sentenciaId: number;
  tipo: string;
  referencia: string;
  textoOriginal?: string | null;
  contexto?: string | null;
  pagina?: number | null;
  confirmada: boolean;
  creadaManual: boolean;
  createdById?: number | null;
  updatedById?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ResumenSentencia = {
  id?: number;
  resumenIa?: string | null;
  resumenFuente?: string | null;
  resumenPublicado?: boolean;
  updatedAt?: string;
};

export type FichaSentencia = {
  sentencia: Sentencia;
  resumen: {
    texto?: string | null;
    fuente?: string | null;
    publicado: boolean;
  };
  resena?: string | null;
  cita: CitaSentencia;
  sumarios: Sumario[];
  citasFallo?: CitaFallo[];
  referenciasNormativas?: ReferenciaNormativa[];
  referenciasJurisprudenciales?: ReferenciaJurisprudencial[];
  referenciasDoctrinarias?: ReferenciaDoctrinaria[];
  archivosPdf: ArchivoPdf[];
  generatedAt: string;
};

export type PublicSentencia = {
  id: number;
  slugPublico?: string | null;
  numeroSentencia?: string | null;
  tipoFallo?: string | null;
  tipoFalloId?: number | null;
  sala?: string | null;
  salaId?: number | null;
  fecha?: string | null;
  expediente?: string | null;
  tribunalOrigen?: string | null;
  tribunalOrigenId?: number | null;
  caratula?: string | null;
  actor?: string | null;
  demandado?: string | null;
  objeto?: string | null;
  magistrados?: string | null;
  resumen?: string | null;
  resena?: string | null;
  citasFallo?: CitaFallo[];
  referenciasNormativas?: ReferenciaNormativa[];
  referenciasJurisprudenciales?: ReferenciaJurisprudencial[];
  referenciasDoctrinarias?: ReferenciaDoctrinaria[];
  cita: CitaSentencia;
  sumarios: Sumario[];
  archivosPdf: ArchivoPdf[];
};

export type FalloRelacionadoPublico = {
  id: number;
  slugPublico?: string | null;
  numeroSentencia?: string | null;
  caratula?: string | null;
  sala?: string | null;
  fecha?: string | null;
  temaPrincipal?: string | null;
  scoreSimilitud: number;
  sumarioBreve?: string | null;
};

export type Sentencia = {
  id: number;
  legacyId?: string | null;
  numeroSentencia?: string | null;
  tipoFallo?: string | null;
  tipoFalloId?: number | null;
  sala?: string | null;
  salaId?: number | null;
  fecha?: string | null;
  expediente?: string | null;
  tribunalOrigen?: string | null;
  tribunalOrigenId?: number | null;
  actor?: string | null;
  demandado?: string | null;
  actorOriginal?: string | null;
  demandadoOriginal?: string | null;
  actorPublico?: string | null;
  demandadoPublico?: string | null;
  anonimizado?: boolean;
  objeto?: string | null;
  magistrados?: string | null;
  juez?: string | null;
  publicado: boolean;
  publishedAt?: string | null;
  activo: boolean;
  observacionesInternas?: string | null;
  resumenIa?: string | null;
  resena?: string | null;
  resenaAi?: string | null;
  resenaPublicada?: boolean;
  resenaUpdatedAt?: string | null;
  resenaPublicadaAt?: string | null;
  resenaUpdatedById?: number | null;
  resenaPublicadaById?: number | null;
  resumenPublicado?: boolean;
  resumenFuente?: string | null;
  citaPersonalizada?: string | null;
  slugPublico?: string | null;
  destacada?: boolean;
  caratula?: string | null;
  estadoCarga?: string | null;
  tienePdf?: boolean;
  salaCatalogo?: CatalogoItem | null;
  tipoFalloCatalogo?: CatalogoItem | null;
  tribunalOrigenCatalogo?: CatalogoItem | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    sumarios: number;
    archivosPdf: number;
    favoritos?: number;
  };
};

export type SentenciaCompleta = Sentencia & {
  sumarios: Sumario[];
  archivosPdf: ArchivoPdf[];
  citasFallo?: CitaFallo[];
  referenciasNormativas?: ReferenciaNormativa[];
  referenciasJurisprudenciales?: ReferenciaJurisprudencial[];
  referenciasDoctrinarias?: ReferenciaDoctrinaria[];
  cita?: CitaSentencia;
};

export type SentenciaFormValues = {
  numeroSentencia: string;
  tipoFallo: string;
  tipoFalloId: number | "";
  sala: string;
  salaId: number | "";
  fecha: string;
  expediente: string;
  tribunalOrigen: string;
  tribunalOrigenId: number | "";
  caratula: string;
  actor: string;
  demandado: string;
  objeto: string;
  magistrados: string;
  juez: string;
  observacionesInternas: string;
  estadoCarga: string;
  publicado: boolean;
  activo: boolean;
};

export type SentenciaFilters = {
  numeroSentencia?: string;
  expediente?: string;
  sala?: string;
  tipoFallo?: string;
  actor?: string;
  demandado?: string;
  publicado?: string;
  activo?: string;
  excluirRevision?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  page?: number;
  pageSize?: number;
};
