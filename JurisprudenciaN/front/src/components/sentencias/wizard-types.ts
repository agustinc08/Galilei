import type { ArchivoPdf } from '@/types/archivo';
import type { SentenciaFormValues } from '@/types/sentencia';

export type WizardSumarioItem = {
  localId: string;
  numeroSumario: string;
  tema: string;
  texto: string;
  publicado: boolean;
  activo: boolean;
};

export type WizardReferenciaNormativaItem = {
  localId: string;
  tipoNorma: string;
  numeroNorma: string;
  articulo: string;
  inciso: string;
  textoReferencia: string;
  url: string;
};

export type WizardReferenciaJurisprudencialItem = {
  localId: string;
  referencia: string;
  falloRelacionadoId: string;
  textoOriginal: string;
};

export type WizardReferenciaDoctrinariaItem = {
  localId: string;
  autor: string;
  titulo: string;
  fuente: string;
  anio: string;
  textoReferencia: string;
  url: string;
};

export type WizardPublicacionOptions = {
  publicarSentencia: boolean;
  publicarSumarios: boolean;
  publicarResena: boolean;
  anonimizar: boolean;
  generarSlugPublico: boolean;
  destacada: boolean;
};

export type WizardDraftSnapshot = {
  draftId: number | null;
  sentencia: SentenciaFormValues;
  pdfFile: File | null;
  archivos: ArchivoPdf[];
  sumarios: WizardSumarioItem[];
  resena: string;
  referenciasNormativas: WizardReferenciaNormativaItem[];
  referenciasJurisprudenciales: WizardReferenciaJurisprudencialItem[];
  referenciasDoctrinarias: WizardReferenciaDoctrinariaItem[];
  opciones: WizardPublicacionOptions;
};
