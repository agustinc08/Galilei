export type CatalogoItem = {
  id: number;
  nombre: string;
  codigo?: string | null;
  orden?: number | null;
  activa?: boolean;
  activo?: boolean;
  createdAt: string;
  updatedAt: string;
};
