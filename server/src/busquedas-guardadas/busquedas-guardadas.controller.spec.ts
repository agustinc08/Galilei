import { ROLES, ROLES_KEY } from '../auth/constants';
import { BusquedasGuardadasController } from './busquedas-guardadas.controller';

describe('BusquedasGuardadasController authorization', () => {
  it('allows researchers to manage only their own saved searches', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, BusquedasGuardadasController),
    ).toEqual([ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA]);
  });
});
