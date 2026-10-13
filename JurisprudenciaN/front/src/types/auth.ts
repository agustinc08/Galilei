export type Rol = {
  id: number;
  nombre: 'ADMIN' | 'OPERADOR' | 'LECTOR' | 'REVISOR' | 'JURISPRUDENCIA' | 'DIGESTO' | string;
  descripcion?: string | null;
};

export type AuthUser = {
  id: number;
  nombre: string;
  apellido?: string | null;
  email: string;
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
  ultimoAcceso?: string | null;
  rol: Rol;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type LoginResponse = {
  accessToken: string;
  user: AuthUser;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};
