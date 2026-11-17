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
  const activateInstitute = Object.getOwnPropertyDescriptor(
    prototype,
    'setInstituteActivation',
  )?.value as object;
  const activateSinonimo = Object.getOwnPropertyDescriptor(
    prototype,
    'setSinonimoActivation',
  )?.value as object;

  it('keeps catalog administration limited to global ADMIN and OPERADOR roles', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, InstitutosJuridicosController),
    ).toEqual([ROLES.ADMIN, ROLES.OPERADOR]);
  });

  it('limits approval, rejection, and activation decisions to global ADMIN', () => {
    for (const handler of [
      reviewInstitute,
      reviewSinonimo,
      activateInstitute,
      activateSinonimo,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([ROLES.ADMIN]);
    }
  });
});
