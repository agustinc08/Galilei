import type { Sentencia } from './sentencia';

export type Favorito = {
  id: number;
  usuarioId: number;
  sentenciaId: number;
  createdAt: string;
  sentencia: Sentencia;
};
