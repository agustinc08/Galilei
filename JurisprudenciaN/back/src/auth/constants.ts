export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export const ROLES = {
  ADMIN: 'ADMIN',
  OPERADOR: 'OPERADOR',
  LECTOR: 'LECTOR',
  REVISOR: 'REVISOR',
  JURISPRUDENCIA: 'JURISPRUDENCIA',
  DIGESTO: 'DIGESTO',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];
