export type BusquedaGuardada = {
  id: number;
  usuarioId: number;
  nombre: string;
  queryJson: Record<string, unknown>;
  lastViewedAt?: string | null;
  lastEvaluatedAt?: string | null;
  lastNewCount?: number | null;
  noveltyAvailable?: boolean;
  noveltyError?: string;
  createdAt: string;
  updatedAt: string;
};
