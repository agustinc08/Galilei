import { RoleName } from '../constants';

export type AuthenticatedUser = {
  id: number;
  nombre: string;
  apellido: string | null;
  email: string;
  activo: boolean;
  rol: {
    id: number;
    nombre: RoleName;
    descripcion: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
};
