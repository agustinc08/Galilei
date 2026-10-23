export type Sumario = {
  id: number;
  legacyId?: string | null;
  numeroSumario?: string | null;
  tema?: string | null;
  texto: string;
  resumenBusqueda?: string | null;
  publicado: boolean;
  activo: boolean;
  sentenciaId: number;
  createdAt: string;
  updatedAt: string;
  sentencia?: {
    id: number;
    numeroSentencia?: string | null;
    sala?: string | null;
    fecha?: string | null;
    expediente?: string | null;
    actor?: string | null;
    demandado?: string | null;
  };
};

export type SumarioFormValues = {
  sentenciaId: number | '';
  numeroSumario: string;
  tema: string;
  texto: string;
  resumenBusqueda: string;
  publicado: boolean;
  activo: boolean;
};

export type SumarioFilters = {
  sentenciaId?: string;
  numeroSumario?: string;
  tema?: string;
  publicado?: string;
  activo?: string;
  page?: number;
  pageSize?: number;
};
