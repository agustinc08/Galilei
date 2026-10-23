export type ResumenGeneral = {
  totalSentencias: number;
  totalSumarios: number;
  totalConPdf: number;
  totalPublicadas: number;
  totalDestacadas: number;
  totalConResumen: number;
  totalConResena: number;
};

export type EstadisticaAnual = {
  anio: number | null;
  sentencias: number;
  sumarios: number;
};

export type EstadisticaConteo = {
  total: number;
  sala?: string | null;
  tipoFallo?: string | null;
  tribunalOrigen?: string | null;
  tema?: string | null;
  tipoEvento?: string;
  termino?: string;
  filtro?: string;
  fecha?: string;
  mes?: number;
  nombre?: string;
};

export type CalidadDatos = {
  sentenciasSinResumen: number;
  sentenciasSinResena: number;
  sentenciasSinPdf: number;
  sentenciasSinSumarios: number;
  sentenciasSinActor: number;
  sentenciasSinDemandado: number;
  sentenciasSinObjeto: number;
  sumariosSinTema: number;
};

export type PublicacionStats = {
  publicadas: number;
  noPublicadas: number;
  destacadas: number;
  noDestacadas: number;
  conResumenPublicado: number;
  sinResumenPublicado: number;
};

export type SentenciaEvento = {
  sentenciaId: number | null;
  total: number;
  sentencia: {
    id: number;
    numeroSentencia?: string | null;
    caratula?: string | null;
    sala?: string | null;
    fecha?: string | null;
    publicado: boolean;
    destacada: boolean;
  } | null;
};

export type UsoResumen = {
  busquedasPublicas: number;
  busquedasInternas: number;
  busquedasSinResultados: number;
  sugerenciasClickeadas: number;
  impresionesResultados: number;
  impresionesFicha: number;
  exportaciones: number;
  vistasDocumento: number;
};

export type InformeAnualItem = {
  nombre: string;
  total: number;
};

export type InformeAnualMes = {
  mes: number;
  nombre: string;
  total: number;
};

export type InformeAnual = {
  anio: number;
  titulo: string;
  generadoEn: string;
  porFechaCarga: {
    totalSentenciasCargadas: number;
    totalSumariosCargados: number;
    totalPdfsCargados: number;
    totalPublicadas: number;
    totalNoPublicadas: number;
    totalConResena: number;
    totalConReferenciasNormativas: number;
    totalConReferenciasJurisprudenciales: number;
    totalConReferenciasDoctrinarias: number;
    totalAnonimizadas: number;
    totalDestacadas: number;
    calidadDatos: {
      sinPdf: number;
      sinResena: number;
      sinSumarios: number;
    };
  };
  porFechaFallo: {
    totalSentencias: number;
    porSala: InformeAnualItem[];
    porTipoFallo: InformeAnualItem[];
    porTribunalOrigen: InformeAnualItem[];
  };
  porSala: InformeAnualItem[];
  porTipoFallo: InformeAnualItem[];
  porTribunalOrigen: InformeAnualItem[];
  porMes: InformeAnualMes[];
  topTemas: InformeAnualItem[];
};
