import 'reflect-metadata';
import { ROLES, ROLES_KEY } from '../auth/constants';
import { InstitutosJuridicosController } from './institutos-juridicos.controller';

describe('InstitutosJuridicosController authorization metadata', () => {
  const prototype = InstitutosJuridicosController.prototype;
  const reviewInstitute = Object.getOwnPropertyDescriptor(
    prototype,
    'reviewInstitute',
  )?.value as object;
  const reviewSinonimo = Object.getOwnPropertyDescriptor(
    prototype,
    'reviewSinonimo',
  )?.value as object;

  it('keeps catalog administration limited to global ADMIN and OPERADOR roles', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, InstitutosJuridicosController),
    ).toEqual([ROLES.ADMIN, ROLES.OPERADOR]);
  });

  it('limits approval and rejection decisions to global ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, reviewInstitute)).toEqual([
      ROLES.ADMIN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, reviewSinonimo)).toEqual([
      ROLES.ADMIN,
    ]);
  });
});
