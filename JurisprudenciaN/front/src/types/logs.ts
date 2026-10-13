export type AccionLog = {
  id: number;
  usuarioId: number;
  entidad: string;
  entidadId?: number | null;
  accion: string;
  descripcion?: string | null;
  datosAntes?: unknown;
  datosDespues?: unknown;
  createdAt: string;
  usuario: {
    id: number;
    nombre: string;
    apellido?: string | null;
    email: string;
    rol: {
      nombre: string;
    };
  };
};

export type LogsFilters = {
  usuarioId?: string;
  entidad?: string;
  accion?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  page?: number;
  pageSize?: number;
};
