import { RoleName } from '../constants';

export type JwtPayload = {
  sub: number;
  email: string;
  rol: RoleName;
};
