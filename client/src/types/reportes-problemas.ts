export type ReporteProblemaStatus =
  | "NUEVO"
  | "EN_ANALISIS"
  | "REPRODUCIDO"
  | "EN_CORRECCION"
  | "RESUELTO"
  | "PENDIENTE_VALIDACION"
  | "CERRADO";

export type ReporteProblemaPriority = "P0" | "P1" | "P2" | "P3";

export type ReporteProblema = {
  id: number;
  usuarioId: number | null;
  tipo: "ERROR" | "FUNCIONAMIENTO" | "ACCESO" | "CONTENIDO" | "OTRO";
  descripcion: string;
  ruta: string;
  accion: string | null;
  modulo: string;
  version: string;
  errorId: string | null;
  estado: ReporteProblemaStatus;
  prioridad: ReporteProblemaPriority;
  notasAdmin: string | null;
  duplicadoDeId: number | null;
  usuario: {
    id: number;
    nombre: string;
    apellido: string | null;
    email: string;
  } | null;
  duplicadoDe: {
    id: number;
    estado: ReporteProblemaStatus;
    prioridad: ReporteProblemaPriority;
  } | null;
  duplicados: { id: number; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
};
